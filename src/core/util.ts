import type { Json, PathStep } from './types';

export const isObj = (v: unknown): v is Record<string, Json> => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isNil = (v: unknown): v is null | undefined => v === null || v === undefined;
export const isEmptyColl = (v: unknown): boolean => (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
export const plural = (n: number, one: string, many?: string): string => `${n} ${n === 1 ? one : many ?? one + 's'}`;

/** JSON with sorted keys, so equal values always serialize the same way. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return v === undefined ? 'null' : JSON.stringify(v);
}
export const deq = (a: unknown, b: unknown): boolean => a === b || stable(a) === stable(b);

/** Step into one of Terraform's mirror structures (after_unknown, *_sensitive). `true` covers everything below it. */
export function sub(s: unknown, k: PathStep): unknown {
  if (s === true) return true;
  if (s && typeof s === 'object') return (s as Record<string, unknown>)[k as string];
  return undefined;
}
export const hasTrue = (s: unknown): boolean => s === true || (!!s && typeof s === 'object' && Object.values(s).some(hasTrue));

export const joinPath = (p: string, k: PathStep): string => (typeof k === 'number' ? `${p}[${k}]` : p ? `${p}.${k}` : String(k));
export const fmtSteps = (steps: PathStep[]): string => steps.reduce<string>((p, k) => joinPath(p, k), '');
export const andList = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

export function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export interface ParsedAddress {
  module: string;
  mode: string;
  type: string;
  name: string;
  index?: string | number;
}

/** Split `module.a["x"].data.aws_ami.web[0]` into module path, mode, type, name and index. */
export function parseAddr(addr: string): ParsedAddress {
  const parts: string[] = [];
  let cur = '', depth = 0, inq = false;
  for (let i = 0; i < addr.length; i++) {
    const c = addr[i];
    if (inq) {
      cur += c;
      if (c === '\\') cur += addr[++i] ?? '';
      else if (c === '"') inq = false;
      continue;
    }
    if (c === '"') { inq = true; cur += c; continue; }
    if (c === '[') depth++;
    if (c === ']') depth--;
    if (c === '.' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  let i = 0;
  const mods: string[] = [];
  while (parts[i] === 'module' && i + 1 < parts.length) { mods.push('module.' + parts[i + 1]); i += 2; }
  let mode = 'managed';
  if (parts[i] === 'data') { mode = 'data'; i++; }
  const type = parts[i] ?? addr;
  const nameIdx = parts.slice(i + 1).join('.');
  let name = nameIdx;
  let index: string | number | undefined;
  const b = nameIdx.indexOf('[');
  if (b >= 0) {
    name = nameIdx.slice(0, b);
    const raw = nameIdx.slice(b + 1, -1);
    try { index = raw.startsWith('"') ? (JSON.parse(raw) as string) : Number(raw); } catch { index = raw; }
  }
  return { module: mods.join('.'), mode, type, name, index };
}
