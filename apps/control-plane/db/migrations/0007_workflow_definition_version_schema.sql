create table if not exists workflow_definitions (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  slug text not null,
  name text not null,
  description text,
  draft_graph_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint workflow_definitions_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete cascade,
  constraint workflow_definitions_scope_id_unique unique (tenant_id, project_id, id),
  constraint workflow_definitions_slug_unique unique (tenant_id, project_id, slug),
  constraint workflow_definitions_slug_nonblank check (length(btrim(slug)) > 0),
  constraint workflow_definitions_name_nonblank check (length(btrim(name)) > 0),
  constraint workflow_definitions_draft_graph_is_object check (jsonb_typeof(draft_graph_json) = 'object'),
  constraint workflow_definitions_metadata_is_object check (jsonb_typeof(metadata_json) = 'object')
);

create table if not exists workflow_versions (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  workflow_id uuid not null,
  version_number integer not null,
  graph_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  published_at timestamptz not null,
  created_at timestamptz not null,
  constraint workflow_versions_workflow_scope_fk foreign key (tenant_id, project_id, workflow_id) references workflow_definitions(tenant_id, project_id, id) on delete cascade,
  constraint workflow_versions_scope_id_unique unique (tenant_id, project_id, id),
  constraint workflow_versions_workflow_id_unique unique (tenant_id, project_id, workflow_id, id),
  constraint workflow_versions_number_unique unique (tenant_id, project_id, workflow_id, version_number),
  constraint workflow_versions_positive_number check (version_number > 0),
  constraint workflow_versions_graph_is_object check (jsonb_typeof(graph_json) = 'object'),
  constraint workflow_versions_metadata_is_object check (jsonb_typeof(metadata_json) = 'object')
);

create table if not exists workflow_runs (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  workflow_id uuid not null,
  workflow_version_id uuid not null,
  state text not null,
  idempotency_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint workflow_runs_workflow_scope_fk foreign key (tenant_id, project_id, workflow_id) references workflow_definitions(tenant_id, project_id, id) on delete cascade,
  constraint workflow_runs_version_scope_fk foreign key (tenant_id, project_id, workflow_version_id) references workflow_versions(tenant_id, project_id, id),
  constraint workflow_runs_version_matches_workflow_fk foreign key (tenant_id, project_id, workflow_id, workflow_version_id) references workflow_versions(tenant_id, project_id, workflow_id, id),
  constraint workflow_runs_scope_id_unique unique (tenant_id, project_id, id),
  constraint workflow_runs_idempotency_key_unique unique (tenant_id, project_id, workflow_id, idempotency_key),
  constraint workflow_runs_state_check check (state in ('queued', 'running', 'completed', 'failed', 'canceled')),
  constraint workflow_runs_idempotency_nonblank check (length(btrim(idempotency_key)) > 0)
);

create index if not exists workflow_definitions_project_idx
  on workflow_definitions (tenant_id, project_id, created_at);

create index if not exists workflow_versions_workflow_idx
  on workflow_versions (tenant_id, project_id, workflow_id, version_number desc);

create index if not exists workflow_runs_workflow_idx
  on workflow_runs (tenant_id, project_id, workflow_id, created_at desc);
