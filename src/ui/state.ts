import type { Kind } from '../core/model';
import type { PlanModel } from '../core/plan';
import type { RedactStats } from '../core/redact';
import type { Plan } from '../core/types';

/** How the page was opened. `report` pages have sensitive values removed. */
export type Mode = 'live' | 'report' | 'demo' | 'file';

export interface Meta {
  mode: Mode;
  label: string;
  version?: string;
  generatedAt?: string;
  redacted?: RedactStats | null;
}

/** What the planlens command embeds in the page. */
export interface Payload {
  meta: Meta;
  plan: Plan;
}

export type Tab = 'changes' | 'drift' | 'outputs';
export type Special = 'sensitive' | 'secrets' | 'decoded' | 'destructive' | 'renames' | 'caused';

export const store = {
  get<T>(k: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // Storage can be unavailable (private windows, file:// in some browsers); the page works without it.
    }
  },
};

export const S: { pm: PlanModel | null; meta: Meta } = { pm: null, meta: { mode: 'file', label: '' } };

/** The loaded plan. Rendering only happens once a plan is loaded. */
export const P = (): PlanModel => S.pm as PlanModel;

export const ui = {
  tab: 'changes' as Tab,
  kinds: new Set<Kind>(),
  special: null as Special | null,
  q: '',
  sort: 'action' as 'action' | 'risk' | 'address',
  mode: 'split' as 'split' | 'hcl',
  showSame: false,
  reveal: false,
  openCards: new Map<string, boolean>(),
  open: new Map<string, boolean>(),
  revealed: new Set<string>(),
  cardSame: new Set<string>(),
  raw: new Set<string>(),
  reviewed: new Set<string>(),
  groups: new Map<string, boolean>(),
  focus: -1,
};

const prefs = store.get<{ mode?: string; sort?: string }>('planlens:prefs') ?? {};
if (prefs.mode === 'hcl') ui.mode = 'hcl';
if (prefs.sort === 'risk' || prefs.sort === 'address') ui.sort = prefs.sort;
export const savePrefs = (): void => store.set('planlens:prefs', { mode: ui.mode, sort: ui.sort });

/** Reset per-plan view state when a new plan is loaded. */
export function resetView(key: string): void {
  ui.kinds.clear();
  ui.special = null;
  ui.q = '';
  ui.tab = 'changes';
  ui.focus = -1;
  ui.reveal = false;
  [ui.openCards, ui.open, ui.groups].forEach(m => m.clear());
  [ui.revealed, ui.cardSame, ui.raw].forEach(s => s.clear());
  ui.reviewed = new Set(store.get<string[]>(key) ?? []);
}
