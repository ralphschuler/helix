ALTER TABLE jobs
  ADD CONSTRAINT jobs_tenant_project_id_unique UNIQUE (tenant_id, project_id, id);

CREATE TABLE workflow_steps (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('job', 'wait_signal', 'approval', 'timer', 'pause', 'join', 'completion')),
  state text NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'canceled')),
  job_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (tenant_id, project_id, run_id, step_id),
  CONSTRAINT workflow_steps_workflow_scope_fk
    FOREIGN KEY (tenant_id, project_id, workflow_id)
    REFERENCES workflow_definitions(tenant_id, project_id, id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_steps_version_scope_fk
    FOREIGN KEY (tenant_id, project_id, workflow_version_id)
    REFERENCES workflow_versions(tenant_id, project_id, id),
  CONSTRAINT workflow_steps_run_scope_fk
    FOREIGN KEY (tenant_id, project_id, run_id)
    REFERENCES workflow_runs(tenant_id, project_id, id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_steps_version_matches_workflow_fk
    FOREIGN KEY (tenant_id, project_id, workflow_id, workflow_version_id)
    REFERENCES workflow_versions(tenant_id, project_id, workflow_id, id),
  CONSTRAINT workflow_steps_job_scope_fk
    FOREIGN KEY (tenant_id, project_id, job_id)
    REFERENCES jobs(tenant_id, project_id, id)
);

CREATE INDEX workflow_steps_run_state_idx
  ON workflow_steps (tenant_id, project_id, run_id, state, step_id);

CREATE TABLE workflow_step_dependencies (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  run_id uuid NOT NULL,
  from_step_id text NOT NULL,
  to_step_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, project_id, run_id, from_step_id, to_step_id),
  CONSTRAINT workflow_step_dependencies_run_scope_fk
    FOREIGN KEY (tenant_id, project_id, run_id)
    REFERENCES workflow_runs(tenant_id, project_id, id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_step_dependencies_from_step_fk
    FOREIGN KEY (tenant_id, project_id, run_id, from_step_id)
    REFERENCES workflow_steps(tenant_id, project_id, run_id, step_id)
    ON DELETE CASCADE,
  CONSTRAINT workflow_step_dependencies_to_step_fk
    FOREIGN KEY (tenant_id, project_id, run_id, to_step_id)
    REFERENCES workflow_steps(tenant_id, project_id, run_id, step_id)
    ON DELETE CASCADE
);
