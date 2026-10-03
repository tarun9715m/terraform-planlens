import { diffChange, type DiffNode } from './diff';
import type { ResourceChange } from './types';
import { andList, fmtSteps, isNil, parseAddr } from './util';

export type Kind = 'create' | 'update' | 'replace' | 'delete' | 'read' | 'import' | 'move' | 'forget' | 'noop' | 'other';

export const KIND: Record<Kind, { g: string; label: string }> = {
  create: { g: '+', label: 'create' },
  update: { g: '~', label: 'update' },
  replace: { g: '-/+', label: 'replace' },
  delete: { g: '-', label: 'destroy' },
  read: { g: '<=', label: 'read' },
  import: { g: '↓', label: 'import' },
  move: { g: '→', label: 'move' },
  forget: { g: '.', label: 'forget' },
  noop: { g: '=', label: 'no change' },
  other: { g: '?', label: 'other' },
};
export const ACTION_ORDER: Kind[] = ['delete', 'replace', 'update', 'create', 'read', 'import', 'move', 'forget', 'other', 'noop'];
export const GROUP_LABEL: Record<Kind, string> = { delete: 'Destroy', replace: 'Replace', update: 'Update in place', create: 'Create', read: 'Read during apply', import: 'Import', move: 'Move', forget: 'Forget', other: 'Other', noop: 'No change' };
export const SHORT: Record<Kind, string> = { delete: 'Destroy', replace: 'Replace', update: 'Update', create: 'Create', read: 'Read', import: 'Import', move: 'Move', forget: 'Forget', other: 'Other', noop: 'No change' };
export const kindGlyph = (k: Kind): string => (k === 'replace' ? '-/+' : KIND[k].g);

const ACTIONS: Record<string, Kind> = {
  'create': 'create', 'update': 'update', 'delete,create': 'replace', 'create,delete': 'replace',
  'create,forget': 'replace', 'forget,create': 'replace', 'delete': 'delete', 'read': 'read', 'forget': 'forget', 'no-op': 'noop',
};

// Resource types whose destruction loses data. Destroying or replacing them gets a "holds data" warning.
const STATEFUL = /^(aws_(db_instance|rds_cluster|rds_cluster_instance|dynamodb_table|s3_bucket|efs_file_system|ebs_volume|elasticache_(cluster|replication_group|serverless_cache)|opensearch_domain|elasticsearch_domain|redshift_cluster|docdb_cluster|neptune_cluster|msk_cluster|kinesis_stream|sqs_queue|kms_key|secretsmanager_secret|route53_zone|cognito_user_pool|backup_vault|ecr_repository|memorydb_cluster)|google_(sql_database_instance|sql_database|storage_bucket|bigquery_(dataset|table)|compute_disk|spanner_(instance|database)|redis_instance|filestore_instance|kms_crypto_key|firestore_database|bigtable_instance)|azurerm_(storage_account|storage_container|mssql_(server|database)|postgresql_(flexible_)?server|mysql_(flexible_)?server|cosmosdb_account|key_vault|managed_disk|redis_cache)|kubernetes_(persistent_volume|persistent_volume_claim|namespace|stateful_set)(_v1)?)$/;

/** Attributes terraform plan always prints for context, even when unchanged. */
export const CONTEXT = new Set<string | number>(['id', 'name', 'tags']);
/** Kinds whose diff is a single column of values rather than before/after. */
export const SINGLE = new Set<Kind>(['create', 'delete', 'read', 'forget', 'import', 'move', 'noop']);

export interface Stats {
  changed: number;
  unknown: number;
  force: string[];
  hidden: number;
  sens: number;
  sensChanged: number;
  secrets: string[];
  decoded: number;
  attrs: number;
  paths: string[];
}
export interface Warning {
  t: string;
  c?: 'warn' | 'caution' | 'info';
  code?: boolean;
}
export interface Cause {
  t: 'from' | 'source' | 'drift';
  addr?: string;
  ids?: string[];
}
export interface Affect {
  key: string;
  id?: string;
  label: string;
}

export interface Res {
  id: string;
  rc: ResourceChange;
  address: string;
  kind: Kind;
  actions: string[];
  glyph: string;
  /** create_before_destroy replacement */
  cbd: boolean;
  /** replacement that forgets (keeps) the old object instead of destroying it */
  forgetOld: boolean;
  imported: boolean;
  moved: boolean;
  module: string;
  mode: string;
  type: string;
  name: string;
  index?: string | number;
  deposed?: string;
  local: string;
  stateful: boolean;
  destructive: boolean;
  tree?: DiffNode;
  st?: Stats;
  warn: Warning[];
  drift?: boolean;
  /** For drift entries: terraform plan prints this drift (it feeds into the plan). */
  relevant?: boolean;
  renameTo?: Res;
  renameOf?: Res;
  causes: Map<string | number, Cause[]>;
  affects: Affect[];
}

export function makeRes(rc: ResourceChange, i: number, prefix: string): Res {
  const acts = rc.change?.actions ?? [];
  const key = acts.join(',');
  let kind: Kind = ACTIONS[key] ?? 'other';
  const imported = !!rc.change?.importing;
  const moved = !!(rc.previous_address && rc.previous_address !== rc.address);
  if (kind === 'noop' && imported) kind = 'import';
  else if (kind === 'noop' && moved) kind = 'move';
  const p = rc.type && rc.name
    ? { module: rc.module_address ?? '', mode: rc.mode ?? 'managed', type: rc.type, name: rc.name, index: rc.index }
    : parseAddr(rc.address ?? '');
  const address = rc.address || '(unknown address)';
  const module = p.module;
  const forgetOld = key === 'create,forget' || key === 'forget,create';
  return {
    id: prefix + i, rc, address, kind, actions: acts,
    glyph: kind !== 'replace' ? KIND[kind].g : key === 'create,delete' ? '+/-' : key === 'create,forget' ? '+/.' : key === 'forget,create' ? './+' : '-/+',
    cbd: key === 'create,delete', forgetOld, imported, moved,
    module, mode: p.mode, type: p.type || '', name: p.name || '', index: p.index, deposed: rc.deposed,
    local: module && address.startsWith(module + '.') ? address.slice(module.length + 1) : address,
    stateful: STATEFUL.test(p.type || ''),
    destructive: (kind === 'replace' && !forgetOld) || kind === 'delete',
    warn: [], causes: new Map(), affects: [],
  };
}

function countHidden(n: DiffNode, isRoot: boolean): number {
  if (!n.kids || n.st !== 'chg') return 0;
  let h = 0;
  for (const k of n.kids) {
    if (k.st === 'same') {
      if ((k.kind === 'leaf' && isNil(k.b) && isNil(k.a)) || (isRoot && CONTEXT.has(k.key))) continue;
      h++;
    } else h += countHidden(k, false);
  }
  return h;
}

function analyze(r: Res, tree: DiffNode): Stats {
  const s: Stats = { changed: 0, unknown: 0, force: [], hidden: 0, sens: 0, sensChanged: 0, secrets: [], decoded: 0, attrs: 0, paths: [] };
  const visit = (n: DiffNode) => {
    if (n.force) s.force.push(n.path);
    if (n.kind === 'obj' || n.kind === 'arr') { n.kids?.forEach(visit); return; }
    if (!(isNil(n.b) && isNil(n.a) && !n.unk)) s.attrs++;
    if (n.unk) s.unknown++;
    else if (n.st !== 'same') { s.changed++; s.paths.push(n.path); }
    if (n.sensA || n.sensB) { s.sens++; if (n.st !== 'same') s.sensChanged++; }
    if (n.secret && n.st !== 'same') s.secrets.push(n.path);
    if ((n.kind === 'json' || n.kind === 'b64') && n.st !== 'same') s.decoded++;
  };
  visit(tree);
  if (r.kind === 'update' || r.kind === 'replace') s.hidden = countHidden(tree, true);
  return s;
}

/** Build (once) and return the attribute diff for a resource. */
export function treeOf(r: Res): DiffNode {
  if (!r.tree) {
    r.tree = diffChange(r.id + '.', r.rc.change ?? { actions: [] });
    r.st = analyze(r, r.tree);
  }
  return r.tree;
}

/** Signals that destroying or replacing this resource could lose data or cause a gap. */
export function warnings(r: Res): Warning[] {
  const w: Warning[] = [];
  if (!r.destructive) return w;
  const b = (r.rc.change?.before ?? {}) as Record<string, unknown>;
  if (r.stateful) w.push({ t: 'holds data', c: 'warn' });
  if (b.skip_final_snapshot === true) w.push({ t: 'skip_final_snapshot = true', c: 'warn', code: true });
  else if (r.stateful && 'final_snapshot_identifier' in b && !b.final_snapshot_identifier && !('skip_final_snapshot' in b)) w.push({ t: 'no final snapshot', c: 'warn' });
  if (r.stateful && b.deletion_protection === false) w.push({ t: 'deletion_protection = false', c: 'caution', code: true });
  if (b.force_destroy === true) w.push({ t: 'force_destroy = true', c: 'warn', code: true });
  if (r.kind === 'replace' && !r.cbd) w.push({ t: 'old one destroyed before the new one exists', c: 'caution' });
  return w;
}

export interface ReasonContext {
  model: Res[];
  driftByAddr: Map<string, Res>;
}

/** Why the resource is in the plan: [bold verb, rest]. Backticks mark code. */
export function reasonParts(r: Res, ctx: ReasonContext): [string, string] {
  const rc = r.rc, ch = rc.change ?? { actions: [] };
  const c = (s: string) => '`' + s + '`';
  const paths = (ch.replace_paths ?? []).map(p => c(fmtSteps(p)));
  const moduleGone = !!r.module && ctx.model.filter(x => x.module === r.module).every(x => x.kind === 'delete');
  switch (rc.action_reason) {
    case 'replace_because_cannot_update': return ['Must be replaced', paths.length ? `: ${andList(paths)} can't be changed in place.` : `: the provider can't update it in place.`];
    case 'replace_because_tainted': return ['Must be replaced', ' because it is tainted.'];
    case 'replace_by_request': return ['Will be replaced', ` as requested with ${c('-replace')}.`];
    case 'replace_by_triggers': return ['Will be replaced', ` because something in its ${c('replace_triggered_by')} list changed.`];
    case 'delete_because_no_resource_config':
      if (r.kind === 'forget') return ['Will be forgotten', `: Terraform stops managing it, but a ${c('removed')} block keeps the real object (${c('destroy = false')}).`];
      return ['Will be destroyed', moduleGone ? ` because ${c(r.module)} is no longer in the configuration.` : ` because ${c(r.local)} is no longer in the configuration.`];
    case 'delete_because_no_module': return ['Will be destroyed', ` because ${c(r.module)} is no longer in the configuration.`];
    case 'delete_because_wrong_repetition': return ['Will be destroyed', ` because the resource switched between ${c('count')}, ${c('for_each')} and a single instance.`];
    case 'delete_because_count_index': return ['Will be destroyed', ` because index [${rc.index}] is out of range for ${c('count')}.`];
    case 'delete_because_each_key': return ['Will be destroyed', ` because key ${c(JSON.stringify(rc.index))} is not in the ${c('for_each')} map.`];
    case 'delete_because_no_move_target': return ['Will be destroyed', ` because it was moved to an address that isn't in the configuration.`];
    case 'delete_because_enabled_false': return ['Will be destroyed', ` because ${c('enabled')} is false.`];
    case 'forgot_because_lifecycle_destroy_in_config':
    case 'forgot_because_lifecycle_destroy_in_state': return ['Will be forgotten', `: ${c('lifecycle { destroy = false }')} keeps the real object.`];
    case 'read_because_config_unknown': return ['Will be read during apply', ' because its configuration uses values that are not known yet.'];
    case 'read_because_dependency_pending': return ['Will be read during apply', ' because it depends on a resource with changes pending.'];
    case 'read_because_check_nested': return ['Will be read during apply', ` to verify a ${c('check')} block.`];
  }
  const imp = ch.importing ?? {};
  const impId = imp.id !== undefined ? c(String(imp.id)) : imp.identity ? c(JSON.stringify(imp.identity)) : 'an ID known after apply';
  switch (r.kind) {
    case 'create': {
      const d = ctx.driftByAddr.get(r.address);
      return d && d.kind === 'delete' ? ['Will be created again', ': it was deleted outside Terraform.'] : ['Will be created', '.'];
    }
    case 'update': return ['Will be updated in place', (r.imported ? `, after importing ${impId}` : '') + (r.moved ? `. Moved from ${c(rc.previous_address ?? '')}` : '') + '.'];
    case 'replace': return r.forgetOld ? ['Will be replaced', ', but the existing object is forgotten, not destroyed.'] : ['Must be replaced', '.'];
    case 'delete': return ['Will be destroyed', r.deposed ? `: deposed object ${c(r.deposed)} left over from a failed replacement.` : '.'];
    case 'read': return ['Will be read during apply', '.'];
    case 'import': return ['Will be imported', ` from ${impId}. The real resource doesn't change.`];
    case 'move': return ['Has moved', ` from ${c(rc.previous_address ?? '')}. The real resource doesn't change.`];
    case 'forget': return ['Will be forgotten', ': Terraform stops managing it but does not destroy it.'];
    case 'noop': return ['No changes', '.'];
    default: return ['Planned actions', `: ${c(r.actions.join(', '))}.`];
  }
}
export const reasonText = (r: Res, ctx: ReasonContext): string => reasonParts(r, ctx).join('');

const RISK: Record<Kind, number> = { replace: 1, delete: 2, update: 3, create: 4, read: 5, import: 6, move: 7, forget: 8, other: 9, noop: 10 };
const riskScore = (r: Res): number => (r.destructive && r.stateful ? 0 : RISK[r.kind]) + (r.kind === 'replace' && !r.destructive ? 2.5 : 0);
export const byAddr = (a: Res, b: Res): number => a.address.localeCompare(b.address);
export const byRisk = (a: Res, b: Res): number => riskScore(a) - riskScore(b) || byAddr(a, b);
export const byAction = (a: Res, b: Res): number => ACTION_ORDER.indexOf(a.kind) - ACTION_ORDER.indexOf(b.kind) || byRisk(a, b);
