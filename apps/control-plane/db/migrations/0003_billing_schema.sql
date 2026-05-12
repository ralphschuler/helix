create table if not exists billing_stripe_customers (
  id uuid primary key,
  tenant_id uuid not null,
  organization_id uuid not null,
  stripe_customer_id text not null,
  billing_status text not null default 'unconfigured',
  current_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_stripe_customers_org_scope_fk foreign key (tenant_id, organization_id) references organizations(tenant_id, id) on delete restrict,
  constraint billing_stripe_customers_customer_id_not_blank check (btrim(stripe_customer_id) <> ''),
  constraint billing_stripe_customers_subscription_id_not_blank check (current_subscription_id is null or btrim(current_subscription_id) <> ''),
  constraint billing_stripe_customers_status_check check (billing_status in ('unconfigured', 'active', 'past_due', 'canceled', 'incomplete')),
  constraint billing_stripe_customers_tenant_org_unique unique (tenant_id, organization_id),
  constraint billing_stripe_customers_stripe_customer_unique unique (stripe_customer_id)
);

create index if not exists billing_stripe_customers_org_idx
  on billing_stripe_customers (tenant_id, organization_id);

create table if not exists billing_stripe_webhook_events (
  stripe_event_id text primary key,
  tenant_id uuid not null,
  organization_id uuid not null,
  stripe_customer_id text not null,
  event_type text not null,
  payload_json jsonb not null,
  processed_at timestamptz not null default now(),
  constraint billing_stripe_webhook_events_org_scope_fk foreign key (tenant_id, organization_id) references organizations(tenant_id, id) on delete restrict,
  constraint billing_stripe_webhook_events_event_id_not_blank check (btrim(stripe_event_id) <> ''),
  constraint billing_stripe_webhook_events_customer_id_not_blank check (btrim(stripe_customer_id) <> ''),
  constraint billing_stripe_webhook_events_event_type_not_blank check (btrim(event_type) <> ''),
  constraint billing_stripe_webhook_events_payload_is_object check (jsonb_typeof(payload_json) = 'object')
);

create index if not exists billing_stripe_webhook_events_org_processed_idx
  on billing_stripe_webhook_events (tenant_id, organization_id, processed_at desc);

create table if not exists billing_usage_ledger (
  id uuid primary key,
  tenant_id uuid not null,
  organization_id uuid not null,
  project_id uuid,
  usage_type text not null,
  quantity integer not null,
  idempotency_key text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  constraint billing_usage_ledger_org_scope_fk foreign key (tenant_id, organization_id) references organizations(tenant_id, id) on delete restrict,
  constraint billing_usage_ledger_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint billing_usage_ledger_usage_type_not_blank check (btrim(usage_type) <> ''),
  constraint billing_usage_ledger_quantity_positive check (quantity > 0),
  constraint billing_usage_ledger_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint billing_usage_ledger_metadata_is_object check (jsonb_typeof(metadata_json) = 'object'),
  constraint billing_usage_ledger_idempotency_unique unique (tenant_id, organization_id, idempotency_key)
);

create index if not exists billing_usage_ledger_org_recorded_idx
  on billing_usage_ledger (tenant_id, organization_id, recorded_at desc);

create index if not exists billing_usage_ledger_project_recorded_idx
  on billing_usage_ledger (tenant_id, project_id, recorded_at desc)
  where project_id is not null;
