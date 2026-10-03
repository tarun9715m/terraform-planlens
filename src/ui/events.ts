import { movedBlock } from '../core/insight';
import type { Kind } from '../core/model';
import { analyzePlan, parsePlanText } from '../core/plan';
import { summaryMarkdown } from '../core/summary';
import { plural } from '../core/util';
import { $, codeHTML, copyText, esc, smooth, toast } from './dom';
import { cardOpen, findRes, renderAll, renderInsights, renderMain, renderNav, renderTabs, renderToolbar, renderView, rerender, setKinds, visibleRes } from './render';
import { P, S, resetView, savePrefs, store, ui, type Payload, type Special, type Tab } from './state';

/* ---------- loading plans ---------- */

export function showPlan(payload: Payload): void {
  S.meta = { ...payload.meta };
  S.pm = analyzePlan(payload.plan);
  resetView(S.pm.key);
  $<HTMLInputElement>('#q').value = '';
  $('#err').hidden = true;
  $('#start').hidden = true;
  $('#planView').hidden = false;
  $('#copyBtn').hidden = false;
  $('#ver').textContent = S.meta.version ? 'v' + S.meta.version : '';
  $('#ver').hidden = !S.meta.version;
  document.title = `${S.meta.label} · planlens`;
  renderAll();
}

export function showStart(error?: string): void {
  $('#start').hidden = false;
  $('#planView').hidden = true;
  $('#note').hidden = true;
  $('#ver').hidden = !S.meta.version;
  if (error) showError(codeHTML(error));
}

function showError(html: string): void {
  const el = $('#err');
  el.innerHTML = html;
  el.hidden = false;
  el.scrollIntoView({ block: 'nearest' });
}

function loadText(text: string, name: string): void {
  const r = parsePlanText(text, name);
  if ('error' in r) { showError(codeHTML(r.error)); return; }
  showPlan({ meta: { mode: 'file', label: name, version: S.meta.version }, plan: r.plan });
  toast(`Opened ${name}`);
}

function readFile(f: File): void {
  const rd = new FileReader();
  rd.onload = () => loadText(String(rd.result), f.name);
  rd.onerror = () => showError(`Couldn't read ${esc(f.name)}.`);
  rd.readAsText(f);
}

/* ---------- navigation ---------- */

function focusCardEl(el: HTMLElement | null, flash: boolean): void {
  if (!el) return;
  const cards = [...document.querySelectorAll<HTMLElement>('#list .card[data-id]')];
  cards.forEach(c => c.classList.remove('focus'));
  ui.focus = cards.indexOf(el);
  el.classList.add('focus');
  el.scrollIntoView({ behavior: smooth(), block: flash ? 'start' : 'nearest' });
  if (flash) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
}

function jump(id: string): void {
  const r = P().byId.get(id);
  if (!r) return;
  ui.tab = 'changes';
  if (!visibleRes().includes(r)) {
    ui.kinds.clear();
    ui.special = null;
    ui.q = '';
    $<HTMLInputElement>('#q').value = '';
    if (r.kind === 'noop') ui.kinds.add('noop');
  }
  ui.openCards.set(id, true);
  renderView();
  focusCardEl(document.getElementById('card-' + id), true);
}

function toggleReviewed(id: string): void {
  const r = P().byId.get(id);
  if (!r) return;
  if (ui.reviewed.has(r.address)) ui.reviewed.delete(r.address);
  else ui.reviewed.add(r.address);
  store.set(P().key, [...ui.reviewed]);
  ui.openCards.delete(r.id);
  rerender(r.id);
  renderNav();
}

const toList = () => $('#tabs').scrollIntoView({ behavior: smooth(), block: 'start' });
const toggleIn = <T>(set: Set<T>, v: T) => (set.has(v) ? set.delete(v) : set.add(v));

function onClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el || el.dataset.act === 'review') return;
  const act = el.dataset.act, id = el.dataset.id ?? '', v = el.dataset.v ?? '';
  if (act === 'theme') { setTheme(v); return; }
  if (act === 'close-copy') { $('#copyHost').innerHTML = ''; return; }
  if (!S.pm) return;
  switch (act) {
    case 'kind': {
      const k = el.dataset.kind as Kind, clearing = ui.kinds.size === 1 && ui.kinds.has(k);
      setKinds(clearing ? 'all' : k);
      if (!clearing && el.closest('#summary')) toList();
      break;
    }
    case 'special':
      ui.special = ui.special === v ? null : (v as Special);
      ui.tab = 'changes';
      ui.focus = -1;
      if (ui.special) visibleRes().forEach(r => ui.openCards.set(r.id, true));
      renderView();
      if (ui.special && el.closest('#insights')) toList();
      break;
    case 'clear':
      ui.kinds.clear();
      ui.special = null;
      ui.q = '';
      $<HTMLInputElement>('#q').value = '';
      ui.focus = -1;
      renderView();
      break;
    case 'tab':
      ui.tab = v as Tab;
      ui.focus = -1;
      renderView();
      if (el.closest('#summary, #insights')) toList();
      break;
    case 'sort': ui.sort = v as typeof ui.sort; savePrefs(); ui.focus = -1; renderView(); break;
    case 'mode': ui.mode = v as typeof ui.mode; savePrefs(); renderToolbar(); renderMain(); break;
    case 'same-all': ui.showSame = !ui.showSame; ui.cardSame.clear(); renderToolbar(); renderInsights(); renderMain(); break;
    case 'reveal-all':
      ui.reveal = !ui.reveal;
      ui.revealed.clear();
      renderToolbar();
      renderMain();
      toast(ui.reveal ? 'Sensitive values are now visible on screen.' : 'Sensitive values are masked again.');
      break;
    case 'expand':
    case 'collapse':
      (ui.tab === 'drift' ? P().drift : visibleRes()).forEach(r => ui.openCards.set(r.id, act === 'expand'));
      renderMain();
      break;
    case 'toggle': {
      const r = findRes(id);
      if (r) { ui.openCards.set(id, !cardOpen(r)); rerender(id); }
      break;
    }
    case 'node': ui.open.set(el.dataset.node ?? '', el.getAttribute('aria-expanded') !== 'true'); rerender(id); break;
    case 'unfold': ui.open.set((el.dataset.node ?? '') + ':all', true); rerender(id); break;
    case 'reveal': toggleIn(ui.revealed, el.dataset.node ?? ''); rerender(id); break;
    case 'card-same': toggleIn(ui.cardSame, id); rerender(id); break;
    case 'raw': toggleIn(ui.raw, id); rerender(id); break;
    case 'copy': {
      const r = findRes(id);
      if (r) copyText(r.address, `Copied ${r.address}`);
      break;
    }
    case 'jump': jump(id); break;
    case 'drift-of':
      ui.tab = 'drift';
      ui.openCards.set(id, true);
      renderView();
      focusCardEl(document.getElementById('card-' + id), true);
      break;
    case 'rgroup': ui.groups.set(v, el.getAttribute('aria-expanded') !== 'true'); renderInsights(); break;
    case 'rgroups': ['renames', 'delete', 'replace', 'update', 'create', 'others'].forEach(k => ui.groups.set(k, v === 'open')); renderInsights(); break;
    case 'copy-moved': {
      const r = P().byId.get(id);
      if (r?.renameTo) copyText(movedBlock({ from: r, to: r.renameTo }), 'Copied the moved block');
      break;
    }
    case 'copy-moved-all': copyText(P().renames.map(movedBlock).join('\n\n'), `Copied ${plural(P().renames.length, 'moved block')}`); break;
  }
}

function onKey(e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey || !S.pm) return;
  const t = e.target as HTMLElement;
  if (t.closest?.('input, textarea, select')) {
    if (e.key === 'Escape' && t.id === 'q') t.blur();
    return;
  }
  const cards = [...document.querySelectorAll<HTMLElement>('#list .card[data-id]')];
  const cur = cards[ui.focus];
  if (e.key === '/') {
    e.preventDefault();
    $('#q').focus();
  } else if (e.key === 'j' || e.key === 'k') {
    if (!cards.length) return;
    e.preventDefault();
    const next = ui.focus < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, ui.focus + (e.key === 'j' ? 1 : -1)));
    focusCardEl(cards[next], false);
  } else if ((e.key === 'o' || (e.key === 'Enter' && t === document.body)) && cur) {
    e.preventDefault();
    const r = findRes(cur.dataset.id ?? '');
    if (r) { ui.openCards.set(r.id, !cardOpen(r)); rerender(r.id); }
  } else if (e.key === 'x' && cur) {
    const id = cur.dataset.id ?? '';
    const r = P().byId.get(id);
    if (!r) return;
    toggleReviewed(id);
    const next = [...document.querySelectorAll<HTMLElement>('#list .card[data-id]')][ui.focus + 1];
    if (next && ui.reviewed.has(r.address)) focusCardEl(next, false);
  } else if (e.key === 'u') {
    ui.showSame = !ui.showSame;
    ui.cardSame.clear();
    renderToolbar();
    renderInsights();
    renderMain();
  }
}

/* ---------- theme: Auto follows the system; Light and Dark override it ---------- */

const rootEl = document.documentElement;
let themePref = store.get<string>('planlens:theme') ?? 'auto';
function applyTheme(): void {
  if (themePref === 'light' || themePref === 'dark') rootEl.setAttribute('data-theme', themePref);
  else rootEl.removeAttribute('data-theme');
  document.querySelectorAll<HTMLElement>('#themeCtl button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === themePref)));
}
function setTheme(v: string): void {
  themePref = v === 'light' || v === 'dark' ? v : 'auto';
  store.set('planlens:theme', themePref);
  applyTheme();
}

function setTreeOpen(open: boolean): void {
  $('#tree').hidden = !open;
  const b = $('#treeToggle');
  b.setAttribute('aria-expanded', String(open));
  b.textContent = open ? 'Hide' : 'Show';
}

export function initEvents(): void {
  applyTheme();
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('change', e => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'kindSel') {
      setKinds(el.value);
      $('#kindSel')?.focus();
    } else if (el.dataset?.act === 'review') toggleReviewed(el.dataset.id ?? '');
  });
  $<HTMLInputElement>('#q').addEventListener('input', e => {
    if (!S.pm) return;
    ui.q = (e.target as HTMLInputElement).value;
    ui.tab = 'changes';
    ui.focus = -1;
    renderTabs();
    renderToolbar();
    renderNav();
    renderMain();
  });
  $('#openBtn').addEventListener('click', () => $<HTMLInputElement>('#file').click());
  $<HTMLInputElement>('#file').addEventListener('change', e => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    if (f) readFile(f);
    input.value = '';
  });
  $('#copyBtn').addEventListener('click', () => { if (S.pm) copyText(summaryMarkdown(S.pm), 'Copied a Markdown summary of this plan'); });
  $('#treeToggle').addEventListener('click', () => setTreeOpen(Boolean($('#tree').hidden)));
  if (window.matchMedia?.('(max-width: 1100px)').matches) setTreeOpen(false);

  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files');
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $('#drop').hidden = true;
    const f = e.dataTransfer?.files[0];
    if (f) readFile(f);
  });
  document.addEventListener('paste', e => {
    if ((e.target as HTMLElement).closest?.('input, textarea')) return;
    const t = e.clipboardData?.getData('text');
    if (t && t.trim().startsWith('{')) { e.preventDefault(); loadText(t, 'pasted plan JSON'); }
  });

  const tip = $('#tip');
  document.addEventListener('pointerover', e => {
    const t = (e.target as HTMLElement).closest?.<HTMLElement>('[data-tip]');
    if (t) { tip.textContent = t.dataset.tip ?? ''; tip.hidden = false; } else tip.hidden = true;
  });
  document.addEventListener('pointermove', e => {
    if (tip.hidden) return;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12)) + 'px';
    tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 10) + 'px';
  });
}
