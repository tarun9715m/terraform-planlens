export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ESC[c]);
/** Escape, then turn `backticks` into <code>. */
export const codeHTML = (s: string): string => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export const reduceMotion = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const smooth = (): ScrollBehavior => (reduceMotion() ? 'auto' : 'smooth');

export const CARET = '<svg class="caret" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const COPY = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
export const CHECK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  try {
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  } catch {
    return d.toISOString();
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function showCopyBox(text: string): void {
  $('#copyHost').innerHTML = '<div class="copybox"><div class="row"><span>The clipboard is blocked here. Select the text below and copy it.</span><button type="button" class="lk" data-act="close-copy">Close</button></div><textarea id="copyText" readonly aria-label="Text to copy"></textarea></div>';
  const ta = $<HTMLTextAreaElement>('#copyText');
  ta.value = text;
  ta.focus();
  ta.select();
}

export function copyText(text: string, okMsg: string): void {
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(okMsg), () => showCopyBox(text));
    else showCopyBox(text);
  } catch {
    showCopyBox(text);
  }
}
