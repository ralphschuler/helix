ALTER TABLE workflow_steps
  DROP CONSTRAINT IF EXISTS workflow_steps_state_check;

ALTER TABLE workflow_steps
  ADD CONSTRAINT workflow_steps_state_check
  CHECK (state IN ('pending', 'running', 'waiting_for_signal', 'waiting_for_timer', 'completed', 'failed', 'canceled'));
