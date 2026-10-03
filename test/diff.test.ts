import { describe, expect, it } from 'vitest';
import { b64text, diffChange, looksSecret, type DiffNode } from '../src/core/diff';

const kid = (n: DiffNode, key: string | number): DiffNode => {
  const k = n.kids?.find(x => x.key === key);
  if (!k) throw new Error(`no child ${String(key)} in ${n.path || 'root'}`);
  return k;
};
const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe('diffChange', () => {
  it('marks added, removed, changed and unchanged attributes', () => {
    const t = diffChange('t.', { before: { a: 1, b: 2, gone: 'x' }, after: { a: 1, b: 3, c: 4 } });
    expect(t.st).toBe('chg');
    expect(kid(t, 'a').st).toBe('same');
    expect(kid(t, 'b').st).toBe('chg');
    expect(kid(t, 'c').st).toBe('add');
    expect(kid(t, 'gone').st).toBe('del');
  });

  it('treats values in after_unknown as known after apply, even when absent from after', () => {
    const t = diffChange('t.', { before: { id: 'i-1', name: 'web' }, after: { name: 'web' }, after_unknown: { id: true } });
    expect(kid(t, 'id')).toMatchObject({ unk: true, st: 'chg' });
    const created = diffChange('t.', { before: null, after: { name: 'web' }, after_unknown: { arn: true } });
    expect(kid(created, 'arn')).toMatchObject({ unk: true, st: 'add' });
  });

  it('marks sensitive values and still detects whether they changed', () => {
    const same = diffChange('t.', { before: { password: 'a' }, after: { password: 'a' }, before_sensitive: { password: true }, after_sensitive: { password: true } });
    expect(kid(same, 'password')).toMatchObject({ sensA: true, sensB: true, st: 'same' });
    const changed = diffChange('t.', { before: { password: 'a' }, after: { password: 'b' }, before_sensitive: { password: true }, after_sensitive: { password: true } });
    expect(kid(changed, 'password').st).toBe('chg');
  });

  it('diffs lists by matching identical elements first', () => {
    const t = diffChange('t.', { before: { ports: [80, 443] }, after: { ports: [443, 8080] } });
    expect(kid(t, 'ports').kids?.map(k => [k.b ?? k.a, k.st])).toEqual([[80, 'del'], [443, 'same'], [8080, 'add']]);
  });

  it('pairs changed list elements so a field change shows as one change, not a remove and an add', () => {
    const rule = (port: number, cidr: string) => ({ port, cidr });
    const t = diffChange('t.', { before: { rules: [rule(80, '0.0.0.0/0'), rule(22, '10.0.0.0/8')] }, after: { rules: [rule(443, '0.0.0.0/0'), rule(22, '10.0.0.0/8')] } });
    const first = kid(kid(t, 'rules'), 0);
    expect(first.st).toBe('chg');
    expect(kid(first, 'port')).toMatchObject({ b: 80, a: 443, st: 'chg' });
    expect(kid(first, 'cidr').st).toBe('same');
  });

  it('matches set elements by similarity when the counts differ', () => {
    const r = (from_port: number, desc: string, cidr: string) => ({ cidr_blocks: [cidr], description: desc, from_port, protocol: 'tcp', to_port: from_port });
    const before = [r(80, 'HTTP', '0.0.0.0/0'), r(443, 'HTTPS', '0.0.0.0/0'), r(22, 'SSH', '0.0.0.0/0'), r(3389, '', '0.0.0.0/0')];
    const after = [r(443, 'HTTPS', '0.0.0.0/0'), r(22, 'SSH', '10.20.0.0/16')];
    const ingress = kid(diffChange('t.', { before: { ingress: before }, after: { ingress: after } }), 'ingress');
    const sts = ingress.kids!.map(k => `${(k.b as { from_port?: number } | undefined)?.from_port ?? (k.a as { from_port: number }).from_port}:${k.st}`);
    expect(sts).toEqual(['80:del', '443:same', '3389:del', '22:chg']);
  });

  it('decodes JSON documents inside strings', () => {
    const pol = (actions: string[]) => JSON.stringify({ Statement: [{ Action: actions, Effect: 'Allow' }], Version: '2012-10-17' });
    const t = diffChange('t.', { before: { policy: pol(['s3:GetObject']) }, after: { policy: pol(['s3:GetObject', 's3:PutObject']) } });
    const policy = kid(t, 'policy');
    expect(policy.kind).toBe('json');
    const action = kid(kid(kid(policy, 'Statement'), 0), 'Action');
    expect(action.kids?.map(k => k.st)).toEqual(['same', 'add']);
  });

  it('flags JSON that changed only in formatting', () => {
    const t = diffChange('t.', { before: { p: '{"a":1,"b":2}' }, after: { p: '{ "b": 2, "a": 1 }' } });
    expect(kid(t, 'p')).toMatchObject({ kind: 'json', st: 'chg', fmtOnly: true });
  });

  it('decodes base64 text such as user data and diffs it line by line', () => {
    const old = '#!/bin/bash\nset -e\nsystemctl enable --now agent\n';
    const neu = '#!/bin/bash\nset -e\nsystemctl enable --now agent\ncurl -fsSL https://example.invalid/install.sh | bash\n';
    const ud = kid(diffChange('t.', { before: { user_data: enc(old) }, after: { user_data: enc(neu) } }), 'user_data');
    expect(ud.kind).toBe('b64');
    expect(ud.ops?.filter(o => o.t === 'add').map(o => o.s)).toEqual(['curl -fsSL https://example.invalid/install.sh | bash']);
  });

  it('leaves hashes and binary base64 alone', () => {
    expect(b64text('kY3n4Fv0q1mXqv0yZ3gT1m8l2u8c6f8H2a3t5qvZ0bE=')).toBeNull();
  });

  it('diffs multi-line strings line by line', () => {
    const t = diffChange('t.', { before: { s: 'a\nb\nc\n' }, after: { s: 'a\nB\nc\n' } });
    expect(kid(t, 's').ops?.map(o => `${o.t}:${o.s}`)).toEqual(['same:a', 'del:b', 'add:B', 'same:c']);
  });

  it('marks forced replacement paths', () => {
    const t = diffChange('t.', { before: { ami: 'a', size: 1 }, after: { ami: 'b', size: 1 }, replace_paths: [['ami']] });
    expect(kid(t, 'ami').force).toBe(true);
    expect(kid(t, 'size').force).toBeUndefined();
  });

  it('flags values that look like secrets but are not marked sensitive', () => {
    const t = diffChange('t.', { before: { env: { SESSION_SECRET: 'abc123456' } }, after: { env: { SESSION_SECRET: 'def987654' } } });
    expect(kid(kid(t, 'env'), 'SESSION_SECRET').secret).toBe(true);
  });
});

describe('looksSecret', () => {
  it.each([
    ['password', 'hunter2-old', true],
    ['DB_PASSWORD', 'x1y2z3w4', true],
    ['api_key', 'abcdef123', true],
    ['secret_arn', 'arn:aws:secretsmanager:us-east-1:1:secret:x', false],
    ['token_type', 'Bearer-xyz', false],
    ['kms_key_id', 'alias/aws/ssm', false],
    ['passthrough', 'enabled-yes', false],
    ['password', 'short', false],
  ])('%s = %s → %s', (key, value, expected) => {
    expect(looksSecret(key, value)).toBe(expected);
  });
});
