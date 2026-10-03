// The parts of `terraform show -json <planfile>` (format_version 1.x) that planlens reads.
// OpenTofu writes the same shape. Unknown fields are ignored.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type PathStep = string | number;

export interface Change {
  actions: string[];
  before?: Json;
  after?: Json;
  /** Mirrors `after`; `true` marks values only known after apply. */
  after_unknown?: Json;
  /** Mirror `before`/`after`; `true` marks sensitive values. The values themselves are in plain text. */
  before_sensitive?: Json;
  after_sensitive?: Json;
  replace_paths?: PathStep[][];
  importing?: { id?: string; identity?: Json; unknown?: boolean };
  generated_config?: string;
}

export interface ResourceChange {
  address: string;
  previous_address?: string;
  module_address?: string;
  mode?: string;
  type?: string;
  name?: string;
  index?: string | number;
  provider_name?: string;
  deposed?: string;
  action_reason?: string;
  change: Change;
}

export interface ConfigExpression {
  constant_value?: Json;
  references?: string[];
  [nested: string]: unknown;
}

export interface ConfigResource {
  address: string;
  mode?: string;
  type?: string;
  name?: string;
  expressions?: Record<string, unknown>;
  depends_on?: string[];
  [other: string]: unknown;
}

export interface ConfigModule {
  resources?: ConfigResource[];
  outputs?: Record<string, { expression?: unknown; sensitive?: boolean }>;
  module_calls?: Record<string, { source?: string; expressions?: Record<string, unknown>; module?: ConfigModule }>;
  variables?: Record<string, unknown>;
}

export interface Plan {
  format_version?: string;
  terraform_version?: string;
  timestamp?: string;
  applyable?: boolean;
  complete?: boolean;
  errored?: boolean;
  variables?: Record<string, { value?: Json }>;
  planned_values?: unknown;
  prior_state?: unknown;
  resource_changes?: ResourceChange[];
  resource_drift?: ResourceChange[];
  output_changes?: Record<string, Change>;
  relevant_attributes?: { resource: string; attribute?: unknown }[];
  configuration?: { provider_config?: unknown; root_module?: ConfigModule };
  checks?: unknown;
  deferred_changes?: unknown[];
  action_invocations?: unknown[];
  [other: string]: unknown;
}
