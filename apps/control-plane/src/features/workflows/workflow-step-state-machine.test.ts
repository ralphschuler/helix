import { describe, expect, it } from 'vitest';

import { transitionWorkflowStepState } from './workflow-step-state-machine.js';

describe('workflow step state machine', () => {
  it('rejects invalid workflow step transitions', () => {
    expect(() => transitionWorkflowStepState('pending', 'completed')).toThrow(/Invalid workflow step transition/);
    expect(() => transitionWorkflowStepState('waiting_for_signal', 'running')).toThrow(/Invalid workflow step transition/);
    expect(() => transitionWorkflowStepState('completed', 'running')).toThrow(/Invalid workflow step transition/);
  });

  it('allows ready, terminal, and idempotent terminal workflow step transitions', () => {
    expect(transitionWorkflowStepState('pending', 'running')).toBe('running');
    expect(transitionWorkflowStepState('pending', 'waiting_for_signal')).toBe('waiting_for_signal');
    expect(transitionWorkflowStepState('waiting_for_signal', 'completed')).toBe('completed');
    expect(transitionWorkflowStepState('waiting_for_signal', 'waiting_for_signal')).toBe('waiting_for_signal');
    expect(transitionWorkflowStepState('running', 'completed')).toBe('completed');
    expect(transitionWorkflowStepState('completed', 'completed')).toBe('completed');
    expect(transitionWorkflowStepState('running', 'failed')).toBe('failed');
    expect(transitionWorkflowStepState('pending', 'canceled')).toBe('canceled');
  });
});
