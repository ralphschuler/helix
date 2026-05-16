alter table workflow_runs
  drop constraint if exists workflow_runs_state_check;

alter table workflow_runs
  add constraint workflow_runs_state_check check (state in ('queued', 'running', 'paused', 'completed', 'failed', 'canceled'));
