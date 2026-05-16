CREATE TABLE workflow_checkpoints (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  payload_ref text NOT NULL,
  state_digest text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  retained_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, run_id, sequence),
  FOREIGN KEY (tenant_id, project_id, run_id, step_id)
    REFERENCES workflow_steps(tenant_id, project_id, run_id, step_id)
    ON DELETE CASCADE
);

CREATE INDEX workflow_checkpoints_scope_run_idx
  ON workflow_checkpoints (tenant_id, project_id, run_id, sequence);

CREATE INDEX workflow_checkpoints_retention_idx
  ON workflow_checkpoints (tenant_id, project_id, retained_until)
  WHERE retained_until IS NOT NULL;
