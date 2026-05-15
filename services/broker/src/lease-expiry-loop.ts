import { setTimeout as delay } from 'node:timers/promises';

const defaultLeaseBatchLimit = 50;
const maxLeaseBatchLimit = 500;
const defaultPollIntervalMs = 1_000;
const defaultIdleBackoffMs = 5_000;
const defaultErrorBackoffMs = 10_000;
const maxSleepMs = 300_000;

export interface ExpireLeasesInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly limit: number;
}

export type ExpireLeases = (input: ExpireLeasesInput) => Promise<readonly unknown[]>;
export type BrokerLoopSleep = (durationMs: number, signal?: AbortSignal) => Promise<void>;

export interface BrokerServiceLoopOptions {
  readonly tenantId: string;
  readonly projectId: string;
  readonly expireLeases: ExpireLeases;
  readonly signal?: AbortSignal;
  readonly leaseBatchLimit?: number;
  readonly pollIntervalMs?: number;
  readonly idleBackoffMs?: number;
  readonly errorBackoffMs?: number;
  readonly sleep?: BrokerLoopSleep;
  readonly onError?: (error: unknown) => void;
}

export interface BrokerServiceLoopResult {
  readonly ticks: number;
  readonly expiredLeases: number;
  readonly errors: number;
  readonly stopped: 'aborted';
}

interface NormalizedBrokerServiceLoopOptions {
  readonly tenantId: string;
  readonly projectId: string;
  readonly expireLeases: ExpireLeases;
  readonly signal: AbortSignal | undefined;
  readonly leaseBatchLimit: number;
  readonly pollIntervalMs: number;
  readonly idleBackoffMs: number;
  readonly errorBackoffMs: number;
  readonly sleep: BrokerLoopSleep;
  readonly onError: ((error: unknown) => void) | undefined;
}

export async function runBrokerServiceLoop(
  options: BrokerServiceLoopOptions,
): Promise<BrokerServiceLoopResult> {
  const normalized = normalizeBrokerServiceLoopOptions(options);
  const stats = {
    ticks: 0,
    expiredLeases: 0,
    errors: 0,
  };

  while (!normalized.signal?.aborted) {
    try {
      const expiredCount = await runBrokerServiceLoopTick(normalized);
      stats.ticks += 1;
      stats.expiredLeases += expiredCount;
      await normalized.sleep(
        expiredCount > 0 ? normalized.pollIntervalMs : normalized.idleBackoffMs,
        normalized.signal,
      );
    } catch (error) {
      if (isShutdownRequested(normalized.signal)) {
        break;
      }

      stats.ticks += 1;
      stats.errors += 1;
      normalized.onError?.(error);

      try {
        await normalized.sleep(normalized.errorBackoffMs, normalized.signal);
      } catch (sleepError) {
        if (!isShutdownRequested(normalized.signal)) {
          throw sleepError;
        }
      }
    }
  }

  return { ...stats, stopped: 'aborted' };
}

async function runBrokerServiceLoopTick(
  options: Pick<
    NormalizedBrokerServiceLoopOptions,
    'tenantId' | 'projectId' | 'leaseBatchLimit' | 'expireLeases'
  >,
): Promise<number> {
  const expiredLeases = await options.expireLeases({
    tenantId: options.tenantId,
    projectId: options.projectId,
    limit: options.leaseBatchLimit,
  });

  return expiredLeases.length;
}

async function defaultSleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  await delay(durationMs, undefined, { signal });
}

function normalizeBrokerServiceLoopOptions(
  options: BrokerServiceLoopOptions,
): NormalizedBrokerServiceLoopOptions {
  return {
    tenantId: assertNonBlank(options.tenantId, 'tenantId'),
    projectId: assertNonBlank(options.projectId, 'projectId'),
    expireLeases: options.expireLeases,
    signal: options.signal,
    leaseBatchLimit: normalizePositiveInteger(
      options.leaseBatchLimit,
      defaultLeaseBatchLimit,
      maxLeaseBatchLimit,
    ),
    pollIntervalMs: normalizePositiveInteger(
      options.pollIntervalMs,
      defaultPollIntervalMs,
      maxSleepMs,
    ),
    idleBackoffMs: normalizePositiveInteger(
      options.idleBackoffMs,
      defaultIdleBackoffMs,
      maxSleepMs,
    ),
    errorBackoffMs: normalizePositiveInteger(
      options.errorBackoffMs,
      defaultErrorBackoffMs,
      maxSleepMs,
    ),
    sleep: options.sleep ?? defaultSleep,
    onError: options.onError,
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.min(Math.floor(value), max);
}

function assertNonBlank(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function isShutdownRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
