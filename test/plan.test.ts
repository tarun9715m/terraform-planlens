import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { causeFrom, movedBlock } from '../src/core/insight';
import { reasonText } from '../src/core/model';
import { analyzePlan, parsePlanText, tfPlanLine } from '../src/core/plan';
import { summaryMarkdown } from '../src/core/summary';
import type { Plan } from '../src/core/types';

const load = (p: string): Plan => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as Plan;
const real = load('./fixtures/real-terraform-1.16.json');
const demo = load('../src/samples/aws-demo.json');

describe('real Terraform 1.16 plan', () => {
  const pm = analyzePlan(real);
  const res = (address: string) => {
    const r = pm.model.find(x => x.address === address);
    if (!r) throw new Error(`missing ${address}`);
    return r;
  };

  it('classifies every action', () => {
    expect(pm.g.c).toEqual({ create: 2, update: 1, replace: 6, delete: 4, read: 1, import: 1, move: 1, forget: 1, noop: 5, other: 0 });
  });

  it('prints the same summary line Terraform printed for this plan', () => {
    expect(tfPlanLine(pm.g)).toBe('Plan: 1 to import, 8 to add, 1 to change, 10 to destroy.');
  });

  it('tells create-before-destroy replacements apart', () => {
    expect(res('terraform_data.cbd')).toMatchObject({ kind: 'replace', cbd: true, glyph: '+/-' });
    expect(res('terraform_data.replaceme')).toMatchObject({ kind: 'replace', cbd: false, glyph: '-/+' });
  });

  it('explains why each resource is in the plan', () => {
    expect(reasonText(res('terraform_data.replaceme'), pm)).toBe("Must be replaced: `triggers_replace` can't be changed in place.");
    expect(reasonText(res('terraform_data.counted[2]'), pm)).toBe('Will be destroyed because index [2] is out of range for `count`.');
    expect(reasonText(res('terraform_data.eached["c"]'), pm)).toBe('Will be destroyed because key `"c"` is not in the `for_each` map.');
    expect(reasonText(res('terraform_data.tainted'), pm)).toBe('Must be replaced because it is tainted.');
    expect(reasonText(res('terraform_data.trig'), pm)).toContain('replace_triggered_by');
    expect(reasonText(res('terraform_data.forgetme'), pm)).toMatch(/^Will be forgotten/);
    expect(reasonText(res('local_file.drifted'), pm)).toBe('Will be created again: it was deleted outside Terraform.');
    expect(reasonText(res('random_string.imported'), pm)).toContain('`importme`');
    expect(reasonText(res('terraform_data.new_name'), pm)).toContain('`terraform_data.old_name`');
  });

  it('finds drift that terraform plan does not print', () => {
    expect(pm.drift.map(d => [d.address, d.kind, d.relevant])).toEqual([['local_file.drifted', 'delete', false]]);
    expect(pm.g.driftHidden).toBe(1);
  });

  it('counts unchanged attributes terraform plan would hide', () => {
    expect(res('terraform_data.app').st?.hidden).toBeGreaterThan(0);
  });

  it('flags the plain-text password terraform plan prints inside the old output value', () => {
    expect(res('terraform_data.app').st?.secrets).toEqual(['output']);
  });

  it('links a deferred read to the resource it depends on', () => {
    expect(causeFrom(res('data.local_file.readback')).map(c => c.addr)).toEqual(['local_file.cfg']);
  });

  it('links outputs to the resources they come from', () => {
    expect(pm.outCauses.get('app_out')?.map(c => c.addr)).toEqual(['terraform_data.app']);
    expect(pm.outCauses.get('readback')?.map(c => c.addr)).toEqual(['data.local_file.readback']);
  });
});

describe('demo plan', () => {
  const pm = analyzePlan(demo);
  const res = (address: string) => {
    const r = pm.model.find(x => x.address === address);
    if (!r) throw new Error(`missing ${address}`);
    return r;
  };

  it('detects renames and count-to-for_each switches, with moved blocks', () => {
    expect(pm.renames.map(p => `${p.from.address} -> ${p.to.address}`)).toEqual([
      'aws_s3_bucket.uploads -> aws_s3_bucket.user_uploads',
      'aws_sns_topic.alerts[0] -> aws_sns_topic.alerts["oncall"]',
      'aws_sns_topic.alerts[1] -> aws_sns_topic.alerts["billing"]',
    ]);
    expect(movedBlock(pm.renames[0])).toBe('moved {\n  from = aws_s3_bucket.uploads\n  to   = aws_s3_bucket.user_uploads\n}');
  });

  it('does not pair resources whose identifying names differ', () => {
    expect(res('aws_elasticache_cluster.sessions').renameTo).toBeUndefined();
  });

  it('explains which change causes which', () => {
    const lambda = res('aws_lambda_function.api');
    expect(lambda.causes.get('environment')?.map(c => c.addr)).toEqual(['aws_db_instance.primary']);
    expect(res('aws_db_instance.primary').affects.map(a => a.label)).toEqual([
      'aws_cloudwatch_metric_alarm.db_cpu',
      'aws_lambda_function.api',
      'output db_endpoint',
    ]);
  });

  it('follows module variables back to their source', () => {
    const lt = res('module.workers.aws_launch_template.this');
    expect(lt.causes.get('image_id')).toEqual([{ t: 'source', addr: 'data.aws_ami.web' }]);
    const asg = res('module.workers.aws_autoscaling_group.this');
    expect(asg.causes.get('launch_template')?.map(c => c.addr)).toEqual(['module.workers.aws_launch_template.this']);
  });

  it('marks values that the plan sets back after a change outside Terraform', () => {
    expect(res('aws_security_group.web').causes.get('ingress')).toContainEqual({ t: 'drift' });
  });

  it('warns about data loss on destructive changes', () => {
    expect(res('aws_db_instance.primary').warn.map(w => w.t)).toEqual([
      'holds data', 'skip_final_snapshot = true', 'deletion_protection = false', 'old one destroyed before the new one exists',
    ]);
  });

  it('writes a Markdown summary with moved blocks', () => {
    const md = summaryMarkdown(pm);
    expect(md).toContain('**Review first**');
    expect(md).toContain('```hcl\nmoved {');
  });
});

describe('parsePlanText', () => {
  it('accepts plan JSON', () => {
    expect('plan' in parsePlanText(JSON.stringify(real), 'plan.json')).toBe(true);
  });
  it('explains binary plan files, text output, state JSON and broken JSON', () => {
    const err = (text: string) => {
      const r = parsePlanText(text, 'f');
      return 'error' in r ? r.error : '';
    };
    expect(err('PK\u0003\u0004binary')).toContain('binary plan file');
    expect(err('Terraform will perform the following actions:\n')).toContain('text output of terraform plan');
    expect(err(JSON.stringify({ format_version: '1.0', values: {} }))).toContain('state JSON');
    expect(err('{"broken"')).toContain("isn't valid JSON");
  });
});
