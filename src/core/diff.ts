import type { Json, PathStep } from './types';
import { deq, hasTrue, isNil, isObj, joinPath, stable, sub } from './util';

export type Status = 'same' | 'add' | 'del' | 'chg';
export type NodeKind = 'leaf' | 'obj' | 'arr' | 'json' | 'text' | 'b64';

export interface LineOp {
  t: 'same' | 'add' | 'del';
  s: string;
}

/** One attribute (or nested value) in a before/after comparison. */
export interface DiffNode {
  id: string;
  key: PathStep;
  path: string;
  steps: PathStep[];
  kind: NodeKind;
  st: Status;
  b?: Json;
  a?: Json;
  /** The value after apply is unknown until apply ("known after apply"). */
  unk?: boolean;
  sensB?: boolean;
  sensA?: boolean;
  /** Looks like a secret but is not marked sensitive. */
  secret?: boolean;
  /** Listed in replace_paths: changing it forces replacement. */
  force?: boolean;
  kids?: DiffNode[];
  /** For JSON strings: the decoded values and the shape of the decoded document. */
  jb?: Json | null;
  ja?: Json | null;
  inner?: 'obj' | 'arr';
  /** Changed only in whitespace or key order. */
  fmtOnly?: boolean;
  /** For base64 strings: the decoded text. */
  db?: string | null;
  da?: string | null;
  /** For multi-line and base64 strings: line-by-line diff. */
  ops?: LineOp[];
}

interface Ctx {
  prefix: string;
  c: { n: number };
  force: Set<string>;
}

/** Longest common subsequence over two key arrays; returns matched [i, j] pairs. */
export function lcsPairs(A: string[], B: string[]): [number, number][] {
  const n = A.length, m = B.length;
  if (!n || !m) return [];
  if (n * m > 400_000) {
    // Too big for the full table: anchor the common head and tail only.
    const head: [number, number][] = [];
    let i = 0;
    while (i < n && i < m && A[i] === B[i]) { head.push([i, i]); i++; }
    const tail: [number, number][] = [];
    let a = n - 1, b = m - 1;
    while (a >= i && b >= i && A[a] === B[b]) { tail.push([a, b]); a--; b--; }
    return head.concat(tail.reverse());
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

export function lineOps(b: string | null | undefined, a: string | null | undefined): LineOp[] {
  const strip = (s: string) => (s.endsWith('\n') ? s.slice(0, -1) : s);
  if (isNil(b)) return strip(a ?? '').split('\n').map(s => ({ t: 'add' as const, s }));
  if (isNil(a)) return strip(b).split('\n').map(s => ({ t: 'del' as const, s }));
  const A = strip(b).split('\n'), B = strip(a).split('\n');
  const ops: LineOp[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of lcsPairs(A, B).concat([[A.length, B.length]])) {
    while (i < pi) ops.push({ t: 'del', s: A[i++] });
    while (j < pj) ops.push({ t: 'add', s: B[j++] });
    if (pi < A.length) { ops.push({ t: 'same', s: A[pi] }); i = pi + 1; j = pj + 1; }
  }
  return ops;
}

const B64RE = /^[A-Za-z0-9+/]+={0,2}$/;
/** Decode base64 that holds readable text (user data, scripts). Hashes and binary stay encoded. */
export function b64text(s: unknown): string | null {
  if (typeof s !== 'string' || s.length < 24 || s.length % 4 || !B64RE.test(s)) return null;
  try {
    const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const txt = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (const ch of txt) {
      const c = ch.codePointAt(0) ?? 0;
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) return null;
    }
    return /\s/.test(txt) ? txt : null;
  } catch {
    return null;
  }
}

/** Parse a string holding a JSON object or array; undefined for anything else. */
export function jsonParse(s: unknown): Json | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  if (!((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']')))) return undefined;
  try {
    const v = JSON.parse(t) as Json;
    return isObj(v) || Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

// Attribute names that usually hold secrets. Used only to warn when a value is NOT marked sensitive.
const SECRET_KEY = /(^|[^a-z])(pass(word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret|credentials?|auth[_-]?key|signing[_-]?key)([^a-z]|$)/i;
const NOT_SECRET_KEY = /(_arn|_id|_ids|_name|_length|_type|_version|_enabled|_ttl|_count|_path|_policy|_rotation|_prefix|_at|_uri|_url|_hash)$/i;
export function looksSecret(key: unknown, v: unknown): boolean {
  if (typeof key !== 'string' || typeof v !== 'string') return false;
  if (!SECRET_KEY.test(key) || NOT_SECRET_KEY.test(key)) return false;
  return v.length >= 6 && !/^(arn:|https?:\/\/|\/|\$\{)/.test(v);
}

/** True when a collapsed object or list holds a secret-looking value that isn't marked sensitive. */
function containsSecret(v: unknown, depth = 0): boolean {
  if (depth > 6 || !v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some(x => containsSecret(x, depth + 1));
  return Object.entries(v).some(([k, x]) => looksSecret(k, x) || containsSecret(x, depth + 1));
}

function leafStatus(b: unknown, a: unknown): Status {
  if (deq(b, a)) return 'same';
  if (isNil(b)) return 'add';
  if (isNil(a)) return 'del';
  return 'chg';
}
function groupStatus(kids: DiffNode[], b: unknown, a: unknown): Status {
  if (!kids.some(k => k.st !== 'same')) return 'same';
  return isNil(b) ? 'add' : isNil(a) ? 'del' : 'chg';
}

function build(ctx: Ctx, key: PathStep, path: string, steps: PathStep[], b: Json | undefined, a: Json | undefined, u?: unknown, bs?: unknown, as?: unknown): DiffNode {
  const node: DiffNode = { id: ctx.prefix + ctx.c.n++, key, path, steps, kind: 'leaf', st: 'same', b, a };
  if (ctx.force.has(JSON.stringify(steps))) node.force = true;
  if (u === true) {
    node.unk = true;
    node.a = undefined;
    node.sensB = bs === true || hasTrue(bs);
    node.sensA = as === true;
    node.st = isNil(b) ? 'add' : 'chg';
    if (!node.sensB && containsSecret(b)) node.secret = true;
    return node;
  }
  if (bs === true || as === true) {
    node.sensB = bs === true;
    node.sensA = as === true;
    node.st = leafStatus(b, a);
    return node;
  }
  const bo = isObj(b), ao = isObj(a), ba = Array.isArray(b), aa = Array.isArray(a);
  if ((bo || isNil(b)) && (ao || isNil(a)) && (bo || ao)) {
    node.kind = 'obj';
    const keys = new Set([...Object.keys(bo ? b : {}), ...Object.keys(ao ? a : {}), ...(isObj(u) ? Object.keys(u) : [])]);
    node.kids = [...keys].sort().map(k =>
      build(ctx, k, joinPath(path, k), steps.concat(k), bo ? b[k] : undefined, ao ? a[k] : undefined, sub(u, k), sub(bs, k), sub(as, k)),
    );
    node.st = groupStatus(node.kids, b, a);
    return node;
  }
  if ((ba || isNil(b)) && (aa || isNil(a)) && (ba || aa)) {
    node.kind = 'arr';
    node.kids = buildArray(ctx, path, steps, ba ? b : [], aa ? a : [], u, bs, as);
    node.st = groupStatus(node.kids, b, a);
    return node;
  }
  if ((typeof b === 'string' || isNil(b)) && (typeof a === 'string' || isNil(a)) && !(isNil(a) && isNil(b))) {
    if (buildString(ctx, node, b, a)) return node;
  }
  node.st = leafStatus(b, a);
  if (looksSecret(typeof key === 'string' ? key : '', typeof a === 'string' ? a : b) || containsSecret(b) || containsSecret(a)) node.secret = true;
  return node;
}

function similarity(x: unknown, y: unknown, yUnknown: boolean): number {
  if (yUnknown) return 0.6;
  if (isObj(x) && isObj(y)) {
    for (const idk of ['name', 'key', 'Sid', 'id']) if (x[idk] !== undefined && x[idk] === y[idk]) return 0.95;
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    if (!keys.size) return 1;
    let same = 0;
    for (const k of keys) if (deq(x[k], y[k])) same++;
    return same / keys.size;
  }
  if (typeof x === 'string' && typeof y === 'string' && (x.includes('\n') || y.includes('\n') || jsonParse(x) || jsonParse(y))) return 0.75;
  return 0;
}

/**
 * Match list elements: identical elements anchor through LCS. Between anchors, equal-length gaps
 * pair index by index (as Terraform compares lists); otherwise elements pair by similarity.
 */
function buildArray(ctx: Ctx, path: string, steps: PathStep[], B: Json[], A: Json[], u: unknown, bs: unknown, as: unknown): DiffNode[] {
  const kb = B.map(stable);
  const ka = A.map((x, j) => (hasTrue(sub(u, j)) ? '\u0000unk' + j : stable(x)));
  const out: DiffNode[] = [];
  const el = (bi: number | undefined, aj: number | undefined) => {
    const idx = (aj ?? bi) as number;
    return build(ctx, idx, joinPath(path, idx), steps.concat(idx),
      bi !== undefined ? B[bi] : undefined, aj !== undefined ? A[aj] : undefined,
      aj !== undefined ? sub(u, aj) : undefined, bi !== undefined ? sub(bs, bi) : undefined, aj !== undefined ? sub(as, aj) : undefined);
  };
  let i = 0, j = 0;
  for (const [pi, pj] of lcsPairs(kb, ka).concat([[B.length, A.length]])) {
    const gb: number[] = [], ga: number[] = [];
    while (i < pi) gb.push(i++);
    while (j < pj) ga.push(j++);
    if (gb.length && gb.length === ga.length) {
      gb.forEach((x, n) => out.push(el(x, ga[n])));
    } else if (gb.length && ga.length) {
      const cand: [number, number, number][] = [];
      for (const x of gb) for (const y of ga) {
        const s = similarity(B[x], A[y], sub(u, y) === true);
        if (s >= 0.5) cand.push([s, x, y]);
      }
      cand.sort((p, q) => q[0] - p[0] || Math.abs(p[1] - p[2]) - Math.abs(q[1] - q[2]));
      const mb = new Map<number, number>(), usedA = new Set<number>();
      for (const [, x, y] of cand) if (!mb.has(x) && !usedA.has(y)) { mb.set(x, y); usedA.add(y); }
      gb.filter(x => !mb.has(x)).forEach(x => out.push(el(x, undefined)));
      ga.forEach(y => {
        const pair = [...mb].find(([, v]) => v === y);
        out.push(pair ? el(pair[0], y) : el(undefined, y));
      });
    } else {
      gb.forEach(x => out.push(el(x, undefined)));
      ga.forEach(y => out.push(el(undefined, y)));
    }
    if (pi < B.length) { out.push(el(pi, pj)); i = pi + 1; j = pj + 1; }
  }
  return out;
}

/** JSON documents, base64 text and multi-line strings are decoded so their contents can be diffed. */
function buildString(ctx: Ctx, node: DiffNode, b: string | null | undefined, a: string | null | undefined): boolean {
  const jb = isNil(b) ? null : jsonParse(b), ja = isNil(a) ? null : jsonParse(a);
  if (jb !== undefined && ja !== undefined && (jb || ja)) {
    const inner = build({ prefix: ctx.prefix, c: ctx.c, force: new Set() }, node.key, node.path, node.steps, jb ?? undefined, ja ?? undefined);
    if (inner.kind === 'obj' || inner.kind === 'arr') {
      Object.assign(node, { kind: 'json', kids: inner.kids, inner: inner.kind, jb, ja, st: leafStatus(b, a) });
      if (node.st === 'chg' && inner.st === 'same') node.fmtOnly = true;
      return true;
    }
  }
  const tb = isNil(b) ? null : b64text(b), ta = isNil(a) ? null : b64text(a);
  if ((isNil(b) || tb !== null) && (isNil(a) || ta !== null)) {
    Object.assign(node, { kind: 'b64', db: tb, da: ta, ops: lineOps(tb, ta), st: leafStatus(b, a) });
    return true;
  }
  if ((typeof b === 'string' && b.includes('\n')) || (typeof a === 'string' && a.includes('\n'))) {
    Object.assign(node, { kind: 'text', ops: lineOps(b, a), st: leafStatus(b, a) });
    return true;
  }
  return false;
}

export interface DiffInput {
  before?: Json;
  after?: Json;
  after_unknown?: unknown;
  before_sensitive?: unknown;
  after_sensitive?: unknown;
  replace_paths?: PathStep[][];
}

/** Diff a resource's before/after values. The root is always an object node. */
export function diffChange(prefix: string, ch: DiffInput): DiffNode {
  const ctx: Ctx = { prefix, c: { n: 0 }, force: new Set((ch.replace_paths ?? []).map(p => JSON.stringify(p))) };
  const root = build(ctx, '', '', [], isNil(ch.before) ? undefined : ch.before, isNil(ch.after) ? undefined : ch.after, ch.after_unknown, ch.before_sensitive, ch.after_sensitive);
  if (root.kids) return root;
  return { id: prefix + 'root', key: '', path: '', steps: [], kind: 'obj', st: root.st, kids: [Object.assign(root, { key: 'value', path: 'value' })] };
}

/** Diff each named value (used for outputs) under one object root. */
export function diffNamed(prefix: string, items: Record<string, DiffInput>): DiffNode {
  const ctx: Ctx = { prefix, c: { n: 0 }, force: new Set() };
  const kids = Object.keys(items).sort().map(name => {
    const ch = items[name] ?? {};
    return build(ctx, name, name, [name], isNil(ch.before) ? undefined : ch.before, isNil(ch.after) ? undefined : ch.after, ch.after_unknown, ch.before_sensitive, ch.after_sensitive);
  });
  return { id: prefix + 'root', key: '', path: '', steps: [], kind: 'obj', kids, st: kids.some(k => k.st !== 'same') ? 'chg' : 'same' };
}
