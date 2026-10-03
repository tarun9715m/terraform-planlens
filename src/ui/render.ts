import type { DiffNode, LineOp, Status } from '../core/diff';
import { causeFrom, movedBlock } from '../core/insight';
import {
  ACTION_ORDER, CONTEXT, GROUP_LABEL, KIND, SHORT, SINGLE, byAction, byAddr, byRisk, kindGlyph, reasonParts, treeOf,
  type Cause, type Kind, type Res, type Warning,
} from '../core/model';
import { tfPlanLine } from '../core/plan';
import type { Json } from '../core/types';
import { isNil, isObj, plural, sub } from '../core/util';
import { $, CARET, CHECK, COPY, codeHTML, esc, fmtTime } from './dom';
import { P, S, ui, type Special } from './state';

const MK: Record<string, string> = { add: '+', del: '-', chg: '~', same: '' };
const ST_LABEL: Record<Status, string> = { add: 'added', del: 'removed', chg: 'changed', same: 'unchanged' };
const SPECIAL: Record<Special, string> = { sensitive: 'Sensitive value changes', secrets: 'Unmarked secrets', decoded: 'Decoded values', destructive: 'Destroy or replace', renames: 'Possible renames', caused: 'Caused by other changes' };
const TILE: Record<string, string> = { create: 'To create', update: 'To update in place', replace: 'To replace', delete: 'To destroy' };

/** A report normally has its sensitive values removed, so there is nothing to reveal. */
const canReveal = (): boolean => !(S.meta.mode === 'report' && S.meta.redacted);
const reasonHTML = (r: Res): string => { const [v, t] = reasonParts(r, P()); return `<b>${esc(v)}</b>${codeHTML(t)}`; };

/* ---------- filtering ---------- */

export function visibleRes(): Res[] {
  const pm = P(), q = ui.q.trim().toLowerCase();
  let list = pm.model.filter(r => (ui.kinds.size ? ui.kinds.has(r.kind) : r.kind !== 'noop'));
  if (ui.special) list = list.filter(r => matchSpecial(r, ui.special as Special));
  if (q) list = list.filter(r => r.address.toLowerCase().includes(q) || (r.st?.paths.some(p => p.toLowerCase().includes(q)) ?? false));
  return list.sort(ui.sort === 'risk' ? byRisk : ui.sort === 'address' ? byAddr : byAction);
}
function matchSpecial(r: Res, sp: Special): boolean {
  if (sp === 'destructive') return r.destructive;
  if (sp === 'renames') return !!(r.renameTo || r.renameOf);
  if (sp === 'caused') return causeFrom(r).length > 0;
  if (!r.st) return false;
  return sp === 'sensitive' ? r.st.sensChanged > 0 : sp === 'secrets' ? r.st.secrets.length > 0 : r.st.decoded > 0;
}

// One filter, two controls: the summary tiles at the top and the Show dropdown above the list.
export function kindValue(): string {
  if (!ui.kinds.size) return 'all';
  if (ui.kinds.size === 1) return [...ui.kinds][0];
  if (ui.kinds.size === 2 && ui.kinds.has('delete') && ui.kinds.has('replace')) return 'destructive';
  return 'custom';
}
export function setKinds(v: string): void {
  ui.kinds.clear();
  if (v === 'destructive') (['delete', 'replace'] as Kind[]).forEach(k => ui.kinds.add(k));
  else if (v in KIND) ui.kinds.add(v as Kind);
  ui.tab = 'changes';
  ui.focus = -1;
  renderView();
}

/* ---------- page sections ---------- */

export function renderAll(): void {
  renderHeader();
  renderSummary();
  renderInsights();
  renderView();
}
export function renderView(): void {
  renderSummaryPressed();
  renderTabs();
  renderToolbar();
  renderNav();
  renderMain();
}

function renderHeader(): void {
  const pm = P(), p = pm.plan, m = S.meta;
  const bits = [`<span class="src-name">${esc(m.label)}</span>`];
  if (p.terraform_version) bits.push(`<span>Terraform ${esc(p.terraform_version)}</span>`);
  if (p.format_version) bits.push(`<span>format ${esc(p.format_version)}</span>`);
  if (p.timestamp) bits.push(`<span>planned ${esc(fmtTime(p.timestamp))}</span>`);
  $('#source').innerHTML = bits.join('<span class="dot" aria-hidden="true">/</span>');
  const note = $('#note');
  const red = m.redacted;
  note.innerHTML = {
    live: `<b>${esc(m.label)}</b> is open from your computer. This page is served only to this browser, at 127.0.0.1, and makes no network requests. Sensitive values stay masked until you reveal them.`,
    report: `<b>Report</b> made by planlens${m.version ? ' ' + esc(m.version) : ''}${m.generatedAt ? ' on ' + esc(fmtTime(m.generatedAt)) : ''}. ${red ? `${plural(red.sensitive, 'sensitive value')} and ${plural(red.suspected, 'value that looks like a secret', 'values that look like secrets')} were removed.` : '<b>It contains sensitive values in plain text</b>, so treat it like a secret.'}`,
    demo: '<b>Demo plan.</b> An illustrative AWS stack, so you can try planlens. To view your own plan, run <code>planlens tfplan</code> in your Terraform directory.',
    file: `<b>${esc(m.label)}</b> was read in this browser tab and never uploaded. Sensitive values stay masked until you reveal them.`,
  }[m.mode];
  note.hidden = false;
  const flags: string[] = [];
  if (p.errored) flags.push('Terraform hit errors while planning, so this plan is incomplete and cannot be applied.');
  else if (p.applyable === false) flags.push('Terraform marked this plan as not applyable.');
  if (p.complete === false) flags.push('This plan is incomplete: -target was used or some changes were deferred to a later plan.');
  if (Array.isArray(p.deferred_changes) && p.deferred_changes.length) flags.push(`${plural(p.deferred_changes.length, 'change')} deferred until more values are known.`);
  if (pm.g.actions) flags.push(`${plural(pm.g.actions, 'action invocation')} planned (Terraform actions). planlens doesn't show their details yet.`);
  if (!pm.cfg && pm.model.some(r => r.kind !== 'noop')) flags.push("This plan JSON has no configuration section, so planlens can't show why values change.");
  $('#flags').innerHTML = flags.map(f => `<p class="flag">${esc(f)}</p>`).join('');
  $('#flags').hidden = !flags.length;
}

function renderSummary(): void {
  const pm = P(), g = pm.g, c = g.c, renames = pm.renames.length;
  const subs: Record<string, string> = {
    create: c.create ? [g.recreated && `${g.recreated} deleted outside Terraform`, renames && `${renames} look like renames`].filter(Boolean).join(' · ') || 'new resources' : 'nothing new',
    update: c.update ? (g.updDrift ? `${g.updDrift} also drifted` : 'changed in place') : 'nothing changes in place',
    replace: c.replace ? [g.stateRep && `${g.stateRep} ${g.stateRep === 1 ? 'holds' : 'hold'} data`, g.cbd && `${g.cbd} created first`].filter(Boolean).join(' · ') || 'destroyed, then recreated' : 'nothing replaced',
    delete: c.delete ? [g.stateDel && `${g.stateDel} ${g.stateDel === 1 ? 'holds' : 'hold'} data`, renames && `${renames} look like renames`].filter(Boolean).join(' · ') || 'removed for good' : 'nothing destroyed',
  };
  const main: Kind[] = ['create', 'update', 'replace', 'delete'];
  const tiles = main.map(k => `<button type="button" class="tile k-${k}" data-act="kind" data-kind="${k}" aria-pressed="false"><span class="t-top"><span class="sw" aria-hidden="true"></span><span>${TILE[k]}</span><span class="t-g" aria-hidden="true">${esc(kindGlyph(k))}</span></span><span class="t-n${c[k] ? '' : ' zero'}">${c[k]}</span><span class="t-s">${esc(subs[k])}</span></button>`).join('');
  const minor = (['import', 'move', 'forget', 'read', 'noop'] as Kind[]).filter(k => c[k]).map(k => `<button type="button" class="mchip k-${k}" data-act="kind" data-kind="${k}" aria-pressed="false"><span class="g" aria-hidden="true">${esc(KIND[k].g)}</span><b>${c[k]}</b> ${k === 'noop' ? 'unchanged' : esc(KIND[k].label)}</button>`);
  if (pm.drift.length) minor.push(`<button type="button" class="mchip k-info" data-act="tab" data-v="drift"><span class="g" aria-hidden="true">!</span><b>${pm.drift.length}</b> drifted outside Terraform</button>`);
  const total = main.reduce((n, k) => n + c[k], 0);
  const bar = total
    ? `<div class="stack" role="group" aria-label="Changes by action">${main.filter(k => c[k]).map(k => `<button type="button" class="bar-seg k-${k}" style="--n:${c[k]}" data-act="kind" data-kind="${k}" aria-label="Show the ${c[k]} ${TILE[k].toLowerCase().replace('to ', 'resources to ')}" data-tip="${c[k]} ${TILE[k].toLowerCase()} (${Math.round((c[k] / total) * 100)}%) · click to show them"></button>`).join('')}</div>`
    : '';
  const rep = c.replace - pm.model.filter(r => r.forgetOld).length;
  const expl = total
    ? rep ? ` ${rep === 1 ? 'One add and one destroy are' : `${rep} of those adds and ${rep} of those destroys are`} the same ${rep === 1 ? 'resource' : 'resources'} being replaced.` : ''
    : ' Your infrastructure already matches the configuration.';
  $('#summary').innerHTML = `<div class="tiles">${tiles}</div>${minor.length ? `<div class="minor"><span class="lbl">Also:</span>${minor.join('')}</div>` : ''}${bar}<p class="tfline"><code>terraform plan</code> would print <code>${esc(tfPlanLine(g))}</code>${esc(expl)}</p>`;
}
function renderSummaryPressed(): void {
  document.querySelectorAll<HTMLElement>('#summary [data-act="kind"]').forEach(b => b.setAttribute('aria-pressed', String(ui.kinds.has(b.dataset.kind as Kind))));
}

function badge(r: Res, sm?: boolean): string {
  const label = r.drift ? (r.kind === 'delete' ? 'deleted outside' : 'changed outside') : KIND[r.kind].label;
  const k = r.drift ? 'info' : r.kind;
  const g = r.drift ? (r.kind === 'delete' ? '-' : '~') : r.glyph;
  return `<span class="badge k-${k}${sm ? ' sm' : ''}"><span class="g" aria-hidden="true">${esc(g)}</span>${esc(label)}</span>`;
}
const chipHTML = (w: Warning): string => `<span class="chip ${w.c ?? ''}">${w.code ? `<code>${esc(w.t)}</code>` : esc(w.t)}</span>`;

/* Review panel: every change grouped by action; all groups start collapsed. */
function reviewItem(r: Res): string {
  const chips = r.warn.map(chipHTML);
  if (r.renameTo) chips.push(`<span class="chip caution">looks like a rename to <code>${esc(r.renameTo.address)}</code></span>`);
  if (r.renameOf) chips.push(`<span class="chip caution">same settings as <code>${esc(r.renameOf.address)}</code></span>`);
  const from = causeFrom(r);
  if (from.length) chips.push(`<span class="chip info">caused by <code>${esc(from.map(t => t.addr).join(', '))}</code></span>`);
  if (r.affects.length) chips.push(`<span class="chip info">affects ${plural(r.affects.length, 'other change')}</span>`);
  return `<li><button type="button" class="risk-item k-${r.kind}" data-act="jump" data-id="${r.id}"><span class="ri-g" aria-hidden="true">${esc(r.glyph)}</span><span class="ri-main"><span class="ri-addr">${esc(r.address)}</span><span class="ri-why">${reasonHTML(r)}</span>${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}</span></button></li>`;
}
function groupNote(k: string, rs: Res[]): string {
  const pm = P();
  const n = (f: (r: Res) => unknown) => rs.filter(f).length;
  const drifted = (r: Res) => pm.driftByAddr.has(r.address);
  const parts: Record<string, (string | 0 | false)[]> = {
    delete: [n(r => r.stateful) && `${n(r => r.stateful)} hold data`, n(r => r.renameTo) && `${n(r => r.renameTo)} look like renames`],
    replace: [n(r => r.stateful) && `${n(r => r.stateful)} hold data`, n(r => r.cbd) && `${n(r => r.cbd)} created first`, n(r => !r.cbd) && `${n(r => !r.cbd)} destroyed first`],
    update: [n(drifted) && `${n(drifted)} also drifted`, n(r => causeFrom(r).length) && `${n(r => causeFrom(r).length)} caused by other changes`],
    create: [n(r => r.renameOf) && `${n(r => r.renameOf)} look like renames`, n(drifted) && `${n(drifted)} deleted outside Terraform`],
    others: (['read', 'import', 'move', 'forget', 'other'] as Kind[]).map(x => n(r => r.kind === x) && `${n(r => r.kind === x)} ${KIND[x].label}`),
  };
  return (parts[k] ?? []).filter(Boolean).join(' · ');
}
export function renderInsights(): void {
  const pm = P(), g = pm.g;
  const groups: [string, Res[]][] = (['delete', 'replace', 'update', 'create'] as Kind[]).map(k => [k, pm.model.filter(r => r.kind === k).sort(byRisk)]);
  const others = pm.model.filter(r => ['read', 'import', 'move', 'forget', 'other'].includes(r.kind)).sort(byAddr);
  if (others.length) groups.push(['others', others]);
  const destructive = pm.model.filter(r => r.destructive).length;
  const rOpen = ui.groups.get('renames') === true;
  const nR = pm.renames.length;
  const renames = !nR ? '' : `<div class="rgroup"><button type="button" class="rg-h" data-act="rgroup" data-v="renames" aria-expanded="${rOpen}">${CARET}<span class="badge sm k-update"><span class="g" aria-hidden="true">→</span>Possible renames</span><b class="rg-n">${nR}</b><span class="rg-note">destroyed and recreated unless you add moved blocks</span></button>${!rOpen ? '' : `<div class="renames"><p><b>${plural(nR, 'destroy', 'destroys')} ${nR === 1 ? 'looks' : 'look'} like ${nR === 1 ? 'a rename' : 'renames'}.</b> A resource with the same settings is created at a new address. If it's the same resource, a <code>moved</code> block keeps it instead of destroying it.</p><ul>${pm.renames.map(p => `<li><button type="button" class="lk mono" data-act="jump" data-id="${p.from.id}">${esc(p.from.address)}</button><span aria-hidden="true">→</span><button type="button" class="lk mono" data-act="jump" data-id="${p.to.id}">${esc(p.to.address)}</button></li>`).join('')}</ul><div><button type="button" class="btn sm" data-act="copy-moved-all">Copy ${nR === 1 ? 'moved block' : `all ${nR} moved blocks`}</button></div></div>`}</div>`;
  const body = groups.filter(([, rs]) => rs.length).map(([k, rs]) => {
    const open = ui.groups.get(k) === true;
    const kc = k === 'others' ? 'other' : k;
    const note = groupNote(k, rs);
    return `<div class="rgroup"><button type="button" class="rg-h" data-act="rgroup" data-v="${k}" aria-expanded="${open}">${CARET}<span class="badge sm k-${kc}"><span class="g" aria-hidden="true">${esc(k === 'others' ? '…' : kindGlyph(k as Kind))}</span>${esc(k === 'others' ? 'Other' : GROUP_LABEL[k as Kind])}</span><b class="rg-n">${rs.length}</b>${note ? `<span class="rg-note">${esc(note)}</span>` : ''}</button>${open ? `<ul class="risk-list">${rs.map(reviewItem).join('')}</ul>` : ''}</div>`;
  }).join('');
  const keys = (nR ? ['renames'] : []).concat(groups.filter(([, rs]) => rs.length).map(([k]) => k));
  const allOpen = keys.every(k => ui.groups.get(k) === true);
  const toggleAll = keys.length > 1 ? `<button type="button" class="lk" data-act="rgroups" data-v="${allOpen ? 'close' : 'open'}">${allOpen ? 'Collapse all groups' : 'Expand all groups'}</button>` : '';
  const left = `<div class="panel-h"><h2>Review by action<span class="p-note">${destructive ? `${plural(destructive, 'destructive change')} first` : 'nothing is destroyed or replaced'}</span></h2>${toggleAll}</div>${renames}${body || '<p class="ok">No changes in this plan.</p>'}`;
  const rows: [number, string, string][] = [];
  if (g.hidden) rows.push([g.hidden, 'unchanged attributes inside changed resources. <code>terraform plan</code> collapses them into <code># (N unchanged attributes hidden)</code>.', `<button type="button" class="lk" data-act="same-all">${ui.showSame ? 'Hide them' : 'Show them'}</button>`]);
  if (g.sens) rows.push([g.sens, `sensitive values, printed only as <code>(sensitive value)</code>. ${g.sensChanged} of them change in this plan${canReveal() ? '; you can reveal any of them here' : ''}.`, g.sensChanged ? '<button type="button" class="lk" data-act="special" data-v="sensitive">Show the changes</button>' : '']);
  if (g.renames) rows.push([g.renames, `${g.renames === 1 ? 'destroy looks' : 'destroys look'} like ${g.renames === 1 ? 'a rename' : 'renames'}. <code>terraform plan</code> shows each one as an unrelated destroy and create.`, '<button type="button" class="lk" data-act="special" data-v="renames">Show them</button>']);
  if (g.caused) rows.push([g.caused, `${g.caused === 1 ? 'resource changes' : 'resources change'} because another resource is changing. <code>terraform plan</code> doesn't say why a value changes.`, '<button type="button" class="lk" data-act="special" data-v="caused">Show them</button>']);
  if (g.driftHidden) rows.push([g.driftHidden, `${g.driftHidden === 1 ? 'change' : 'changes'} made outside Terraform that <code>terraform plan</code> doesn't print, because ${g.driftHidden === 1 ? "it doesn't" : "they don't"} feed into this plan.`, '<button type="button" class="lk" data-act="tab" data-v="drift">Open drift</button>']);
  if (g.secrets) rows.push([g.secrets, `${g.secrets === 1 ? 'value looks' : 'values look'} like a secret but ${g.secrets === 1 ? "isn't" : "aren't"} marked sensitive, so <code>terraform plan</code> prints ${g.secrets === 1 ? 'it' : 'them'} in plain text, including in CI logs.`, '<button type="button" class="lk" data-act="special" data-v="secrets">Show where</button>']);
  if (g.decoded) rows.push([g.decoded, `encoded ${g.decoded === 1 ? 'value' : 'values'} (base64 user data, JSON documents) decoded so you can read what changes inside.`, '<button type="button" class="lk" data-act="special" data-v="decoded">Show where</button>']);
  const right = `<h2>What <code>terraform plan</code> hides<span class="p-note">all visible here</span></h2>${rows.length ? `<ul class="hide-list">${rows.map(([n, t, a]) => `<li class="hide-item"><span class="hi-n">${n}</span><span class="hi-t">${t} ${a}</span></li>`).join('')}</ul>` : '<p class="ok">Nothing in this plan is hidden by the default output.</p>'}`;
  $('#insights').innerHTML = `<div class="panel">${left}</div><div class="panel">${right}</div>`;
}

export function renderTabs(): void {
  const pm = P();
  const n = pm.model.filter(r => r.kind !== 'noop').length;
  const no = (pm.outputs.kids ?? []).filter(k => k.st !== 'same').length;
  const tabs: [string, string, number, string][] = [['changes', 'Changes', n, ''], ['drift', 'Drift', pm.drift.length, pm.g.driftHidden ? `${pm.g.driftHidden} not in plan output` : ''], ['outputs', 'Outputs', no, '']];
  $('#tabs').innerHTML = tabs.map(([k, l, c, note]) => `<button type="button" class="tab" role="tab" aria-selected="${ui.tab === k}" data-act="tab" data-v="${k}">${l}<span class="n">${c}</span>${note ? `<span class="tab-note">${esc(note)}</span>` : ''}</button>`).join('');
}

const segCtl = (act: string, opts: [string, string][], cur: string, label: string): string => `<div class="sgc" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
const tglBtn = (act: string, label: string, on: boolean): string => `<button type="button" class="tgl" data-act="${act}" aria-pressed="${on}"><span class="box" aria-hidden="true"></span>${label}</button>`;
export function renderToolbar(): void {
  const pm = P(), rows: string[] = [];
  if (ui.tab === 'changes') {
    const c = pm.g.c, nonNoop = pm.model.filter(r => r.kind !== 'noop').length;
    const extra: string[] = [];
    if (ui.special) extra.push(`<button type="button" class="fchip" data-act="special" data-v="${ui.special}" aria-label="Remove filter">${esc(SPECIAL[ui.special])}<span class="x" aria-hidden="true">×</span></button>`);
    if (ui.q.trim()) extra.push(`<span class="fchip static">matching “${esc(ui.q.trim())}”</span>`);
    const filtered = ui.kinds.size || ui.special || ui.q.trim();
    const opts: [string, string][] = [['all', `All changes (${nonNoop})`]];
    if (c.delete && c.replace) opts.push(['destructive', `Destroy and replace (${c.delete + c.replace})`]);
    ACTION_ORDER.filter(k => c[k] || ui.kinds.has(k)).forEach(k => opts.push([k, `${k === 'noop' ? 'Unchanged' : GROUP_LABEL[k]} (${c[k]})`]));
    const cur = kindValue();
    if (cur === 'custom') opts.push(['custom', `${[...ui.kinds].map(k => SHORT[k]).join(' + ')} (${pm.model.filter(r => ui.kinds.has(r.kind)).length})`]);
    const select = `<label class="kfilter"><span class="tb-l">Show</span><select class="select" id="kindSel" aria-label="Which changes to show">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    rows.push(`<div class="tb-row">${select}<span class="count"><b>${visibleRes().length}</b> of ${pm.model.length} resources${!ui.kinds.size && c.noop ? ` · ${c.noop} unchanged not shown` : ''}</span>${extra.join('')}${filtered ? '<button type="button" class="lk" data-act="clear">Clear filters</button>' : ''}</div>`);
  }
  const ctl: string[] = [];
  if (ui.tab === 'changes') ctl.push(segCtl('sort', [['action', 'By action'], ['risk', 'Riskiest first'], ['address', 'By address']], ui.sort, 'Order'));
  if (ui.tab !== 'outputs') ctl.push(segCtl('mode', [['split', 'Side by side'], ['hcl', 'Plan style']], ui.mode, 'Diff layout'));
  ctl.push(tglBtn('same-all', 'Show unchanged', ui.showSame));
  if (canReveal()) ctl.push(tglBtn('reveal-all', 'Reveal sensitive', ui.reveal));
  if (ui.tab !== 'outputs') ctl.push('<span class="tb-gap"></span><button type="button" class="lk" data-act="expand">Expand all</button><button type="button" class="lk" data-act="collapse">Collapse all</button>');
  rows.push(`<div class="tb-row">${ctl.join('')}</div>`);
  $('#toolbar').innerHTML = rows.join('');
}

export function renderNav(): void {
  const pm = P();
  const actionable = pm.model.filter(r => r.kind !== 'noop');
  const done = actionable.filter(r => ui.reviewed.has(r.address)).length;
  const pct = actionable.length ? Math.round((done / actionable.length) * 100) : 0;
  $('#progress').innerHTML = `<div class="pl"><span>Reviewed</span><b>${done} of ${actionable.length}</b></div><div class="pbar" role="progressbar" aria-label="Review progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`;
  const src = ui.tab === 'changes' ? visibleRes() : actionable;
  const groups = new Map<string, Res[]>();
  for (const r of [...src].sort(byAddr)) {
    const m = r.module || '';
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m)!.push(r);
  }
  const mods = [...groups.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  $('#tree').innerHTML = mods.length ? mods.map(m => {
    const rs = groups.get(m)!;
    const counts = (['create', 'update', 'replace', 'delete'] as Kind[]).map(k => [k, rs.filter(r => r.kind === k).length] as const).filter(([, n]) => n).map(([k, n]) => `<span class="k-${k}">${esc(k === 'replace' ? '±' : KIND[k].g)}${n}</span>`).join('');
    return `<div class="tg"><div class="tg-h"><span>${m ? esc(m) : 'root module'}</span><span class="tg-c">${counts}</span></div><ul class="tg-l">${rs.map(r => {
      const rev = ui.reviewed.has(r.address);
      return `<li><button type="button" class="ti k-${r.kind}${rev ? ' done' : ''}" data-act="jump" data-id="${r.id}" title="${esc(r.address)}"><span class="g" aria-hidden="true">${esc(r.glyph)}</span><span class="ta">${esc(r.local)}</span><span class="ck">${rev ? CHECK : ''}</span></button></li>`;
    }).join('')}</ul></div>`;
  }).join('') : '<p class="tree-empty">No resources match.</p>';
}

/* ---------- cards ---------- */

interface BodyOpts {
  single: boolean;
  neutral: boolean;
  allSame: boolean;
  side: 'a' | 'b';
  showSame: boolean;
  mode: 'split' | 'hcl';
  labels: string[];
  noun?: string;
}
/** Anything rows can belong to: a resource, or the outputs table. */
interface Owner {
  id: string;
  causes?: Map<string | number, Cause[]>;
}

export function cardOpen(r: Res): boolean {
  if (ui.openCards.has(r.id)) return ui.openCards.get(r.id) as boolean;
  if (!r.drift && ui.reviewed.has(r.address)) return false;
  return !!r.drift || r.kind === 'replace' || r.kind === 'update';
}
function bodyOpts(r: Res): BodyOpts {
  const k = r.kind, single = r.drift ? k === 'delete' : SINGLE.has(k);
  const neutral = !r.drift && (k === 'import' || k === 'move' || k === 'noop' || k === 'forget');
  const labels = r.drift
    ? single ? ['Last known state'] : ['Last applied state', 'Real infrastructure now']
    : single ? [k === 'create' || k === 'read' ? 'Planned value' : k === 'delete' ? 'Current value' : 'Value'] : ['Before', 'After'];
  return { single, neutral, allSame: neutral, side: !r.drift && (k === 'create' || k === 'read') ? 'a' : 'b', showSame: ui.showSame || ui.cardSame.has(r.id), mode: ui.mode, labels };
}
function addrHTML(r: Res): string {
  if (!r.type) return esc(r.address);
  const mod = r.module ? `<span class="mod">${esc(r.module)}.</span>` : '';
  const dm = r.mode === 'data' ? '<span class="dm">data.</span>' : '';
  const ix = isNil(r.index) ? '' : `<span class="ix">[${esc(typeof r.index === 'string' ? JSON.stringify(r.index) : r.index)}]</span>`;
  const dep = r.deposed ? ` <span class="mod">(deposed ${esc(r.deposed)})</span>` : '';
  return `${mod}${dm}<span class="rt">${esc(r.type)}</span>.<span class="rn">${esc(r.name)}</span>${ix}${dep}`;
}
function statsHTML(r: Res): string {
  const s = r.st, k = r.kind, out: string[] = [];
  if (!s) return '';
  if (r.drift) out.push(`${plural(s.changed + s.unknown, 'attribute')} differ`);
  else if (k === 'create' || k === 'read') {
    out.push(`${plural(s.attrs - s.unknown, 'value')} set`);
    if (s.unknown) out.push(`${s.unknown} known after apply`);
  } else if (k === 'delete' || k === 'forget') out.push(plural(s.attrs, 'attribute'));
  else if (k === 'import' || k === 'move' || k === 'noop') out.push('no attribute changes');
  else {
    out.push(`${s.changed} changed`);
    if (s.force.length) out.push(`${s.force.length} ${s.force.length === 1 ? 'forces' : 'force'} replacement`);
    if (s.unknown) out.push(`${s.unknown} known after apply`);
    if (s.hidden) out.push(`${s.hidden} unchanged hidden`);
  }
  if (s.sens) out.push(`${s.sens} sensitive`);
  return `<div class="stats">${out.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
}
function cardChips(r: Res): string {
  const pm = P(), out: Warning[] = r.warn.slice();
  if (r.cbd) out.push({ t: 'create before destroy', c: 'info' });
  if (r.forgetOld) out.push({ t: 'old object kept', c: 'info' });
  if (r.moved && r.kind !== 'move' && !r.drift) out.push({ t: `moved from ${r.rc.previous_address}`, c: 'info', code: true });
  if (r.imported && r.kind !== 'import') out.push({ t: 'imported', c: 'info' });
  if (r.st?.secrets.length) out.push({ t: `unmarked secret: ${r.st.secrets.join(', ')}`, c: 'caution' });
  if (r.st?.sensChanged) out.push({ t: `${plural(r.st.sensChanged, 'sensitive value')} changed` });
  const chips = out.map(chipHTML);
  if (r.renameOf) chips.push(`<button type="button" class="chip caution" data-act="jump" data-id="${r.renameOf.id}">same settings as <code>${esc(r.renameOf.address)}</code>, which is destroyed · view</button>`);
  if (r.drift) {
    chips.push(`<span class="chip${r.relevant ? '' : ' info'}">${r.relevant ? 'printed by terraform plan' : 'not printed by terraform plan'}</span>`);
    const p = pm.model.find(x => x.address === r.address);
    if (p && p.kind !== 'noop') chips.push(`<button type="button" class="chip" data-act="jump" data-id="${p.id}">planned: ${esc(KIND[p.kind].label)} · view</button>`);
  } else {
    const d = pm.driftByAddr.get(r.address);
    if (d) chips.push(`<button type="button" class="chip info" data-act="drift-of" data-id="${d.id}">${d.kind === 'delete' ? 'deleted' : 'changed'} outside Terraform · view</button>`);
  }
  return chips.length ? `<div class="chips">${chips.join('')}</div>` : '';
}
function masked(v: unknown, s: unknown): unknown {
  if (s === true) return ui.reveal ? v : '(sensitive value)';
  if (Array.isArray(v)) return v.map((x, i) => masked(x, sub(s, i)));
  if (isObj(v)) return Object.fromEntries(Object.keys(v).map(k => [k, masked(v[k], sub(s, k))]));
  return v;
}
function maskedRC(r: Res): unknown {
  const ch = r.rc.change ?? { actions: [] };
  return { ...r.rc, change: { ...ch, before: masked(ch.before, ch.before_sensitive), after: masked(ch.after, ch.after_sensitive) } };
}
function causeTags(o: Owner, key: string | number): string {
  const tags = o.causes?.get(key);
  if (!tags) return '';
  return tags.map(t => (t.t === 'from'
    ? `<button type="button" class="tag cause" data-act="jump" data-id="${t.ids?.[0] ?? ''}" title="Comes from ${esc(t.addr)}, which also changes in this plan">← ${esc(t.addr)}</button>`
    : t.t === 'source'
      ? `<span class="tag src" title="This value comes from a data source">from ${esc(t.addr)}</span>`
      : '<span class="tag drift" title="Someone changed this outside Terraform; this plan sets it back to the configured value">reverts manual change</span>')).join('');
}
function causeComments(o: Owner, key: string | number): string {
  const tags = o.causes?.get(key);
  if (!tags) return '';
  return tags.map(t => ` <span class="cm cause"># ${t.t === 'from' ? '← ' + esc(t.addr) : t.t === 'source' ? 'from ' + esc(t.addr) : 'reverts manual change'}</span>`).join('');
}
function impactHTML(r: Res): string {
  const parts: string[] = [], from = causeFrom(r);
  if (from.length) parts.push('<span class="il">Caused by</span>' + from.map(t => `<button type="button" class="chip link" data-act="jump" data-id="${t.ids?.[0] ?? ''}">← ${esc(t.addr)}</button>`).join(''));
  if (r.affects.length) parts.push('<span class="il">Affects</span>' + r.affects.map(a => (a.id
    ? `<button type="button" class="chip link" data-act="jump" data-id="${a.id}">→ ${esc(a.label)}</button>`
    : `<button type="button" class="chip link" data-act="tab" data-v="outputs">→ ${esc(a.label)}</button>`)).join(''));
  return parts.length ? `<div class="impact">${parts.join('')}</div>` : '';
}
function renameHTML(r: Res): string {
  if (!r.renameTo) return '';
  const p = { from: r, to: r.renameTo };
  return `<div class="rename"><p><b>Looks like a rename.</b> <code>${esc(p.to.address)}</code> is created with the same settings. If it's the same resource, add this block to your configuration so Terraform keeps it instead of destroying it:</p><pre>${esc(movedBlock(p))}</pre><div><button type="button" class="btn sm" data-act="copy-moved" data-id="${r.id}">Copy moved block</button></div></div>`;
}
export function cardHTML(r: Res): string {
  const open = cardOpen(r), o = bodyOpts(r), rev = !r.drift && ui.reviewed.has(r.address);
  const reason = r.drift ? `<b>${r.kind === 'delete' ? 'Deleted outside Terraform' : 'Changed outside Terraform'}</b> since the last apply.` : reasonHTML(r);
  const hid = r.st?.hidden ?? 0;
  const foot: string[] = [];
  if (!ui.showSame && hid && ui.cardSame.has(r.id)) foot.push(`<button type="button" class="lk" data-act="card-same" data-id="${r.id}">Hide unchanged attributes</button>`);
  foot.push(`<button type="button" class="lk" data-act="raw" data-id="${r.id}">${ui.raw.has(r.id) ? 'Hide raw JSON' : 'Raw JSON'}</button>`);
  const body = open
    ? `<div class="card-b" id="body-${r.id}">${diffHTML(r, treeOf(r), o)}${ui.raw.has(r.id) ? `<pre class="raw">${esc(JSON.stringify(maskedRC(r), null, 2))}</pre>` : ''}</div><div class="card-f">${foot.join('')}</div>`
    : '';
  return `<article class="card k-${r.drift ? 'info' : r.kind}${rev ? ' reviewed' : ''}" id="card-${r.id}" data-id="${r.id}">`
    + `<div class="card-h"><button type="button" class="card-toggle" data-act="toggle" data-id="${r.id}" aria-expanded="${open}">${CARET}${badge(r)}<span class="addr">${addrHTML(r)}</span></button>`
    + `<div class="card-tools"><button type="button" class="ibtn" data-act="copy" data-id="${r.id}" aria-label="Copy address" title="Copy address">${COPY}</button>`
    + (r.drift ? '' : `<label class="rev"><input type="checkbox" data-act="review" data-id="${r.id}"${rev ? ' checked' : ''}>Reviewed</label>`)
    + `</div></div><div class="card-meta"><p class="reason">${reason}</p>${cardChips(r)}${r.drift ? '' : impactHTML(r)}${renameHTML(r)}${statsHTML(r)}</div>${body}</article>`;
}

/* ---------- side-by-side diff ---------- */

const isOpenNode = (n: DiffNode, o: BodyOpts): boolean => (ui.open.has(n.id) ? (ui.open.get(n.id) as boolean) : n.st !== 'same' || o.allSame);
function diffHTML(r: Res, tree: DiffNode, o: BodyOpts): string {
  if (o.mode === 'hcl') return hclHTML(r, tree, o);
  const rows: string[] = [];
  emitKids(r, tree, 0, o, rows, true);
  if (!rows.length) rows.push('<div class="drow" role="row"><span class="mk" role="cell"></span><span class="dk wide" role="cell"><span class="kl">No attribute values.</span></span></div>');
  const h = (s: string) => `<span role="columnheader">${esc(s)}</span>`;
  const head = `<div class="dhead" role="row">${h('')}${h('Attribute')}${h(o.labels[0])}${o.single ? '' : h(o.labels[1])}</div>`;
  return `<div class="diff ${o.single ? 'single' : 'split'}" role="table">${head}${rows.join('')}</div>`;
}
function emitKids(r: Owner, node: DiffNode, depth: number, o: BodyOpts, rows: string[], isRoot: boolean): void {
  let kids = node.kids ?? [];
  let unk: DiffNode[] = [];
  if (isRoot && o.single && o.side === 'a') {
    unk = kids.filter(k => k.kind === 'leaf' && k.unk);
    kids = kids.filter(k => !(k.kind === 'leaf' && k.unk));
  }
  let hidden = 0;
  for (const k of kids) {
    if (k.kind === 'leaf' && isNil(k.b) && isNil(k.a) && !k.unk) continue;
    const ctxRow = isRoot && !o.single && CONTEXT.has(k.key) && k.st === 'same';
    if (k.st === 'same' && !o.showSame && !o.allSame && !ctxRow) { hidden++; continue; }
    rows.push(rowHTML(r, k, depth, o, ctxRow));
    if (!isOpenNode(k, o)) continue;
    if (k.kids) emitKids(r, k, depth + 1, o, rows, false);
    else if (k.kind === 'text' || k.kind === 'b64') rows.push(linesHTML(r, k, depth, o));
  }
  if (unk.length) rows.push(`<div class="drow unkrow" role="row" style="--d:${depth}"><span class="mk" role="cell">${o.neutral ? '' : '+'}</span><span class="dk wide" role="cell"><span class="unk">known after apply</span> <span class="klist">${unk.map(k => esc(k.key)).join(', ')}</span></span></div>`);
  if (hidden) rows.push(`<div class="drow more" role="row" style="--d:${depth}"><span class="mk" role="cell"></span><span class="dk wide" role="cell"><button type="button" class="lk" data-act="card-same" data-id="${r.id}">${plural(hidden, o.noun ?? 'unchanged attribute')} hidden, like terraform plan does · show</button></span></div>`);
}
function rowHTML(r: Owner, n: DiffNode, depth: number, o: BodyOpts, ctxRow: boolean): string {
  const st = o.neutral ? 'same' : n.st;
  const grp = !!n.kids || n.kind === 'text' || n.kind === 'b64';
  const label = typeof n.key === 'number' ? `[${n.key}]` : esc(n.key);
  const key = grp
    ? `<button type="button" class="tw" data-act="node" data-id="${r.id}" data-node="${n.id}" aria-expanded="${isOpenNode(n, o)}">${CARET}<span>${label}</span></button>`
    : `<span class="kl">${label}</span>`;
  let cells: string;
  if (o.single) cells = `<span class="dv${grp ? ' grp' : ''}" role="cell">${valueHTML(r, n, o.side)}</span>`;
  else {
    const [bh, ah] = pairHTML(r, n);
    cells = `<span class="dv b${grp ? ' grp' : ''}" role="cell" data-l="${esc(o.labels[0])}">${bh}</span><span class="dv a${grp ? ' grp' : ''}${n.unk ? ' unkc' : ''}" role="cell" data-l="${esc(o.labels[1])}">${ah}</span>`;
  }
  return `<div class="drow st-${st}${ctxRow ? ' ctx' : ''}" role="row" style="--d:${depth}"><span class="mk" role="cell" title="${ST_LABEL[st]}">${o.neutral ? '' : MK[n.st]}</span><span class="dk" role="cell">${key}${tagsHTML(n)}${depth === 0 ? causeTags(r, n.key) : ''}</span>${cells}</div>`;
}
/** For changed strings, mark the part that differs so long IDs and ARNs are easy to compare. */
function pairHTML(r: Owner, n: DiffNode): [string, string] {
  const b = n.b, a = n.a;
  if (n.kind === 'leaf' && n.st === 'chg' && !n.unk && !n.sensA && !n.sensB && typeof b === 'string' && typeof a === 'string' && b.length + a.length > 16) {
    const max = Math.min(b.length, a.length);
    let p = 0;
    while (p < max && b[p] === a[p]) p++;
    let s = 0;
    while (s < max - p && b[b.length - 1 - s] === a[a.length - 1 - s]) s++;
    if (p + s > 3) {
      const hl = (str: string) => `<span class="q">"</span>${esc(str.slice(0, p))}<mark>${esc(str.slice(p, str.length - s))}</mark>${esc(str.slice(str.length - s))}<span class="q">"</span>`;
      return [hl(b), hl(a)];
    }
  }
  return [valueHTML(r, n, 'b'), valueHTML(r, n, 'a')];
}
function valueHTML(r: Owner, n: DiffNode, side: 'a' | 'b'): string {
  if (n.kind === 'obj' || n.kind === 'arr' || n.kind === 'json') return groupVal(n, side);
  if (n.kind === 'text' || n.kind === 'b64') return textVal(n, side);
  if (side === 'a' && n.unk) return '<span class="unk">known after apply</span>';
  const v = side === 'b' ? n.b : n.a;
  if (v === undefined) return '<span class="none">—</span>';
  if ((side === 'b' ? n.sensB : n.sensA) && v !== null) return sensHTML(r, n, v);
  return fmt(v);
}
function groupVal(n: DiffNode, side: 'a' | 'b'): string {
  const v = n.kind === 'json' ? (side === 'b' ? n.jb : n.ja) : side === 'b' ? n.b : n.a;
  if (v === undefined || (v === null && n.kind === 'json')) return '<span class="none">—</span>';
  if (v === null || typeof v !== 'object') return fmt(v);
  const arr = Array.isArray(v), c = arr ? v.length : Object.keys(v).length;
  const s = `${arr ? '[' : '{'} ${plural(c, arr ? 'item' : 'key')} ${arr ? ']' : '}'}`;
  return `<span class="gsum">${n.kind === 'json' ? `jsonencode(${s})` : s}</span>`;
}
function textVal(n: DiffNode, side: 'a' | 'b'): string {
  const raw = side === 'b' ? n.b : n.a;
  if (raw === undefined) return '<span class="none">—</span>';
  if (raw === null) return fmt(null);
  const t = n.kind === 'b64' ? (side === 'b' ? n.db : n.da) : raw;
  const lines = String(t).replace(/\n$/, '').split('\n').length;
  return `<span class="gsum">${plural(lines, 'line')}${n.kind === 'b64' ? ` · ${String(raw).length} base64 chars` : ''}</span>`;
}
const changeCounts = new WeakMap<DiffNode, number>();
function changeCount(n: DiffNode): number {
  let c = changeCounts.get(n);
  if (c === undefined) {
    c = (n.kids ?? []).reduce((s, k) => s + (k.kids ? changeCount(k) : k.st !== 'same' ? 1 : 0), 0);
    changeCounts.set(n, c);
  }
  return c;
}
function tagsHTML(n: DiffNode): string {
  let t = '';
  if (n.force) t += '<span class="tag fr">forces replacement</span>';
  if (n.kind === 'json') t += '<span class="tag">json</span>';
  if (n.kind === 'b64') t += '<span class="tag">base64 decoded</span>';
  if (n.fmtOnly) t += '<span class="tag">whitespace only</span>';
  if (n.secret && n.st !== 'same') t += '<span class="tag warn" title="Looks like a secret, but the provider does not mark it sensitive, so terraform plan prints it in plain text.">unmarked secret</span>';
  if (n.kids && n.st === 'chg') {
    const c = changeCount(n);
    if (c) t += `<span class="cnt">${c} changed</span>`;
  }
  return t;
}
function sensHTML(r: Owner, n: DiffNode, v: Json): string {
  const on = canReveal() && (ui.reveal || ui.revealed.has(n.id));
  const btn = !canReveal() || ui.reveal ? '' : `<button type="button" class="rv" data-act="reveal" data-id="${r.id}" data-node="${n.id}">${on ? 'hide' : 'show'}</button>`;
  return on
    ? `<span class="sens">${fmt(v)}<span class="stag">sensitive</span>${btn}</span>`
    : `<span class="sens"><span class="mask" role="img" aria-label="hidden sensitive value">••••••••</span><span class="stag">sensitive</span>${btn}</span>`;
}
function fmt(v: unknown): string {
  if (isNil(v)) return '<span class="nul">null</span>';
  if (typeof v === 'string') return `<span class="q">"</span>${esc(v)}<span class="q">"</span>`;
  if (typeof v !== 'object') return esc(String(v));
  const arr = Array.isArray(v), c = arr ? v.length : Object.keys(v).length;
  if (!c) return arr ? '[]' : '{}';
  return `<details class="jv"><summary>${arr ? '[' : '{'} ${plural(c, arr ? 'item' : 'key')} ${arr ? ']' : '}'}</summary><pre>${esc(JSON.stringify(v, null, 2))}</pre></details>`;
}

/* ---------- multi-line strings ---------- */

type Folded = { op: LineOp; fold?: undefined } | { fold: number; op?: undefined };
function foldOps(ops: LineOp[], expanded: boolean, allSame: boolean): Folded[] {
  if (expanded || allSame) return ops.map(op => ({ op }));
  const out: Folded[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].t !== 'same') { out.push({ op: ops[i++] }); continue; }
    let j = i;
    while (j < ops.length && ops[j].t === 'same') j++;
    const head = i === 0 ? 0 : 3, tail = j === ops.length ? 0 : 3;
    if (j - i <= head + tail + 1) for (let k = i; k < j; k++) out.push({ op: ops[k] });
    else {
      for (let k = i; k < i + head; k++) out.push({ op: ops[k] });
      out.push({ fold: j - i - head - tail });
      for (let k = j - tail; k < j; k++) out.push({ op: ops[k] });
    }
    i = j;
  }
  return out;
}
function linesHTML(r: Owner, n: DiffNode, depth: number, o: BodyOpts): string {
  const ops = n.ops ?? [];
  const add = ops.filter(x => x.t === 'add').length, del = ops.filter(x => x.t === 'del').length;
  const items = foldOps(ops, ui.open.get(n.id + ':all') === true, !add && !del);
  const body = items.map(it => (it.fold !== undefined
    ? `<button type="button" class="ln fold" data-act="unfold" data-id="${r.id}" data-node="${n.id}">⋯ ${plural(it.fold, 'unchanged line')}</button>`
    : `<div class="ln ${o.neutral ? '' : it.op.t}"><span class="m" aria-hidden="true">${o.neutral ? '' : MK[it.op.t]}</span><span class="t">${esc(it.op.s) || ' '}</span></div>`)).join('');
  const counts = (add || del) && !o.neutral ? `${add ? `<span class="pa">+${add}</span>` : ''}${del ? `<span class="pd">−${del}</span>` : ''}` : `<span>${plural(ops.length, 'line')}</span>`;
  return `<div class="lrow" style="--d:${depth}"><div class="ldiff"><div class="lh"><span>${n.kind === 'b64' ? 'Decoded from base64' : 'Multi-line string'}</span>${counts}</div><div class="lbody">${body}</div></div></div>`;
}

/* ---------- plan-style (HCL) diff ---------- */

const hclKey = (k: string): string => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? k : JSON.stringify(k));
type Line = (st: string, depth: number, html: string) => void;
function hclHTML(r: Res, tree: DiffNode, o: BodyOpts): string {
  const L: string[] = [];
  const line: Line = (st, depth, html) => L.push(`<div class="hl ${o.neutral ? '' : st}"><span class="m" aria-hidden="true">${o.neutral ? '' : MK[st] ?? ''}</span><span class="c">${'    '.repeat(depth)}${html}</span></div>`);
  const g = r.drift ? (r.kind === 'delete' ? '-' : '~') : r.glyph;
  L.push(`<div class="hl head k-${r.drift ? 'info' : r.kind}"><span class="m">${esc(g)}</span><span class="c"><span class="kw">${r.mode === 'data' ? 'data' : 'resource'}</span> "${esc(r.type)}" "${esc(r.name)}" {</span></div>`);
  hclKids(r, tree, 1, o, line, true);
  L.push('<div class="hl head"><span class="m"></span><span class="c">}</span></div>');
  return `<div class="hcl">${L.join('')}</div>`;
}
function hclTags(k: DiffNode): string {
  let t = '';
  if (k.force) t += ' <span class="cm fr"># forces replacement</span>';
  if (k.secret && k.st !== 'same') t += ' <span class="cm warn"># unmarked secret</span>';
  if (k.fmtOnly) t += ' <span class="cm"># whitespace only</span>';
  if (k.kind === 'b64') t += ' <span class="cm"># decoded from base64</span>';
  return t;
}
function fmtH(v: unknown): string {
  if (isNil(v)) return '<span class="nul">null</span>';
  if (typeof v === 'string') return esc(JSON.stringify(v));
  if (typeof v !== 'object') return esc(String(v));
  const s = JSON.stringify(v);
  return esc(s.length > 160 ? s.slice(0, 157) + '…' : s);
}
function hclVal(r: Res, k: DiffNode, o: BodyOpts): string {
  const show = (side: 'a' | 'b') => {
    const v = side === 'b' ? k.b : k.a;
    if ((side === 'b' ? k.sensB : k.sensA) && !isNil(v)) {
      const on = canReveal() && (ui.reveal || ui.revealed.has(k.id));
      const btn = !canReveal() || ui.reveal ? '' : ` <button type="button" class="rv" data-act="reveal" data-id="${r.id}" data-node="${k.id}">${on ? 'hide' : 'show'}</button>`;
      return (on ? fmtH(v) : '(sensitive value)') + btn;
    }
    return fmtH(v);
  };
  const UNK = '<span class="unk">known after apply</span>';
  if (k.unk) return isNil(k.b) ? UNK : `<span class="old">${show('b')}</span> -&gt; ${UNK}`;
  if (o.neutral || k.st === 'same') return show('b');
  if (k.st === 'add') return show('a');
  if (k.st === 'del') return `<span class="old">${show('b')}</span> -&gt; null`;
  return `<span class="old">${show('b')}</span> -&gt; <span class="new">${show('a')}</span>`;
}
function hclKids(r: Res, node: DiffNode, depth: number, o: BodyOpts, line: Line, isRoot: boolean): void {
  const isArr = node.kind === 'arr' || (node.kind === 'json' && node.inner === 'arr');
  const vis: DiffNode[] = [];
  let hidden = 0;
  for (const k of node.kids ?? []) {
    if (k.kind === 'leaf' && isNil(k.b) && isNil(k.a) && !k.unk) continue;
    const ctxRow = isRoot && !o.single && CONTEXT.has(k.key) && k.st === 'same';
    if (k.st === 'same' && !o.showSame && !o.allSame && !ctxRow) { hidden++; continue; }
    vis.push(k);
  }
  const w = isArr ? 0 : Math.max(0, ...vis.map(k => hclKey(String(k.key)).length));
  for (const k of vis) {
    const key = isArr ? '' : `${esc(hclKey(String(k.key)).padEnd(w))} = `;
    const comma = isArr ? ',' : '';
    const tags = hclTags(k) + (isRoot ? causeComments(r, k.key) : '');
    if (k.kind === 'obj' || k.kind === 'arr') {
      const [ob, cb] = k.kind === 'obj' ? ['{', '}'] : ['[', ']'];
      if (!isOpenNode(k, o)) {
        line(k.st, depth, `${key}<button type="button" class="hx" data-act="node" data-id="${r.id}" data-node="${k.id}" aria-expanded="false">${ob} … ${cb}</button>${comma}${tags}`);
        continue;
      }
      line(k.st, depth, `${key}${ob}${tags}`);
      hclKids(r, k, depth + 1, o, line, false);
      line('', depth, cb + comma);
    } else if (k.kind === 'json') {
      line(k.st, depth, `${key}jsonencode(${tags}`);
      line(k.st, depth + 1, k.inner === 'arr' ? '[' : '{');
      hclKids(r, k, depth + 2, o, line, false);
      line('', depth + 1, k.inner === 'arr' ? ']' : '}');
      line('', depth, ')' + comma);
    } else if (k.kind === 'text' || k.kind === 'b64') {
      line(k.st, depth, `${key}${k.kind === 'b64' ? 'base64encode(' : ''}&lt;&lt;-EOT${tags}`);
      const ops = k.ops ?? [];
      for (const it of foldOps(ops, ui.open.get(k.id + ':all') === true, !ops.some(x => x.t !== 'same'))) {
        if (it.fold !== undefined) line('', depth + 1, `<button type="button" class="hx" data-act="unfold" data-id="${r.id}" data-node="${k.id}"># (${plural(it.fold, 'unchanged line')} hidden)</button>`);
        else line(it.op.t, depth + 1, esc(it.op.s));
      }
      line('', depth, `EOT${k.kind === 'b64' ? ')' : ''}${comma}`);
    } else {
      line(k.st, depth, `${key}${hclVal(r, k, o)}${comma}${tags}`);
    }
  }
  if (hidden) line('', depth, `<button type="button" class="hx" data-act="card-same" data-id="${r.id}"># (${plural(hidden, 'unchanged attribute')} hidden)</button>`);
}

/* ---------- main list, drift and outputs ---------- */

function outputsHTML(): string {
  const pm = P();
  if (!pm.outputs.kids?.length) return '<div class="empty"><p>This configuration has no root module outputs.</p></div>';
  const o: BodyOpts = { single: false, neutral: false, allSame: false, side: 'b', showSame: ui.showSame || ui.cardSame.has('outputs'), mode: 'split', labels: ['Before', 'After'], noun: 'unchanged output' };
  const rows: string[] = [];
  emitKids({ id: 'outputs', causes: pm.outCauses }, pm.outputs, 0, o, rows, false);
  const body = rows.length ? rows.join('') : '<div class="drow" role="row"><span class="mk" role="cell"></span><span class="dk wide" role="cell"><span class="kl">No output values change.</span></span></div>';
  const note = canReveal() ? 'Sensitive outputs stay masked until you reveal them.' : 'Sensitive outputs were removed from this report.';
  return `<article class="card" id="card-outputs"><div class="card-h"><span class="addr"><span class="rn">Output values</span></span></div><div class="card-meta"><p class="reason">Root module outputs after this plan is applied. ${note}</p></div><div class="card-b"><div class="diff split" role="table"><div class="dhead" role="row"><span role="columnheader"></span><span role="columnheader">Output</span><span role="columnheader">Before</span><span role="columnheader">After</span></div>${body}</div></div></article>`;
}
export function renderMain(): void {
  const pm = P(), el = $('#list');
  if (ui.tab === 'drift') {
    el.innerHTML = pm.drift.length ? pm.drift.map(cardHTML).join('') : '<div class="empty"><p>No drift. When Terraform refreshed, everything matched the last applied state.</p></div>';
    return;
  }
  if (ui.tab === 'outputs') { el.innerHTML = outputsHTML(); return; }
  const list = visibleRes();
  if (!list.length) {
    const filtered = ui.kinds.size || ui.special || ui.q.trim();
    el.innerHTML = filtered
      ? '<div class="empty"><p>No resources match these filters.</p><button type="button" class="btn" data-act="clear">Clear filters</button></div>'
      : '<div class="empty"><p>No changes. Terraform found nothing to create, update or destroy.</p></div>';
    return;
  }
  const parts: string[] = [];
  let last: Kind | null = null;
  for (const r of list) {
    if (ui.sort === 'action' && r.kind !== last) {
      last = r.kind;
      parts.push(`<h3 class="sec k-${r.kind}"><span class="g" aria-hidden="true">${esc(kindGlyph(r.kind))}</span>${esc(GROUP_LABEL[r.kind])}<span class="n">${list.filter(x => x.kind === r.kind).length}</span></h3>`);
    }
    parts.push(cardHTML(r));
  }
  el.innerHTML = parts.join('');
  el.querySelectorAll('.card')[ui.focus]?.classList.add('focus');
}
export const findRes = (id: string): Res | undefined => P().byId.get(id) ?? P().drift.find(d => d.id === id);
export function rerender(id: string): void {
  if (id === 'outputs') { renderMain(); return; }
  const r = findRes(id), el = document.getElementById('card-' + id);
  if (!r || !el) return;
  const focused = el.classList.contains('focus');
  el.outerHTML = cardHTML(r);
  if (focused) document.getElementById('card-' + id)?.classList.add('focus');
}
