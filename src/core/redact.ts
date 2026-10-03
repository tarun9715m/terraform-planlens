import { looksSecret } from './diff';
import type { Change, ConfigModule, Json, Plan, ResourceChange } from './types';
import { deq, isNil, isObj, sub } from './util';

// Placeholders keep before/after comparable: equal values get the same text, changed values differ.
export const MASK = '(sensitive value)';
export const MASK_CHANGED = '(sensitive value, changed)';
export const SECRET = '(removed by planlens)';
export const SECRET_CHANGED = '(removed by planlens, changed)';

export interface RedactStats {
  /** Values Terraform marks sensitive. */
  sensitive: number;
  /** Values that look like secrets but aren't marked sensitive. */
  suspected: number;
}

/**
 * A copy of the plan that is safe to share as a report: only the fields planlens shows, with
 * sensitive and secret-looking values replaced. `terraform show -json` stores every sensitive value
 * in plain text, so a report built from the raw plan would leak them.
 */
export function redactPlan(plan: Plan): { plan: Plan; stats: RedactStats } {
  const stats: RedactStats = { sensitive: 0, suspected: 0 };
  const out: Plan = {};
  for (const k of ['format_version', 'terraform_version', 'timestamp', 'applyable', 'complete', 'errored'] as const) {
    if (plan[k] !== undefined) (out as Record<string, unknown>)[k] = plan[k];
  }
  if (Array.isArray(plan.resource_changes)) out.resource_changes = plan.resource_changes.map(rc => redactResourceChange(rc, stats));
  if (Array.isArray(plan.resource_drift)) out.resource_drift = plan.resource_drift.map(rc => redactResourceChange(rc, stats));
  if (isObj(plan.output_changes)) {
    out.output_changes = {};
    for (const [name, ch] of Object.entries(plan.output_changes)) out.output_changes[name] = redactChange(ch, stats, name);
  }
  if (Array.isArray(plan.relevant_attributes)) out.relevant_attributes = plan.relevant_attributes;
  if (plan.configuration?.root_module) out.configuration = { root_module: reportModule(plan.configuration.root_module) };
  // Only their count is shown; their contents can hold plain-text values.
  if (Array.isArray(plan.deferred_changes)) out.deferred_changes = plan.deferred_changes.map(() => ({}));
  if (Array.isArray(plan.action_invocations)) out.action_invocations = plan.action_invocations.map(() => ({}));
  return { plan: out, stats };
}

function redactResourceChange(rc: ResourceChange, stats: RedactStats): ResourceChange {
  const out: Partial<ResourceChange> = {};
  for (const k of ['address', 'previous_address', 'module_address', 'mode', 'type', 'name', 'index', 'provider_name', 'deposed', 'action_reason'] as const) {
    if (rc[k] !== undefined) (out as Record<string, unknown>)[k] = rc[k];
  }
  out.change = redactChange(rc.change ?? { actions: [] }, stats);
  return out as ResourceChange;
}

function redactChange(ch: Change, stats: RedactStats, name?: string): Change {
  const out: Change = { actions: ch.actions ?? [] };
  const [b, a] = redactPair(name ?? '', ch.before, ch.after, ch.before_sensitive, ch.after_sensitive, stats);
  if (ch.before !== undefined) out.before = b ?? null;
  if (ch.after !== undefined) out.after = a ?? null;
  if (ch.after_unknown !== undefined) out.after_unknown = ch.after_unknown;
  if (ch.before_sensitive !== undefined) out.before_sensitive = ch.before_sensitive;
  if (ch.after_sensitive !== undefined) out.after_sensitive = ch.after_sensitive;
  if (ch.replace_paths !== undefined) out.replace_paths = ch.replace_paths;
  if (ch.importing) out.importing = { ...(ch.importing.id !== undefined ? { id: ch.importing.id } : {}), ...(ch.importing.unknown ? { unknown: true } : {}) };
  return out;
}

/** Walk before and after together so a masked value still shows whether it changed. */
function redactPair(key: string, b: Json | undefined, a: Json | undefined, bs: unknown, as: unknown, stats: RedactStats): [Json | undefined, Json | undefined] {
  if (bs === true || as === true) {
    const same = deq(b, a);
    if (!isNil(b) || !isNil(a)) stats.sensitive++;
    return [isNil(b) ? b : MASK, isNil(a) ? a : same ? MASK : MASK_CHANGED];
  }
  if ((isObj(b) || isNil(b)) && (isObj(a) || isNil(a)) && (isObj(b) || isObj(a))) {
    const nb: Record<string, Json> | undefined = isObj(b) ? {} : undefined;
    const na: Record<string, Json> | undefined = isObj(a) ? {} : undefined;
    const keys = new Set([...Object.keys(isObj(b) ? b : {}), ...Object.keys(isObj(a) ? a : {})]);
    for (const k of keys) {
      const [x, y] = redactPair(k, isObj(b) ? b[k] : undefined, isObj(a) ? a[k] : undefined, sub(bs, k), sub(as, k), stats);
      if (nb && k in (b as Record<string, Json>)) nb[k] = x as Json;
      if (na && k in (a as Record<string, Json>)) na[k] = y as Json;
    }
    return [nb ?? b, na ?? a];
  }
  if (Array.isArray(b) || Array.isArray(a)) {
    const B = Array.isArray(b) ? b : [], A = Array.isArray(a) ? a : [];
    const n = Math.max(B.length, A.length);
    const nb: Json[] = [], na: Json[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = redactPair('', i < B.length ? B[i] : undefined, i < A.length ? A[i] : undefined, sub(bs, i), sub(as, i), stats);
      if (i < B.length) nb.push(x as Json);
      if (i < A.length) na.push(y as Json);
    }
    return [Array.isArray(b) ? nb : b, Array.isArray(a) ? na : a];
  }
  if (looksSecret(key, b) || looksSecret(key, a)) {
    stats.suspected++;
    const same = deq(b, a);
    return [isNil(b) ? b : SECRET, isNil(a) ? a : same ? SECRET : SECRET_CHANGED];
  }
  return [b, a];
}

/**
 * The configuration, reduced to what explains why values change: which resources and outputs refer
 * to what. Constant values and variable defaults are dropped because they can hold hard-coded secrets.
 */
function reportModule(m: ConfigModule): ConfigModule {
  const out: ConfigModule = {};
  if (Array.isArray(m.resources)) {
    out.resources = m.resources.map(r => ({
      address: r.address, mode: r.mode, type: r.type, name: r.name,
      expressions: refsOnly(r.expressions ?? {}) as Record<string, unknown>,
      ...(r.depends_on ? { depends_on: r.depends_on } : {}),
    }));
  }
  if (isObj(m.outputs)) out.outputs = Object.fromEntries(Object.entries(m.outputs).map(([k, o]) => [k, { expression: refsOnly(o.expression) }]));
  if (isObj(m.module_calls)) {
    out.module_calls = Object.fromEntries(Object.entries(m.module_calls).map(([k, c]) => [k, {
      source: c.source,
      expressions: refsOnly(c.expressions ?? {}) as Record<string, unknown>,
      module: reportModule(c.module ?? {}),
    }]));
  }
  return out;
}
function refsOnly(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(refsOnly);
  if (!isObj(v)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'references' && Array.isArray(x)) out[k] = x.filter(r => typeof r === 'string');
    else if (k !== 'constant_value' && x && typeof x === 'object') out[k] = refsOnly(x);
  }
  return out;
}
