alter table processor_registrations
  add column last_heartbeat_at timestamptz,
  add column health_status text;

alter table processor_registrations
  add constraint processor_registrations_health_status_check
  check (health_status is null or health_status in ('healthy', 'degraded', 'unhealthy'));

create index idx_processor_registrations_health
  on processor_registrations (tenant_id, project_id, health_status, last_heartbeat_at desc);
