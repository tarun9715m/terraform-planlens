import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliError, isBinaryPlan, readPlan } from '../src/cli/input';
import { CSP, buildPage, scriptSafeJson } from '../src/cli/page';
import { serve } from '../src/cli/server';
import type { Payload } from '../src/ui/state';

const fixture = new URL('./fixtures/real-terraform-1.16.json', import.meta.url);
const TEMPLATE = '<!doctype html><html><head><title>t</title></head><body><main></main></body></html>';

describe('buildPage', () => {
  const evil = '</script><script>alert(1)</script><!--';
  const payload: Payload = { meta: { mode: 'live', label: 'x' }, plan: { resource_changes: [{ address: 'a.b', change: { actions: ['update'], before: { v: evil }, after: { v: 'ok\u2028' } } }] } };
  const page = buildPage(TEMPLATE, payload);

  it('embeds the plan so no value can close the script element', () => {
    expect(page).not.toContain('</script><script>alert');
    const data = /<script id="planlens-data" type="application\/json">([\s\S]*?)<\/script>/.exec(page)?.[1] ?? '';
    expect(JSON.parse(data)).toEqual(payload);
  });

  it('adds a content security policy that blocks all network requests', () => {
    expect(page.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}">`)).toBe(true);
    expect(CSP).toContain("default-src 'none'");
    expect(CSP).not.toMatch(/connect-src/);
  });

  it('escapes HTML-significant characters in JSON', () => {
    expect(scriptSafeJson({ s: '<>&' })).toBe('{"s":"\\u003c\\u003e\\u0026"}');
  });
});

describe('readPlan', () => {
  let dir = '';
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'planlens-test-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('reads plan JSON files', async () => {
    const r = await readPlan(fixture.pathname, { bins: [] });
    expect(r.label).toBe('real-terraform-1.16.json');
    expect(r.plan.resource_changes?.length).toBe(22);
  });

  it('converts binary plan files with terraform show -json', async () => {
    const fake = join(dir, 'fake-terraform');
    await writeFile(fake, `#!/bin/sh\n[ "$1 $2 $3" = "show -json -no-color" ] || exit 9\ncat "${fixture.pathname}"\n`);
    await chmod(fake, 0o755);
    const planFile = join(dir, 'tfplan');
    await writeFile(planFile, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]));
    const r = await readPlan(planFile, { bins: ['definitely-not-installed-xyz', fake] });
    expect(r.plan.terraform_version).toBe('1.16.4');
  });

  it('explains failures', async () => {
    await expect(readPlan(join(dir, 'missing.json'), { bins: [] })).rejects.toThrow(/Can't find/);
    await expect(readPlan(dir, { bins: [] })).rejects.toThrow(/is a directory/);
    const failing = join(dir, 'failing-terraform');
    await writeFile(failing, '#!/bin/sh\necho "Error: Failed to load plugin schemas" >&2\nexit 1\n');
    await chmod(failing, 0o755);
    const planFile = join(dir, 'tfplan2');
    await writeFile(planFile, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await expect(readPlan(planFile, { bins: [failing] })).rejects.toThrow(/--chdir/);
    await expect(readPlan(planFile, { bins: ['definitely-not-installed-xyz'] })).rejects.toBeInstanceOf(CliError);
    const text = join(dir, 'plan.txt');
    await writeFile(text, 'Terraform will perform the following actions:\n');
    await expect(readPlan(text, { bins: [] })).rejects.toThrow(/text output of terraform plan/);
  });

  it('detects zip-format plan files', async () => {
    expect(isBinaryPlan(Buffer.from('PK\u0003\u0004'))).toBe(true);
    expect(isBinaryPlan(await readFile(fixture))).toBe(false);
  });
});

describe('serve', () => {
  const get = (url: string, opts: { host?: string; method?: string } = {}) =>
    new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const u = new URL(url);
      const req = request({ host: u.hostname, port: u.port, path: u.pathname, method: opts.method ?? 'GET', headers: opts.host ? { host: opts.host } : {} }, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });

  it('serves the page only at its secret path, only to loopback Host headers', async () => {
    const v = await serve('<html>hi</html>');
    try {
      expect(v.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
      const ok = await get(v.url);
      expect(ok.status).toBe(200);
      expect(ok.body).toBe('<html>hi</html>');
      expect(ok.headers['content-security-policy']).toContain("default-src 'none'");
      expect(ok.headers['cache-control']).toBe('no-store');
      const origin = new URL(v.url).origin;
      expect((await get(origin + '/')).status).toBe(404);
      expect((await get(origin + '/wrong-token/')).status).toBe(404);
      expect((await get(v.url, { host: 'evil.example:80' })).status).toBe(403);
      expect((await get(v.url, { method: 'POST' })).status).toBe(405);
    } finally {
      await v.close();
    }
  });
});
