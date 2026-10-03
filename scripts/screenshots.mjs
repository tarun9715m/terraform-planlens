// Regenerate the screenshots in docs/public/screenshots from `planlens demo`.
// Needs a built CLI (npm run build) and a local Chrome or Chromium; set CHROME_PATH if it isn't found.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}docs/public/screenshots`;
const chrome = process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(p => existsSync(p));
if (!chrome) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');
if (!existsSync(`${root}dist/cli.js`)) throw new Error('Build first: npm run build');
await mkdir(out, { recursive: true });

// Serve the demo exactly as users see it.
const cli = spawn(process.execPath, [`${root}dist/cli.js`, 'demo', '--no-open'], { stdio: ['ignore', 'pipe', 'inherit'] });
const url = await new Promise((resolve, reject) => {
  let buf = '';
  cli.stdout.on('data', d => {
    buf += d;
    const m = /Viewer: (http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]+\/)/.exec(buf);
    if (m) resolve(m[1]);
  });
  cli.on('exit', code => reject(new Error(`planlens demo exited with ${code}`)));
});

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb'],
  defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 1.5 },
});

try {
  const page = await browser.newPage();
  const open = async scheme => {
    // Reduced motion makes the viewer scroll instantly, so measurements below are stable.
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
  };
  const save = async (name, target) => {
    const path = `${out}/${name}.png`;
    await (target ?? page).screenshot({ path });
    console.log(`wrote docs/public/screenshots/${name}.png`);
  };
  const click = async sel => {
    await page.click(sel);
    await page.mouse.move(1, 1); // no hover highlight in the next shot
    await new Promise(r => setTimeout(r, 150));
  };
  const card = async address => {
    const handle = await page.evaluateHandle(a => [...document.querySelectorAll('#list .card')].find(c => c.querySelector('.addr')?.textContent?.trim() === a) ?? null, address);
    const el = handle.asElement();
    if (!el) throw new Error(`No card for ${address}`);
    return el;
  };
  // Element shots should not have the sticky toolbar or sidebar floating over them.
  const unstick = () => page.addStyleTag({ content: '.toolbar,.nav{position:static !important}.tip,.toast{display:none !important}' });
  // Clip from the top of an element, for long regions such as the change list.
  const top = async (sel, height, pad = 8) => {
    const box = await page.$eval(sel, el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width };
    });
    return { screenshot: o => page.screenshot({ ...o, clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height }, captureBeyondViewport: true }) };
  };

  await open('dark');
  await save('overview-dark');

  await open('light');
  await save('overview');
  await unstick();

  await save('hidden-data', await page.$('#insights .panel:nth-child(2)'));
  await click('[data-act="rgroup"][data-v="renames"]');
  await click('[data-act="rgroup"][data-v="delete"]');
  await save('review-by-action', await page.$('#insights .panel:first-child'));

  await save('diff', await card('aws_lambda_function.api'));
  await save('replace', await card('aws_db_instance.primary'));
  await save('rename', await card('aws_s3_bucket.uploads'));
  await save('decoded', await card('module.workers.aws_launch_template.this'));
  await save('json', await card('aws_iam_policy.deploy'));
  await save('sensitive', await card('aws_ssm_parameter.payments_token'));

  await click('[data-act="mode"][data-v="hcl"]');
  await save('plan-style', await card('aws_lambda_function.api'));
  await click('[data-act="mode"][data-v="split"]');

  await click('#summary [data-act="kind"][data-kind="delete"]');
  await save('filter', await top('.main', 620));
  await page.select('#kindSel', 'all');

  await click('[data-act="tab"][data-v="drift"]');
  await save('drift', await top('.main', 760));
} finally {
  await browser.close();
  cli.kill('SIGINT');
}
