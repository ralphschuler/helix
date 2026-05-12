create table if not exists tenants (
  id uuid primary key,
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_not_blank check (btrim(slug) <> ''),
  constraint tenants_name_not_blank check (btrim(name) <> ''),
  constraint tenants_slug_unique unique (slug)
);

create table if not exists organizations (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  slug text not null,
  name text not null,
  stytch_organization_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_not_blank check (btrim(slug) <> ''),
  constraint organizations_name_not_blank check (btrim(name) <> ''),
  constraint organizations_tenant_id_id_unique unique (tenant_id, id),
  constraint organizations_tenant_slug_unique unique (tenant_id, slug),
  constraint organizations_stytch_organization_id_unique unique (stytch_organization_id)
);

create table if not exists projects (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  organization_id uuid not null,
  slug text not null,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_org_tenant_fk foreign key (tenant_id, organization_id) references organizations(tenant_id, id) on delete restrict,
  constraint projects_slug_not_blank check (btrim(slug) <> ''),
  constraint projects_name_not_blank check (btrim(name) <> ''),
  constraint projects_status_check check (status in ('active', 'archived')),
  constraint projects_tenant_id_id_unique unique (tenant_id, id),
  constraint projects_tenant_slug_unique unique (tenant_id, slug)
);

create table if not exists audit_events (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  project_id uuid,
  actor_type text,
  actor_id text,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint audit_events_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint audit_events_actor_pair_check check ((actor_type is null and actor_id is null) or (actor_type is not null and actor_id is not null)),
  constraint audit_events_action_not_blank check (btrim(action) <> ''),
  constraint audit_events_resource_type_not_blank check (btrim(resource_type) <> ''),
  constraint audit_events_metadata_is_object check (jsonb_typeof(metadata_json) = 'object')
);

create index if not exists audit_events_tenant_occurred_at_idx on audit_events (tenant_id, occurred_at desc);
create index if not exists audit_events_project_occurred_at_idx on audit_events (tenant_id, project_id, occurred_at desc) where project_id is not null;
create index if not exists audit_events_action_idx on audit_events (tenant_id, action, occurred_at desc);

create table if not exists retention_policies (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  project_id uuid,
  target text not null,
  retain_for_days integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retention_policies_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint retention_policies_target_check check (target in ('events', 'checkpoints', 'logs', 'artifacts', 'audit_records', 'stream_replay')),
  constraint retention_policies_retain_for_days_check check (retain_for_days > 0)
);

create unique index if not exists retention_policies_tenant_target_unique
  on retention_policies (tenant_id, target)
  where project_id is null;

create unique index if not exists retention_policies_project_target_unique
  on retention_policies (tenant_id, project_id, target)
  where project_id is not null;
