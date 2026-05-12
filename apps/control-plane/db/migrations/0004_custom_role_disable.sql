alter table custom_roles add column if not exists disabled_at timestamptz;

create index if not exists custom_roles_active_tenant_slug_idx
  on custom_roles (tenant_id, slug)
  where disabled_at is null;
