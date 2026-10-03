import type { DiffNode } from './diff';
import { byAddr, type Cause, type Res } from './model';
import type { ConfigModule, Plan } from './types';
import { deq, isEmptyColl, isNil } from './util';

/* ---------- why values change: references recorded in the plan's `configuration` ---------- */

const joinAddr = (p: string, a: string): string => (p ? p + '.' : '') + a;
const stripKeys = (s: string | undefined): string => String(s ?? '').replace(/\[[^\]]*\]/g, '');
const isDataAddr = (a: string): boolean => /(^|\.)data\./.test(a);
/** The configuration address of a resource instance: module and instance keys removed. */
export const configAddr = (r: Res): string => joinAddr(stripKeys(r.module), (r.mode === 'data' ? 'data.' : '') + r.type + '.' + r.name);

interface ConfigEntry {
  exprs: Record<string, unknown>;
  prefix: string;
  dependsOn: string[];
}
interface ModuleEntry {
  exprs: Record<string, unknown>;
  parent: string;
  outputs: Record<string, { expression?: unknown }>;
}
export interface ConfigIndex {
  resources: Map<string, ConfigEntry>;
  outputs: Record<string, { expression?: unknown }>;
  /** All resource config addresses an expression refers to (following module variables and outputs). */
  resolve(expr: unknown, prefix: string, out?: Set<string>): Set<string>;
  resolveRef(ref: string, prefix: string, out: Set<string>): void;
}

export function buildConfigIndex(plan: Plan): ConfigIndex | null {
  const root = plan.configuration?.root_module;
  if (!root) return null;
  const resources = new Map<string, ConfigEntry>();
  const modules = new Map<string, ModuleEntry>();
  const walk = (mod: ConfigModule, prefix: string) => {
    for (const r of mod.resources ?? []) resources.set(joinAddr(prefix, r.address), { exprs: r.expressions ?? {}, prefix, dependsOn: r.depends_on ?? [] });
    for (const [name, call] of Object.entries(mod.module_calls ?? {})) {
      const p = joinAddr(prefix, 'module.' + name);
      modules.set(p, { exprs: call.expressions ?? {}, parent: prefix, outputs: call.module?.outputs ?? {} });
      walk(call.module ?? {}, p);
    }
  };
  walk(root, '');

  const resolveRef = (ref: string, prefix: string, out: Set<string>, depth = 0): void => {
    const parts = stripKeys(ref).split('.');
    const head = parts[0];
    if (head === 'var') {
      const m = modules.get(prefix);
      if (m && m.exprs[parts[1]]) resolve(m.exprs[parts[1]], m.parent, out, depth + 1);
      return;
    }
    if (head === 'module') {
      const mp = joinAddr(prefix, 'module.' + parts[1]);
      const o = parts[2] ? modules.get(mp)?.outputs[parts[2]] : undefined;
      if (o?.expression) resolve(o.expression, mp, out, depth + 1);
      return;
    }
    if (head === 'data') {
      if (parts.length >= 3) out.add(joinAddr(prefix, `data.${parts[1]}.${parts[2]}`));
      return;
    }
    if (parts.length < 2 || /^(local|each|count|path|terraform|self)$/.test(head)) return;
    out.add(joinAddr(prefix, `${parts[0]}.${parts[1]}`));
  };
  const resolve = (expr: unknown, prefix: string, out: Set<string> = new Set(), depth = 0): Set<string> => {
    if (!expr || typeof expr !== 'object' || depth > 8) return out;
    if (Array.isArray(expr)) { expr.forEach(e => resolve(e, prefix, out, depth)); return out; }
    const o = expr as Record<string, unknown>;
    if (Array.isArray(o.references)) o.references.forEach(ref => resolveRef(String(ref), prefix, out, depth));
    for (const [k, v] of Object.entries(o)) if (k !== 'references' && k !== 'constant_value' && v && typeof v === 'object') resolve(v, prefix, out, depth);
    return out;
  };
  return { resources, outputs: root.outputs ?? {}, resolve: (e, p, out) => resolve(e, p, out), resolveRef: (r, p, out) => resolveRef(r, p, out) };
}

export interface CauseContext {
  model: Res[];
  byId: Map<string, Res>;
  driftByAddr: Map<string, Res>;
  outputs: DiffNode;
  cfg: ConfigIndex | null;
}

/**
 * For every changed top-level attribute, record which changing resource it comes from, which data
 * source supplies it, or that the plan undoes a change made outside Terraform. Also fills `affects`.
 * Returns the causes of changed outputs.
 */
export function computeCauses(ctx: CauseContext): Map<string, Cause[]> {
  const { cfg: idx } = ctx;
  const byCfg = new Map<string, Res[]>();
  for (const r of ctx.model) {
    const c = configAddr(r);
    if (!byCfg.has(c)) byCfg.set(c, []);
    byCfg.get(c)!.push(r);
    r.causes = new Map();
    r.affects = [];
  }
  const outCauses = new Map<string, Cause[]>();
  const changing = (addr: string, self: Res | null) => (byCfg.get(addr) ?? []).filter(x => x !== self && !['noop', 'move', 'import', 'forget'].includes(x.kind));
  const tagsFor = (refs: Set<string>, self: Res | null): Cause[] => {
    const tags: Cause[] = [];
    for (const ref of refs) {
      const p = changing(ref, self);
      if (p.length) tags.push({ t: 'from', addr: ref, ids: p.map(x => x.id) });
      else if (isDataAddr(ref) && !byCfg.has(ref)) tags.push({ t: 'source', addr: ref });
    }
    return tags;
  };
  for (const r of ctx.model) {
    if (r.kind === 'noop' || !r.tree) continue;
    const conf = idx?.resources.get(configAddr(r));
    const d = ctx.driftByAddr.get(r.address);
    const drifted = new Set(d?.tree?.kids?.filter(k => k.st !== 'same').map(k => k.key) ?? []);
    if (r.kind === 'read') {
      if (!conf || !idx) continue;
      const refs = new Set<string>();
      Object.values(conf.exprs).forEach(e => idx.resolve(e, conf.prefix, refs));
      conf.dependsOn.forEach(dep => idx.resolveRef(String(dep), conf.prefix, refs));
      const tags = tagsFor(refs, r).filter(t => t.t === 'from');
      if (tags.length) r.causes.set('', tags);
      continue;
    }
    for (const k of r.tree.kids ?? []) {
      if (k.st === 'same') continue;
      const expr = conf?.exprs[String(k.key)];
      const tags = idx && conf && expr !== undefined ? tagsFor(idx.resolve(expr, conf.prefix), r) : [];
      if (drifted.has(k.key) && r.kind !== 'create') tags.push({ t: 'drift' });
      if (tags.length) r.causes.set(k.key, tags);
    }
  }
  const link = (src: Res | undefined, entry: { key: string; id?: string; label: string }) => {
    if (src && !src.affects.some(a => a.key === entry.key)) src.affects.push(entry);
  };
  for (const r of ctx.model) for (const tags of r.causes.values()) for (const t of tags) if (t.t === 'from') t.ids?.forEach(id => link(ctx.byId.get(id), { key: r.id, id: r.id, label: r.address }));
  if (!idx) return outCauses;
  for (const k of ctx.outputs.kids ?? []) {
    const o = idx.outputs[String(k.key)];
    if (k.st === 'same' || !o?.expression) continue;
    const tags = tagsFor(idx.resolve(o.expression, ''), null).filter(t => t.t === 'from');
    if (!tags.length) continue;
    outCauses.set(String(k.key), tags);
    tags.forEach(t => t.ids?.forEach(id => link(ctx.byId.get(id), { key: 'out:' + String(k.key), label: 'output ' + String(k.key) })));
  }
  return outCauses;
}

/** The distinct changing resources a resource's changes come from. */
export function causeFrom(r: Res): Cause[] {
  const m = new Map<string, Cause>();
  for (const tags of r.causes.values()) for (const t of tags) if (t.t === 'from' && t.addr && !m.has(t.addr)) m.set(t.addr, t);
  return [...m.values()];
}

/* ---------- renames: a destroy plus a create with the same settings ---------- */

export interface RenamePair {
  from: Res;
  to: Res;
  score: number;
}

// If any of these differ, the two resources are not the same thing.
const IDENT = ['name', 'bucket', 'identifier', 'function_name', 'cluster_id', 'cluster_identifier', 'table_name', 'alarm_name', 'domain_name', 'role_name', 'cidr_block'];

function renameScore(before: Record<string, unknown>, after: Record<string, unknown>): number {
  for (const k of IDENT) if (!isNil(before[k]) && !isNil(after[k]) && !deq(before[k], after[k])) return 0;
  let total = 0, same = 0;
  for (const k of Object.keys(after)) {
    const a = after[k];
    if (isNil(a) || isEmptyColl(a) || k === 'tags_all' || k === 'timeouts') continue;
    total++;
    if (deq(a, before[k])) same++;
  }
  return total >= 2 ? same / total : 0;
}

/** Pair destroys with creates of the same type and settings; sets renameTo/renameOf. */
export function detectRenames(model: Res[]): RenamePair[] {
  const dels = model.filter(r => r.kind === 'delete' && !r.deposed);
  const adds = model.filter(r => r.kind === 'create');
  const cand: [number, Res, Res][] = [];
  for (const d of dels) for (const c of adds) {
    if (c.type !== d.type || c.mode !== d.mode) continue;
    const before = (d.rc.change?.before ?? {}) as Record<string, unknown>;
    const after = (c.rc.change?.after ?? {}) as Record<string, unknown>;
    const s = renameScore(before, after);
    if (s >= 0.75) cand.push([s, d, c]);
  }
  cand.sort((a, b) => b[0] - a[0]);
  const pairs: RenamePair[] = [], used = new Set<string>();
  for (const [score, d, c] of cand) {
    if (used.has(d.id) || used.has(c.id)) continue;
    used.add(d.id);
    used.add(c.id);
    d.renameTo = c;
    c.renameOf = d;
    pairs.push({ from: d, to: c, score });
  }
  return pairs.sort((a, b) => byAddr(a.from, b.from));
}

export const movedBlock = (p: { from: Res; to: Res }): string => `moved {\n  from = ${p.from.address}\n  to   = ${p.to.address}\n}`;
