import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import pkg from '../../package.json' with { type: 'json' };
import demoPlan from '../samples/aws-demo.json' with { type: 'json' };
import type { Kind } from '../core/model';
import { analyzePlan, type PlanModel } from '../core/plan';
import { redactPlan } from '../core/redact';
import type { Plan } from '../core/types';
import { plural } from '../core/util';
import type { Mode, Payload } from '../ui/state';
import { CliError, readPlan, type LoadedPlan } from './input';
import { openBrowser } from './open';
import { buildPage, loadTemplate } from './page';
import { serve } from './server';

const HELP = `planlens ${pkg.version}
See exactly what a Terraform or OpenTofu plan will create, change, replace and destroy,
including what terraform plan hides.

Usage
  planlens <plan>                    Open the plan in your browser
  planlens export <plan> [-o file]   Write a shareable HTML report, with secrets removed
  planlens demo                      Open a demo plan

<plan> is a saved plan file (terraform plan -out=tfplan), plan JSON
(terraform show -json tfplan > plan.json), or - to read plan JSON from stdin.

Options
  -o, --out <file>        Report file for export (default: planlens-report.html)
      --include-sensitive Keep sensitive values in the report. Don't share that file.
      --chdir <dir>       Directory to run terraform in (default: the current directory)
      --tofu              Use OpenTofu to read saved plan files
      --bin <path>        terraform or tofu binary to use
      --port <n>          Port for the local viewer (default: any free port)
      --no-open           Print the viewer address instead of opening a browser
  -h, --help              Show this help
  -v, --version           Show the version
`;

type Options = {
  out?: string;
  'include-sensitive'?: boolean;
  chdir?: string;
  tofu?: boolean;
  bin?: string;
  port?: string;
  'no-open'?: boolean;
  help?: boolean;
  version?: boolean;
};

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const [bold, dim, red, green, yellow, magenta] = [1, 2, 31, 32, 33, 35].map(paint);
const say = (s = '') => process.stdout.write(s + '\n');

function printSummary(pm: PlanModel, label: string): void {
  const c = pm.g.c, tv = pm.plan.terraform_version;
  say(`${bold('planlens')} ${dim('·')} ${label}${tv ? dim(` · Terraform ${tv}`) : ''}`);
  say(`  ${green('+')} ${c.create} to create   ${yellow('~')} ${c.update} to update   ${magenta('-/+')} ${c.replace} to replace   ${red('-')} ${c.delete} to destroy`);
  const also = (['import', 'move', 'forget', 'read'] as Kind[]).filter(k => c[k]).map(k => `${c[k]} to ${k}`);
  if (also.length) say(dim(`  also ${also.join(', ')}`));
  const notes: string[] = [];
  const holdsData = pm.model.filter(r => r.destructive && r.stateful).length;
  if (holdsData) notes.push(`${plural(holdsData, 'destructive change')} to resources that hold data`);
  if (pm.renames.length) notes.push(`${plural(pm.renames.length, 'destroy', 'destroys')} ${pm.renames.length === 1 ? 'looks like a rename' : 'look like renames'}`);
  if (pm.drift.length) notes.push(`${plural(pm.drift.length, 'change')} made outside Terraform`);
  if (pm.g.secrets) notes.push(`${plural(pm.g.secrets, 'value')} ${pm.g.secrets === 1 ? 'looks' : 'look'} like an unmarked secret`);
  if (notes.length) say(yellow(`  ! ${notes.join(' · ')}`));
}

async function view(loaded: LoadedPlan, mode: Mode, o: Options): Promise<number> {
  const port = o.port === undefined ? 0 : Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CliError(`--port must be a number from 0 to 65535, not ${o.port}.`);
  const payload: Payload = { meta: { mode, label: loaded.label, version: pkg.version }, plan: loaded.plan };
  const html = buildPage(await loadTemplate(), payload);
  let viewer;
  try {
    viewer = await serve(html, port);
  } catch (e) {
    throw new CliError(`Couldn't start the viewer on port ${port}: ${(e as Error).message}`);
  }
  printSummary(analyzePlan(loaded.plan), loaded.label);
  say();
  say(`  Viewer: ${bold(viewer.url)}`);
  say(dim('  Served only to this computer. Press Ctrl+C to stop.'));
  if (!o['no-open']) openBrowser(viewer.url);
  await new Promise<void>(resolve => {
    const stop = () => { say(); void viewer.close().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

async function exportReport(loaded: LoadedPlan, o: Options): Promise<number> {
  const file = o.out ?? 'planlens-report.html';
  const keep = !!o['include-sensitive'];
  const { plan, stats } = keep ? { plan: loaded.plan, stats: null } : redactPlan(loaded.plan);
  const payload: Payload = { meta: { mode: 'report', label: loaded.label, version: pkg.version, generatedAt: new Date().toISOString(), redacted: stats }, plan };
  const html = buildPage(await loadTemplate(), payload);
  try {
    await writeFile(file, html, { mode: keep ? 0o600 : 0o644 });
  } catch (e) {
    throw new CliError(`Couldn't write ${file}: ${(e as Error).message}`);
  }
  printSummary(analyzePlan(loaded.plan), loaded.label);
  say();
  const size = `${Math.round(Buffer.byteLength(html) / 1024)} KB`;
  if (stats) say(`  Wrote ${bold(file)} (${size}). Removed ${plural(stats.sensitive, 'sensitive value')} and ${plural(stats.suspected, 'value that looks like a secret', 'values that look like secrets')}.`);
  else say(`  Wrote ${bold(file)} (${size}). ${red('It contains sensitive values in plain text, so treat it like a secret.')}`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        'include-sensitive': { type: 'boolean' },
        chdir: { type: 'string' },
        tofu: { type: 'boolean' },
        bin: { type: 'string' },
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    process.stderr.write(`planlens: ${(e as Error).message}\nRun planlens --help for usage.\n`);
    return 2;
  }
  const o = parsed.values as Options, pos = parsed.positionals;
  if (o.version) { say(pkg.version); return 0; }
  if (o.help) { process.stdout.write(HELP); return 0; }
  if (!pos.length) { process.stdout.write(HELP); return 2; }

  const cmd = pos[0] === 'export' || pos[0] === 'demo' || pos[0] === 'view' ? pos[0] : 'view';
  const args = cmd === pos[0] ? pos.slice(1) : pos;
  if (cmd === 'demo') return view({ plan: demoPlan as unknown as Plan, label: 'Demo plan' }, 'demo', o);
  if (args.length !== 1) {
    process.stderr.write(`planlens: ${cmd === 'export' ? 'export' : 'planlens'} takes one plan file, for example: planlens ${cmd === 'export' ? 'export ' : ''}tfplan\n`);
    return 2;
  }
  const loaded = await readPlan(args[0], { chdir: o.chdir, bins: o.bin ? [o.bin] : o.tofu ? ['tofu'] : ['terraform', 'tofu'] });
  return cmd === 'export' ? exportReport(loaded, o) : view(loaded, 'live', o);
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code; },
  e => {
    process.stderr.write(`planlens: ${(e as Error).message}\n`);
    process.exitCode = 1;
  },
);
