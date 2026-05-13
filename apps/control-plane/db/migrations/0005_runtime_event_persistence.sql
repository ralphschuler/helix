create table if not exists runtime_events (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  event_type text not null,
  event_version integer not null,
  ordering_key text not null,
  payload_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  constraint runtime_events_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint runtime_events_type_not_blank check (btrim(event_type) <> ''),
  constraint runtime_events_version_positive check (event_version > 0),
  constraint runtime_events_ordering_key_not_blank check (btrim(ordering_key) <> ''),
  constraint runtime_events_payload_is_object check (jsonb_typeof(payload_json) = 'object'),
  constraint runtime_events_scope_id_unique unique (tenant_id, project_id, id)
);

create index if not exists runtime_events_project_occurred_idx
  on runtime_events (tenant_id, project_id, occurred_at desc);

create index if not exists runtime_events_project_type_idx
  on runtime_events (tenant_id, project_id, event_type, occurred_at desc);

create index if not exists runtime_events_ordering_key_idx
  on runtime_events (tenant_id, project_id, ordering_key, occurred_at desc);

create table if not exists runtime_outbox (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  event_id uuid not null,
  topic text not null,
  partition_key text not null,
  status text not null default 'pending',
  publish_attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runtime_outbox_event_scope_fk foreign key (tenant_id, project_id, event_id) references runtime_events(tenant_id, project_id, id) on delete restrict,
  constraint runtime_outbox_topic_not_blank check (btrim(topic) <> ''),
  constraint runtime_outbox_partition_key_not_blank check (btrim(partition_key) <> ''),
  constraint runtime_outbox_status_check check (status in ('pending', 'published', 'failed')),
  constraint runtime_outbox_publish_attempts_nonnegative check (publish_attempts >= 0),
  constraint runtime_outbox_published_status_check check ((status = 'published' and published_at is not null) or (status <> 'published')),
  constraint runtime_outbox_last_error_not_blank check (last_error is null or btrim(last_error) <> ''),
  constraint runtime_outbox_event_unique unique (event_id)
);

create index if not exists runtime_outbox_pending_idx
  on runtime_outbox (next_attempt_at, created_at)
  where published_at is null;

create index if not exists runtime_outbox_project_idx
  on runtime_outbox (tenant_id, project_id, created_at desc);

create table if not exists runtime_inbox (
  id uuid primary key,
  consumer_name text not null,
  event_id uuid not null,
  tenant_id uuid not null,
  project_id uuid not null,
  status text not null default 'processing',
  processing_started_at timestamptz not null default now(),
  processed_at timestamptz,
  attempt_count integer not null default 1,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint runtime_inbox_event_scope_fk foreign key (tenant_id, project_id, event_id) references runtime_events(tenant_id, project_id, id) on delete restrict,
  constraint runtime_inbox_consumer_name_not_blank check (btrim(consumer_name) <> ''),
  constraint runtime_inbox_status_check check (status in ('processing', 'processed', 'failed')),
  constraint runtime_inbox_attempt_count_positive check (attempt_count > 0),
  constraint runtime_inbox_processed_status_check check ((status = 'processed' and processed_at is not null) or (status <> 'processed')),
  constraint runtime_inbox_last_error_not_blank check (last_error is null or btrim(last_error) <> ''),
  constraint runtime_inbox_consumer_event_unique unique (consumer_name, event_id)
);

create index if not exists runtime_inbox_project_idx
  on runtime_inbox (tenant_id, project_id, updated_at desc);

create index if not exists runtime_inbox_retry_idx
  on runtime_inbox (tenant_id, project_id, status, updated_at)
  where status in ('processing', 'failed');
