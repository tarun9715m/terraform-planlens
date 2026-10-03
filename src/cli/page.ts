import { readFile } from 'node:fs/promises';
import type { Payload } from '../ui/state';

/** The page is self-contained: no requests to anything, not even its own server. */
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'";

/** Built by `vite build` next to the bundled CLI (dist/ui/index.html). */
export async function loadTemplate(): Promise<string> {
  try {
    return await readFile(new URL('./ui/index.html', import.meta.url), 'utf8');
  } catch {
    throw new Error('The viewer is missing from this planlens install (dist/ui/index.html). Run npm run build.');
  }
}

/** JSON that is safe inside a <script> element: nothing in it can close the tag. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The viewer page with the plan embedded and a no-network content security policy. */
export function buildPage(template: string, payload: Payload): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  const data = `<script id="planlens-data" type="application/json">${scriptSafeJson(payload)}</script>`;
  const head = template.indexOf('<head>');
  const end = template.lastIndexOf('</body>');
  if (head < 0 || end < 0) throw new Error('The viewer template is damaged: <head> or </body> is missing.');
  const at = head + '<head>'.length;
  return template.slice(0, at) + csp + template.slice(at, end) + data + template.slice(end);
}
