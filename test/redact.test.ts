import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzePlan } from '../src/core/plan';
import { MASK, MASK_CHANGED, SECRET_CHANGED, redactPlan } from '../src/core/redact';
import type { Plan } from '../src/core/types';

const load = (p: string): Plan => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as Plan;

describe('redactPlan', () => {
  const real = load('./fixtures/real-terraform-1.16.json');
  const { plan, stats } = redactPlan(real);
  const text = JSON.stringify(plan);

  it('removes every sensitive and secret-looking value from the real plan', () => {
    // The raw plan holds these in plain text: a sensitive variable, a sensitive() input and an unmarked password.
    expect(JSON.stringify(real)).toContain('hunter2-new');
    for (const secret of ['hunter2-old', 'hunter2-new', 's3cr3t']) expect(text).not.toContain(secret);
    expect(stats.sensitive).toBeGreaterThan(0);
    expect(stats.suspected).toBeGreaterThan(0);
  });

  it('drops the parts of the plan the viewer does not need', () => {
    expect(plan).not.toHaveProperty('variables');
    expect(plan).not.toHaveProperty('prior_state');
    expect(plan).not.toHaveProperty('planned_values');
    expect(text).not.toContain('constant_value');
  });

  it('keeps whether a sensitive value changed', () => {
    const app = plan.resource_changes!.find(r => r.address === 'terraform_data.app')!;
    const before = app.change.before as { input: { password: string } };
    const after = app.change.after as { input: { password: string } };
    expect([before.input.password, after.input.password]).toEqual([MASK, MASK_CHANGED]);
    const out = plan.output_changes!.app_out;
    expect(out.before).toBe(MASK);
  });

  it('still produces the same analysis for the viewer', () => {
    const a = analyzePlan(real), b = analyzePlan(plan);
    expect(b.g.c).toEqual(a.g.c);
    expect(b.renames.length).toBe(a.renames.length);
    expect(b.model.find(r => r.address === 'terraform_data.app')?.tree?.kids?.find(k => k.key === 'input')?.st).toBe('chg');
  });

  it('redacts unmarked secrets in the demo plan', () => {
    const { plan: demo } = redactPlan(load('../src/samples/aws-demo.json'));
    const lambda = demo.resource_changes!.find(r => r.address === 'aws_lambda_function.api')!;
    const env = (lambda.change.after as { environment: { variables: Record<string, string> }[] }).environment[0].variables;
    expect(env.SESSION_SECRET).toBe(SECRET_CHANGED);
    expect(env.LOG_LEVEL).toBe('warn');
  });
});
