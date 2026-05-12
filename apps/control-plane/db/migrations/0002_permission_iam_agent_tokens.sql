create table if not exists custom_roles (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  slug text not null,
  name text not null,
  permissions_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint custom_roles_slug_not_blank check (btrim(slug) <> ''),
  constraint custom_roles_name_not_blank check (btrim(name) <> ''),
  constraint custom_roles_permissions_json_array check (jsonb_typeof(permissions_json) = 'array'),
  constraint custom_roles_permissions_json_non_empty check (jsonb_array_length(permissions_json) > 0),
  constraint custom_roles_tenant_slug_unique unique (tenant_id, slug)
);

create index if not exists custom_roles_tenant_idx on custom_roles (tenant_id, slug);

create table if not exists project_api_keys (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  name text not null,
  key_prefix text not null,
  secret_hash_sha256 text not null,
  permissions_json jsonb not null,
  created_by_type text not null,
  created_by_id text not null,
  revoked_at timestamptz,
  revoked_by_type text,
  revoked_by_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_api_keys_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint project_api_keys_name_not_blank check (btrim(name) <> ''),
  constraint project_api_keys_key_prefix_not_blank check (btrim(key_prefix) <> ''),
  constraint project_api_keys_secret_hash_sha256_check check (secret_hash_sha256 ~ '^[a-f0-9]{64}$'),
  constraint project_api_keys_permissions_json_array check (jsonb_typeof(permissions_json) = 'array'),
  constraint project_api_keys_permissions_json_non_empty check (jsonb_array_length(permissions_json) > 0),
  constraint project_api_keys_created_by_not_blank check (btrim(created_by_type) <> '' and btrim(created_by_id) <> ''),
  constraint project_api_keys_revoked_by_pair_check check ((revoked_by_type is null and revoked_by_id is null) or (revoked_by_type is not null and revoked_by_id is not null)),
  constraint project_api_keys_key_prefix_unique unique (key_prefix)
);

create index if not exists project_api_keys_project_idx on project_api_keys (tenant_id, project_id, created_at desc);
create index if not exists project_api_keys_active_idx on project_api_keys (tenant_id, project_id, key_prefix) where revoked_at is null;

create table if not exists agents (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  name text not null,
  credential_prefix text not null,
  credential_hash_sha256 text not null,
  permissions_json jsonb not null,
  created_by_type text not null,
  created_by_id text not null,
  revoked_at timestamptz,
  revoked_by_type text,
  revoked_by_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agents_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint agents_name_not_blank check (btrim(name) <> ''),
  constraint agents_credential_prefix_not_blank check (btrim(credential_prefix) <> ''),
  constraint agents_credential_hash_sha256_check check (credential_hash_sha256 ~ '^[a-f0-9]{64}$'),
  constraint agents_permissions_json_array check (jsonb_typeof(permissions_json) = 'array'),
  constraint agents_permissions_json_non_empty check (jsonb_array_length(permissions_json) > 0),
  constraint agents_created_by_not_blank check (btrim(created_by_type) <> '' and btrim(created_by_id) <> ''),
  constraint agents_revoked_by_pair_check check ((revoked_by_type is null and revoked_by_id is null) or (revoked_by_type is not null and revoked_by_id is not null)),
  constraint agents_tenant_project_id_unique unique (tenant_id, project_id, id),
  constraint agents_credential_prefix_unique unique (credential_prefix)
);

create index if not exists agents_project_idx on agents (tenant_id, project_id, created_at desc);
create index if not exists agents_active_idx on agents (tenant_id, project_id, credential_prefix) where revoked_at is null;

create table if not exists agent_tokens (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  agent_id uuid not null,
  token_prefix text not null,
  token_hash_sha256 text not null,
  permissions_json jsonb not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_tokens_agent_scope_fk foreign key (tenant_id, project_id, agent_id) references agents(tenant_id, project_id, id) on delete restrict,
  constraint agent_tokens_token_prefix_not_blank check (btrim(token_prefix) <> ''),
  constraint agent_tokens_token_hash_sha256_check check (token_hash_sha256 ~ '^[a-f0-9]{64}$'),
  constraint agent_tokens_permissions_json_array check (jsonb_typeof(permissions_json) = 'array'),
  constraint agent_tokens_permissions_json_non_empty check (jsonb_array_length(permissions_json) > 0),
  constraint agent_tokens_expires_after_created check (expires_at > created_at),
  constraint agent_tokens_token_prefix_unique unique (token_prefix)
);

create index if not exists agent_tokens_agent_idx on agent_tokens (tenant_id, project_id, agent_id, created_at desc);
create index if not exists agent_tokens_active_idx on agent_tokens (token_prefix, expires_at) where revoked_at is null;
