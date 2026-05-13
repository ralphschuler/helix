import type { AttemptState, JobState, LeaseState } from '@helix/contracts';

export interface StateTransition<State extends string> {
  readonly from: State;
  readonly to: State;
}

type BrokerStateResource = 'job' | 'attempt' | 'lease';

export class IllegalStateTransitionError extends Error {
  constructor(
    readonly resource: BrokerStateResource,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${resource} state transition: ${from} -> ${to}`);
    this.name = 'IllegalStateTransitionError';
  }
}

const terminalJobStates: ReadonlySet<JobState> = new Set([
  'completed',
  'failed',
  'dead_lettered',
  'canceled',
]);
const terminalAttemptStates: ReadonlySet<AttemptState> = new Set([
  'completed',
  'failed',
  'expired',
  'canceled',
]);
const terminalLeaseStates: ReadonlySet<LeaseState> = new Set(['released', 'expired', 'canceled']);

const legalJobTransitions: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'canceled'],
  running: ['completed', 'retrying', 'failed', 'dead_lettered', 'canceled'],
  retrying: ['queued', 'dead_lettered', 'canceled'],
  completed: [],
  failed: [],
  dead_lettered: [],
  canceled: [],
};

const legalAttemptTransitions: Record<AttemptState, readonly AttemptState[]> = {
  running: ['completed', 'failed', 'expired', 'canceled'],
  completed: [],
  failed: [],
  expired: [],
  canceled: [],
};

const legalLeaseTransitions: Record<LeaseState, readonly LeaseState[]> = {
  active: ['released', 'expired', 'canceled'],
  released: [],
  expired: [],
  canceled: [],
};

function isLegalTransition<State extends string>(
  legalTransitions: Record<State, readonly State[]>,
  transition: StateTransition<State>,
): boolean {
  return legalTransitions[transition.from].includes(transition.to);
}

function isIdempotentTransition<State extends string>(
  terminalStates: ReadonlySet<State>,
  transition: StateTransition<State>,
): boolean {
  return transition.from === transition.to && terminalStates.has(transition.from);
}

function assertLegalTransition<State extends string>(
  resource: BrokerStateResource,
  legalTransitions: Record<State, readonly State[]>,
  transition: StateTransition<State>,
): void {
  if (!isLegalTransition(legalTransitions, transition)) {
    throw new IllegalStateTransitionError(resource, transition.from, transition.to);
  }
}

function assertLegalOrIdempotentTransition<State extends string>(
  resource: BrokerStateResource,
  legalTransitions: Record<State, readonly State[]>,
  terminalStates: ReadonlySet<State>,
  transition: StateTransition<State>,
): void {
  if (
    !isLegalTransition(legalTransitions, transition) &&
    !isIdempotentTransition(terminalStates, transition)
  ) {
    throw new IllegalStateTransitionError(resource, transition.from, transition.to);
  }
}

export function isLegalJobStateTransition(transition: StateTransition<JobState>): boolean {
  return isLegalTransition(legalJobTransitions, transition);
}

export function isLegalAttemptStateTransition(transition: StateTransition<AttemptState>): boolean {
  return isLegalTransition(legalAttemptTransitions, transition);
}

export function isLegalLeaseStateTransition(transition: StateTransition<LeaseState>): boolean {
  return isLegalTransition(legalLeaseTransitions, transition);
}

export function isIdempotentJobStateTransition(transition: StateTransition<JobState>): boolean {
  return isIdempotentTransition(terminalJobStates, transition);
}

export function isIdempotentAttemptStateTransition(
  transition: StateTransition<AttemptState>,
): boolean {
  return isIdempotentTransition(terminalAttemptStates, transition);
}

export function isIdempotentLeaseStateTransition(transition: StateTransition<LeaseState>): boolean {
  return isIdempotentTransition(terminalLeaseStates, transition);
}

export function assertLegalJobStateTransition(transition: StateTransition<JobState>): void {
  assertLegalTransition('job', legalJobTransitions, transition);
}

export function assertLegalAttemptStateTransition(transition: StateTransition<AttemptState>): void {
  assertLegalTransition('attempt', legalAttemptTransitions, transition);
}

export function assertLegalLeaseStateTransition(transition: StateTransition<LeaseState>): void {
  assertLegalTransition('lease', legalLeaseTransitions, transition);
}

export function assertLegalOrIdempotentJobStateTransition(
  transition: StateTransition<JobState>,
): void {
  assertLegalOrIdempotentTransition('job', legalJobTransitions, terminalJobStates, transition);
}

export function assertLegalOrIdempotentAttemptStateTransition(
  transition: StateTransition<AttemptState>,
): void {
  assertLegalOrIdempotentTransition(
    'attempt',
    legalAttemptTransitions,
    terminalAttemptStates,
    transition,
  );
}

export function assertLegalOrIdempotentLeaseStateTransition(
  transition: StateTransition<LeaseState>,
): void {
  assertLegalOrIdempotentTransition('lease', legalLeaseTransitions, terminalLeaseStates, transition);
}
