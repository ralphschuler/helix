create table if not exists processor_registrations (
  id uuid primary key,
  tenant_id uuid not null,
  project_id uuid not null,
  agent_id uuid not null,
  capabilities_json jsonb not null,
  hardware_json jsonb not null,
  region text not null,
  labels_json jsonb not null default '{}'::jsonb,
  tags_json jsonb not null default '[]'::jsonb,
  routing_explanation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processor_registrations_project_scope_fk foreign key (tenant_id, project_id) references projects(tenant_id, id) on delete restrict,
  constraint processor_registrations_agent_scope_fk foreign key (tenant_id, project_id, agent_id) references agents(tenant_id, project_id, id) on delete restrict,
  constraint processor_registrations_region_not_blank check (btrim(region) <> ''),
  constraint processor_registrations_capabilities_is_object check (jsonb_typeof(capabilities_json) = 'object'),
  constraint processor_registrations_capabilities_items_array check (jsonb_typeof(capabilities_json->'items') = 'array'),
  constraint processor_registrations_capabilities_items_non_empty check (jsonb_array_length(capabilities_json->'items') > 0),
  constraint processor_registrations_capabilities_items_shape check (not jsonb_path_exists(capabilities_json, '$.items[*] ? (!exists(@.name) || !exists(@.version) || @.name == "" || @.version == "")')),
  constraint processor_registrations_hardware_is_object check (jsonb_typeof(hardware_json) = 'object'),
  constraint processor_registrations_hardware_gpu_boolean check (jsonb_typeof(hardware_json->'gpu') = 'boolean'),
  constraint processor_registrations_hardware_memory_number check (jsonb_typeof(hardware_json->'memoryMb') = 'number'),
  constraint processor_registrations_labels_is_object check (jsonb_typeof(labels_json) = 'object'),
  constraint processor_registrations_tags_is_array check (jsonb_typeof(tags_json) = 'array'),
  constraint processor_registrations_routing_explanation_is_object check (jsonb_typeof(routing_explanation_json) = 'object'),
  constraint processor_registrations_scope_id_unique unique (tenant_id, project_id, id),
  constraint processor_registrations_agent_unique unique (tenant_id, project_id, agent_id)
);

create index if not exists processor_registrations_project_region_idx
  on processor_registrations (tenant_id, project_id, region, updated_at desc);

create index if not exists processor_registrations_capabilities_idx
  on processor_registrations using gin (capabilities_json jsonb_path_ops);

create index if not exists processor_registrations_labels_idx
  on processor_registrations using gin (labels_json jsonb_path_ops);
