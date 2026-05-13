create table if not exists jobs (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  state text not null default 'queued',
  priority integer not null default 0,
  max_attempts integer not null default 3,
  attempt_count integer not null default 0,
  ready_at timestamptz not null default now(),
  idempotency_key text,
  constraints_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint jobs_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint jobs_state_check check (state in ('queued', 'running', 'retrying', 'completed', 'failed', 'dead_lettered', 'canceled')),
  constraint jobs_priority_nonnegative check (priority >= 0),
  constraint jobs_max_attempts_positive check (max_attempts > 0),
  constraint jobs_attempt_count_nonnegative check (attempt_count >= 0),
  constraint jobs_attempt_count_within_max check (attempt_count <= max_attempts),
  constraint jobs_idempotency_key_not_blank check (idempotency_key is null or btrim(idempotency_key) <> ''),
  constraint jobs_constraints_is_object check (jsonb_typeof(constraints_json) = 'object'),
  constraint jobs_metadata_is_object check (jsonb_typeof(metadata_json) = 'object'),
  constraint jobs_finished_state_check check ((state in ('completed', 'failed', 'dead_lettered', 'canceled') and finished_at is not null) or (state not in ('completed', 'failed', 'dead_lettered', 'canceled') and finished_at is null)),
  constraint jobs_scope_id_unique unique (tenant_id, project_id, id)
);

create unique index if not exists jobs_idempotency_key_unique
  on jobs (tenant_id, project_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists jobs_ready_idx
  on jobs (tenant_id, project_id, state, ready_at, priority desc)
  where state in ('queued', 'retrying');

create index if not exists jobs_project_history_idx
  on jobs (tenant_id, project_id, updated_at desc);

create table if not exists job_attempts (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null,
  state text not null default 'running',
  agent_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_attempts_job_scope_fk foreign key (tenant_id, project_id, job_id) references jobs(tenant_id, project_id, id) on delete restrict,
  constraint job_attempts_agent_scope_fk foreign key (tenant_id, project_id, agent_id) references agents(tenant_id, project_id, id) on delete restrict,
  constraint job_attempts_state_check check (state in ('running', 'completed', 'failed', 'expired', 'canceled')),
  constraint job_attempts_attempt_number_positive check (attempt_number > 0),
  constraint job_attempts_failure_code_not_blank check (failure_code is null or btrim(failure_code) <> ''),
  constraint job_attempts_failure_message_not_blank check (failure_message is null or btrim(failure_message) <> ''),
  constraint job_attempts_finished_state_check check ((state in ('completed', 'failed', 'expired', 'canceled') and finished_at is not null) or (state = 'running' and finished_at is null)),
  constraint job_attempts_failure_state_check check ((state = 'failed' and failure_code is not null) or (state <> 'failed')),
  constraint job_attempts_scope_id_unique unique (tenant_id, project_id, id),
  constraint job_attempts_job_attempt_number_unique unique (tenant_id, project_id, job_id, attempt_number),
  constraint job_attempts_job_id_id_unique unique (tenant_id, project_id, job_id, id)
);

create index if not exists job_attempts_job_history_idx
  on job_attempts (tenant_id, project_id, job_id, attempt_number desc);

create index if not exists job_attempts_agent_history_idx
  on job_attempts (tenant_id, project_id, agent_id, started_at desc)
  where agent_id is not null;

create table if not exists job_leases (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  agent_id uuid not null,
  state text not null default 'active',
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_heartbeat_at timestamptz not null default now(),
  released_at timestamptz,
  expired_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_leases_job_scope_fk foreign key (tenant_id, project_id, job_id) references jobs(tenant_id, project_id, id) on delete restrict,
  constraint job_leases_attempt_job_scope_fk foreign key (tenant_id, project_id, job_id, attempt_id) references job_attempts(tenant_id, project_id, job_id, id) on delete restrict,
  constraint job_leases_agent_scope_fk foreign key (tenant_id, project_id, agent_id) references agents(tenant_id, project_id, id) on delete restrict,
  constraint job_leases_state_check check (state in ('active', 'released', 'expired', 'canceled')),
  constraint job_leases_expires_after_acquired check (expires_at > acquired_at),
  constraint job_leases_heartbeat_window_check check (last_heartbeat_at >= acquired_at and last_heartbeat_at <= expires_at),
  constraint job_leases_terminal_state_timestamp_check check (
    (state = 'active' and released_at is null and expired_at is null and canceled_at is null) or
    (state = 'released' and released_at is not null and expired_at is null and canceled_at is null) or
    (state = 'expired' and released_at is null and expired_at is not null and canceled_at is null) or
    (state = 'canceled' and released_at is null and expired_at is null and canceled_at is not null)
  ),
  constraint job_leases_scope_id_unique unique (tenant_id, project_id, id)
);

create unique index if not exists job_leases_active_attempt_unique
  on job_leases (tenant_id, project_id, attempt_id)
  where state = 'active';

create unique index if not exists job_leases_active_job_unique
  on job_leases (tenant_id, project_id, job_id)
  where state = 'active';

create index if not exists job_leases_project_history_idx
  on job_leases (tenant_id, project_id, updated_at desc);

create index if not exists job_leases_expiry_idx
  on job_leases (tenant_id, project_id, expires_at)
  where state = 'active';
