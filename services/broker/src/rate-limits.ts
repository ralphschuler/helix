import type { TenantProjectScope } from '@helix/contracts';

export type RateLimitBucketType = 'tenant' | 'project' | 'processor' | 'external-service' | 'capability';
export type RateLimitAlgorithm = 'fixed-window' | 'sliding-window';

export interface RateLimitPolicyConfig {
  readonly algorithm: RateLimitAlgorithm;
  readonly limit: number;
  readonly intervalMs: number;
}

export interface RateLimitCheckInput extends TenantProjectScope {
  readonly bucketType: RateLimitBucketType;
  readonly bucketKey: string;
  readonly policy: RateLimitPolicyConfig;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly limit: number;
  readonly resetAt: number;
  readonly retryAfterMs: number;
}

export interface RateLimitBucketStore {
  check(input: RateLimitCheckInput): Promise<RateLimitDecision>;
}

export interface RateLimitBucketPolicy {
  check(input: RateLimitCheckInput): Promise<RateLimitDecision>;
}

export interface CreateRateLimitBucketPolicyOptions {
  readonly store: RateLimitBucketStore;
}

export interface InMemoryRateLimitBucketStoreOptions {
  readonly now?: () => number;
}

export function createRateLimitBucketPolicy(options: CreateRateLimitBucketPolicyOptions): RateLimitBucketPolicy {
  return new DefaultRateLimitBucketPolicy(options.store);
}

export class InMemoryRateLimitBucketStore implements RateLimitBucketStore {
  private readonly now: () => number;
  private readonly fixedWindows = new Map<string, FixedWindowState>();
  private readonly slidingWindows = new Map<string, number[]>();

  constructor(options: InMemoryRateLimitBucketStoreOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async check(input: RateLimitCheckInput): Promise<RateLimitDecision> {
    validateRateLimitInput(input);

    if (input.policy.algorithm === 'fixed-window') {
      return this.checkFixedWindow(input);
    }

    return this.checkSlidingWindow(input);
  }

  private checkFixedWindow(input: RateLimitCheckInput): RateLimitDecision {
    const now = this.now();
    const key = toScopedBucketKey(input);
    let state = this.fixedWindows.get(key);

    if (state === undefined || now >= state.resetAt) {
      state = { count: 0, resetAt: now + input.policy.intervalMs };
    }

    if (state.count >= input.policy.limit) {
      this.fixedWindows.set(key, state);
      return reject(input.policy.limit, state.resetAt, now);
    }

    state = { ...state, count: state.count + 1 };
    this.fixedWindows.set(key, state);
    return allow(input.policy.limit, input.policy.limit - state.count, state.resetAt);
  }

  private checkSlidingWindow(input: RateLimitCheckInput): RateLimitDecision {
    const now = this.now();
    const key = toScopedBucketKey(input);
    const windowStart = now - input.policy.intervalMs;
    const claims = (this.slidingWindows.get(key) ?? []).filter((claimedAt) => claimedAt > windowStart);

    const oldestClaim = claims[0];

    if (oldestClaim !== undefined && claims.length >= input.policy.limit) {
      this.slidingWindows.set(key, claims);
      return reject(input.policy.limit, oldestClaim + input.policy.intervalMs, now);
    }

    claims.push(now);
    this.slidingWindows.set(key, claims);
    return allow(input.policy.limit, input.policy.limit - claims.length, (oldestClaim ?? now) + input.policy.intervalMs);
  }
}

class DefaultRateLimitBucketPolicy implements RateLimitBucketPolicy {
  constructor(private readonly store: RateLimitBucketStore) {}

  async check(input: RateLimitCheckInput): Promise<RateLimitDecision> {
    validateRateLimitInput(input);
    return this.store.check(input);
  }
}

interface FixedWindowState {
  readonly count: number;
  readonly resetAt: number;
}

function allow(limit: number, remaining: number, resetAt: number): RateLimitDecision {
  return { allowed: true, remaining, limit, resetAt, retryAfterMs: 0 };
}

function reject(limit: number, resetAt: number, now: number): RateLimitDecision {
  return { allowed: false, remaining: 0, limit, resetAt, retryAfterMs: Math.max(0, resetAt - now) };
}

function validateRateLimitInput(input: RateLimitCheckInput): void {
  if (input.bucketKey.trim().length === 0) {
    throw new Error('Rate limit bucket key is required.');
  }

  if (!Number.isInteger(input.policy.limit) || input.policy.limit < 1) {
    throw new Error('Rate limit bucket limit must be a positive integer.');
  }

  if (!Number.isInteger(input.policy.intervalMs) || input.policy.intervalMs < 1) {
    throw new Error('Rate limit bucket interval must be a positive integer.');
  }
}

function toScopedBucketKey(input: RateLimitCheckInput): string {
  return `${input.tenantId}:${input.projectId}:${input.bucketType}:${input.bucketKey}:${input.policy.algorithm}:${input.policy.intervalMs}`;
}
