import type { TenantProjectScope } from '@helix/contracts';

export interface ConcurrencyGroupReservationInput extends TenantProjectScope {
  readonly groupKey: string;
  readonly limit: number;
  readonly claimId: string;
}

export interface ConcurrencyGroupReleaseInput extends TenantProjectScope {
  readonly groupKey: string;
  readonly claimId: string;
}

export interface ConcurrencyGroupReservationResult {
  readonly reserved: boolean;
  readonly activeCount: number;
  readonly limit: number;
}

export interface ConcurrencyGroupReleaseResult {
  readonly released: boolean;
  readonly activeCount: number;
}

export interface ConcurrencyGroupCounterStore {
  reserve(input: ConcurrencyGroupReservationInput): Promise<ConcurrencyGroupReservationResult>;
  release(input: ConcurrencyGroupReleaseInput): Promise<ConcurrencyGroupReleaseResult>;
}

export interface ConcurrencyGroupPolicy {
  reserve(input: ConcurrencyGroupReservationInput): Promise<ConcurrencyGroupReservationResult>;
  release(input: ConcurrencyGroupReleaseInput): Promise<ConcurrencyGroupReleaseResult>;
}

export interface CreateConcurrencyGroupPolicyOptions {
  readonly store: ConcurrencyGroupCounterStore;
}

export function createConcurrencyGroupPolicy(options: CreateConcurrencyGroupPolicyOptions): ConcurrencyGroupPolicy {
  return new DefaultConcurrencyGroupPolicy(options.store);
}

export class InMemoryConcurrencyGroupCounterStore implements ConcurrencyGroupCounterStore {
  private readonly groups = new Map<string, Set<string>>();

  async reserve(input: ConcurrencyGroupReservationInput): Promise<ConcurrencyGroupReservationResult> {
    validateGroupInput(input);

    const key = toScopedGroupKey(input);
    const claims = this.groups.get(key) ?? new Set<string>();

    if (claims.has(input.claimId)) {
      return { reserved: true, activeCount: claims.size, limit: input.limit };
    }

    if (claims.size >= input.limit) {
      return { reserved: false, activeCount: claims.size, limit: input.limit };
    }

    claims.add(input.claimId);
    this.groups.set(key, claims);
    return { reserved: true, activeCount: claims.size, limit: input.limit };
  }

  async release(input: ConcurrencyGroupReleaseInput): Promise<ConcurrencyGroupReleaseResult> {
    validateReleaseInput(input);

    const key = toScopedGroupKey(input);
    const claims = this.groups.get(key);

    if (claims === undefined || !claims.delete(input.claimId)) {
      return { released: false, activeCount: claims?.size ?? 0 };
    }

    const activeCount = claims.size;

    if (activeCount === 0) {
      this.groups.delete(key);
    }

    return { released: true, activeCount };
  }
}

class DefaultConcurrencyGroupPolicy implements ConcurrencyGroupPolicy {
  constructor(private readonly store: ConcurrencyGroupCounterStore) {}

  async reserve(input: ConcurrencyGroupReservationInput): Promise<ConcurrencyGroupReservationResult> {
    validateGroupInput(input);
    return this.store.reserve(input);
  }

  async release(input: ConcurrencyGroupReleaseInput): Promise<ConcurrencyGroupReleaseResult> {
    validateReleaseInput(input);
    return this.store.release(input);
  }
}

function validateGroupInput(input: ConcurrencyGroupReservationInput): void {
  validateReleaseInput(input);

  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error('Concurrency group limit must be a positive integer.');
  }
}

function validateReleaseInput(input: ConcurrencyGroupReleaseInput): void {
  if (input.groupKey.trim().length === 0) {
    throw new Error('Concurrency group key is required.');
  }

  if (input.claimId.trim().length === 0) {
    throw new Error('Concurrency claim id is required.');
  }
}

function toScopedGroupKey(input: TenantProjectScope & { readonly groupKey: string }): string {
  return `${input.tenantId}:${input.projectId}:${input.groupKey}`;
}
