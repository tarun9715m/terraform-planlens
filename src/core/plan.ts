import { diffNamed, type DiffNode } from './diff';
import { buildConfigIndex, causeFrom, computeCauses, detectRenames, type ConfigIndex, type RenamePair } from './insight';
import { makeRes, treeOf, warnings, type Cause, type Kind, type Res } from './model';
import type { Plan } from './types';
import { hash, isObj } from './util';

export interface Globals {
  c: Record<Kind, number>;
  /** Unchanged attributes terraform plan would collapse. */
  hidden: number;
  sens: number;
  sensChanged: number;
  secrets: number;
  decoded: number;
  imports: number;
  cbd: number;
  gap: number;
  recreated: number;
  updDrift: number;
  stateRep: number;
  stateDel: number;
  caused: number;
  renames: number;
  driftHidden: number;
  actions: number;
  /** What terraform plan's summary line counts. */
  tf: { add: number; change: number; destroy: number; import: number };
}

export interface PlanModel {
  plan: Plan;
  model: Res[];
  byId: Map<string, Res>;
  drift: Res[];
  driftByAddr: Map<string, Res>;
  outputs: DiffNode;
  outCauses: Map<string, Cause[]>;
  cfg: ConfigIndex | null;
  renames: RenamePair[];
  g: Globals;
  /** Stable identifier of this plan's contents, for remembering review progress. */
  key: string;
}

export function analyzePlan(plan: Plan): PlanModel {
  const rcs = Array.isArray(plan.resource_changes) ? plan.resource_changes : [];
  const model = rcs.map((rc, i) => makeRes(rc, i, 'r'));
  const byId = new Map(model.map(r => [r.id, r]));
  const relevant = new Set((plan.relevant_attributes ?? []).map(x => x.resource));
  const drift = (plan.resource_drift ?? []).map((rc, i) => {
    const d = makeRes(rc, i, 'd');
    d.drift = true;
    d.kind = (rc.change?.actions ?? []).includes('delete') ? 'delete' : 'update';
    d.relevant = relevant.has(rc.address) || relevant.has(rc.address.replace(/\[[^\]]*\]$/, ''));
    return d;
  });
  const driftByAddr = new Map(drift.map(d => [d.address, d]));
  const outputs = diffNamed('o.', plan.output_changes ?? {});
  for (const r of model) {
    if (r.kind !== 'noop') treeOf(r);
    r.warn = warnings(r);
  }
  drift.forEach(treeOf);
  const cfg = buildConfigIndex(plan);
  const renames = detectRenames(model);
  const outCauses = computeCauses({ model, byId, driftByAddr, outputs, cfg });
  const pm: PlanModel = {
    plan, model, byId, drift, driftByAddr, outputs, outCauses, cfg, renames,
    g: undefined as unknown as Globals,
    key: 'planlens:rev:' + hash((plan.timestamp ?? '') + '|' + rcs.map(r => r.address + ':' + (r.change?.actions ?? []).join('/')).join('|')),
  };
  pm.g = globals(pm);
  return pm;
}

function walkLeaves(n: DiffNode, f: (n: DiffNode) => void): void {
  if (n.kids && n.kind !== 'json') n.kids.forEach(k => walkLeaves(k, f));
  else f(n);
}

function globals(pm: PlanModel): Globals {
  const c = { create: 0, update: 0, replace: 0, delete: 0, read: 0, import: 0, move: 0, forget: 0, noop: 0, other: 0 } as Record<Kind, number>;
  const g: Globals = {
    c, hidden: 0, sens: 0, sensChanged: 0, secrets: 0, decoded: 0, imports: 0, cbd: 0, gap: 0, recreated: 0, updDrift: 0,
    stateRep: 0, stateDel: 0, caused: 0, renames: pm.renames.length, driftHidden: 0, actions: 0, tf: { add: 0, change: 0, destroy: 0, import: 0 },
  };
  for (const r of pm.model) {
    c[r.kind]++;
    if (r.imported) g.imports++;
    if (r.kind === 'noop' || !r.st) continue;
    const s = r.st;
    g.hidden += s.hidden;
    g.sens += s.sens;
    g.sensChanged += s.sensChanged;
    g.secrets += s.secrets.length;
    g.decoded += s.decoded;
    if (r.cbd) g.cbd++;
    if (r.kind === 'replace' && !r.cbd) g.gap++;
    if (r.destructive && r.stateful) r.kind === 'replace' ? g.stateRep++ : g.stateDel++;
    if (causeFrom(r).length) g.caused++;
    const d = pm.driftByAddr.get(r.address);
    if (d && r.kind === 'create' && d.kind === 'delete') g.recreated++;
    if (d && r.kind === 'update') g.updDrift++;
  }
  walkLeaves(pm.outputs, n => {
    if (n.sensA || n.sensB) { g.sens++; if (n.st !== 'same') g.sensChanged++; }
    if (n.secret && n.st !== 'same') g.secrets++;
  });
  const forgotten = pm.model.filter(r => r.forgetOld).length;
  g.tf = { add: c.create + c.replace, change: c.update, destroy: c.delete + c.replace - forgotten, import: g.imports };
  g.driftHidden = pm.drift.filter(d => !d.relevant).length;
  g.actions = Array.isArray(pm.plan.action_invocations) ? pm.plan.action_invocations.length : 0;
  return g;
}

/** The summary line terraform plan prints for this plan. */
export function tfPlanLine(g: Globals): string {
  const t = g.tf;
  return `Plan: ${t.import ? `${t.import} to import, ` : ''}${t.add} to add, ${t.change} to change, ${t.destroy} to destroy.`;
}

const SHOW_JSON = '`terraform show -json tfplan > plan.json`';

/** Parse a file's text as plan JSON. Errors are plain sentences; backticks mark commands. */
export function parsePlanText(text: string, name: string): { plan: Plan } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    if (text.startsWith('PK')) return { error: `${name} is a binary plan file. Convert it first with ${SHOW_JSON}, or pass it to the planlens command, which converts it for you.` };
    if (/Terraform (will perform|used the selected providers)|^Plan: \d/m.test(text)) return { error: `${name} is the text output of terraform plan. planlens needs the JSON form: run \`terraform plan -out=tfplan\`, then ${SHOW_JSON}.` };
    return { error: `${name} isn't valid JSON (${(e as Error).message}).` };
  }
  return checkPlanJson(json, name);
}

export function checkPlanJson(json: unknown, name: string): { plan: Plan } | { error: string } {
  if (!isObj(json) || !('resource_changes' in json || 'output_changes' in json || 'planned_values' in json)) {
    if (isObj(json) && 'values' in json && 'format_version' in json) return { error: `${name} is state JSON, not a plan. Pass the saved plan file instead: ${SHOW_JSON}.` };
    return { error: `${name} has no \`resource_changes\`, so it isn't a Terraform plan. Create one with ${SHOW_JSON}.` };
  }
  return { plan: json as unknown as Plan };
}
