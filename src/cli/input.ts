import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parsePlanText } from '../core/plan';
import type { Plan } from '../core/types';

export class CliError extends Error {}

export interface ReadOptions {
  /** Directory terraform runs in when converting a binary plan (the one where `terraform plan` ran). */
  chdir?: string;
  /** terraform or tofu binary; tried in order. */
  bins: string[];
}

export interface LoadedPlan {
  plan: Plan;
  label: string;
}

/** Saved plan files are zip archives. */
export const isBinaryPlan = (buf: Uint8Array): boolean => buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Read a plan from a JSON file, a saved binary plan file, or stdin (`-`). */
export async function readPlan(arg: string, opts: ReadOptions): Promise<LoadedPlan> {
  const fromStdin = arg === '-';
  const label = fromStdin ? 'plan from stdin' : basename(arg);
  let buf: Buffer;
  try {
    buf = fromStdin ? await readStdin() : await readFile(arg);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new CliError(code === 'ENOENT' ? `Can't find ${arg}.` : code === 'EISDIR' ? `${arg} is a directory. Pass the plan file, for example tfplan.` : `Can't read ${arg}: ${(e as Error).message}`);
  }
  const text = isBinaryPlan(buf) && !fromStdin ? await showJson(resolve(arg), opts) : buf.toString('utf8');
  const r = parsePlanText(text, label);
  if ('error' in r) throw new CliError(r.error.replace(/`/g, ''));
  return { plan: r.plan, label };
}

/** Convert a saved plan with `terraform show -json`, falling back to tofu when terraform is missing. */
async function showJson(planPath: string, opts: ReadOptions): Promise<string> {
  const cwd = opts.chdir ? resolve(opts.chdir) : process.cwd();
  let lastMissing = '';
  for (const bin of opts.bins) {
    const res = await run(bin, ['show', '-json', '-no-color', planPath], cwd);
    if (res.missing) { lastMissing = bin; continue; }
    if (res.code !== 0) {
      const detail = res.stderr.trim().split('\n').slice(0, 6).join('\n');
      throw new CliError(`${bin} show -json failed (exit ${res.code})${detail ? `:\n${detail}\n` : '.'}\nRun planlens in the directory where you ran ${bin} plan, or pass --chdir <dir>.`);
    }
    return res.stdout;
  }
  throw new CliError(`Couldn't find ${lastMissing || 'terraform'} on your PATH. Install Terraform or OpenTofu, pass --bin /path/to/terraform, or convert the plan yourself: terraform show -json tfplan > plan.json`);
}

function run(bin: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string; missing?: boolean }> {
  return new Promise(done => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TF_IN_AUTOMATION: '1' } });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on('data', d => out.push(d as Buffer));
    child.stderr.on('data', d => err.push(d as Buffer));
    child.on('error', e => done({ code: -1, stdout: '', stderr: e.message, missing: (e as NodeJS.ErrnoException).code === 'ENOENT' }));
    child.on('close', code => done({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
}
