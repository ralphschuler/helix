import type { WorkflowStepState } from '@helix/contracts';

const allowedTransitions = new Map<WorkflowStepState, ReadonlySet<WorkflowStepState>>([
  ['pending', new Set(['pending', 'running', 'canceled'])],
  ['running', new Set(['running', 'completed', 'failed', 'canceled'])],
  ['completed', new Set(['completed'])],
  ['failed', new Set(['failed'])],
  ['canceled', new Set(['canceled'])],
]);

export class InvalidWorkflowStepTransitionError extends Error {
  constructor(from: WorkflowStepState, to: WorkflowStepState) {
    super(`Invalid workflow step transition: ${from} -> ${to}`);
    this.name = 'InvalidWorkflowStepTransitionError';
  }
}

export function transitionWorkflowStepState(
  current: WorkflowStepState,
  next: WorkflowStepState,
): WorkflowStepState {
  if (!allowedTransitions.get(current)?.has(next)) {
    throw new InvalidWorkflowStepTransitionError(current, next);
  }

  return next;
}
