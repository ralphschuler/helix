import { describe, expect, it } from 'vitest';

import {
  RuntimeInboxConsumer,
  type ClaimRuntimeInboxInput,
  type CompleteRuntimeInboxInput,
  type FailRuntimeInboxInput,
  type RuntimeInboxClaimResult,
  type RuntimeInboxRecord,
  type RuntimeInboxStore,
} from './features/runtime/consumer-inbox.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const otherProjectId = '01890f42-98c4-7cc3-aa5e-0c567f1d3a79';
const eventId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d01';
const otherEventId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d02';
const baseTime = new Date('2026-05-12T19:00:00.000Z');

class RecordingRuntimeInboxStore implements RuntimeInboxStore {
  readonly records = new Map<string, RuntimeInboxRecord>();

  constructor(private readonly generateId: () => string) {}

  async claim(input: ClaimRuntimeInboxInput): Promise<RuntimeInboxClaimResult> {
    const key = inboxKey(input.consumerName, input.eventId);
    const existing = this.records.get(key);

    if (existing === undefined) {
      const record: RuntimeInboxRecord = {
        id: this.generateId(),
        consumerName: input.consumerName,
        eventId: input.eventId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        status: 'processing',
        processingStartedAt: input.claimedAt,
        processedAt: null,
        attemptCount: 1,
        lastError: null,
        updatedAt: input.claimedAt,
      };
      this.records.set(key, record);

      return { claimed: true, duplicate: false, inbox: record };
    }

    if (existing.tenantId !== input.tenantId || existing.projectId !== input.projectId) {
      throw new Error('runtime inbox scope mismatch for duplicate event id');
    }

    if (existing.status === 'failed') {
      const retryRecord: RuntimeInboxRecord = {
        ...existing,
        status: 'processing',
        processingStartedAt: input.claimedAt,
        processedAt: null,
        attemptCount: existing.attemptCount + 1,
        lastError: null,
        updatedAt: input.claimedAt,
      };
      this.records.set(key, retryRecord);

      return { claimed: true, duplicate: false, inbox: retryRecord };
    }

    return {
      claimed: false,
      duplicate: true,
      inbox: existing,
      reason: existing.status === 'processed' ? 'already_processed' : 'already_processing',
    };
  }

  async complete(input: CompleteRuntimeInboxInput): Promise<RuntimeInboxRecord | null> {
    const key = inboxKey(input.consumerName, input.eventId);
    const existing = this.records.get(key);

    if (
      existing === undefined ||
      existing.tenantId !== input.tenantId ||
      existing.projectId !== input.projectId ||
      existing.status !== 'processing'
    ) {
      return null;
    }

    const completed: RuntimeInboxRecord = {
      ...existing,
      status: 'processed',
      processedAt: input.processedAt,
      lastError: null,
      updatedAt: input.processedAt,
    };
    this.records.set(key, completed);

    return completed;
  }

  async fail(input: FailRuntimeInboxInput): Promise<RuntimeInboxRecord | null> {
    const key = inboxKey(input.consumerName, input.eventId);
    const existing = this.records.get(key);

    if (
      existing === undefined ||
      existing.tenantId !== input.tenantId ||
      existing.projectId !== input.projectId ||
      existing.status !== 'processing'
    ) {
      return null;
    }

    const failed: RuntimeInboxRecord = {
      ...existing,
      status: 'failed',
      processedAt: null,
      lastError: input.errorMessage,
      updatedAt: input.failedAt,
    };
    this.records.set(key, failed);

    return failed;
  }
}

function inboxKey(consumerName: string, consumedEventId: string): string {
  return `${consumerName}:${consumedEventId}`;
}

function sequence(values: readonly string[]): () => string {
  let index = 0;

  return () => {
    const value = values[index];
    index += 1;

    if (value === undefined) {
      throw new Error('Sequence exhausted');
    }

    return value;
  };
}

describe('runtime consumer inbox', () => {
  it('processes a duplicate event at most once per consumer while preserving tenant/project scope', async () => {
    const store = new RecordingRuntimeInboxStore(
      sequence([
        '01890f42-98c4-7cc3-ba5e-0c567f1d3d10',
        '01890f42-98c4-7cc3-ba5e-0c567f1d3d11',
        '01890f42-98c4-7cc3-ba5e-0c567f1d3d12',
      ]),
    );
    const consumer = new RuntimeInboxConsumer({ now: () => baseTime, store });
    const processed: string[] = [];

    await expect(
      consumer.consume({ tenantId, projectId, consumerName: 'broker-projection', eventId }, async () => {
        processed.push('broker:first');
        return 'applied';
      }),
    ).resolves.toMatchObject({ duplicate: false, status: 'processed', value: 'applied' });
    await expect(
      consumer.consume({ tenantId, projectId, consumerName: 'broker-projection', eventId }, async () => {
        processed.push('broker:duplicate');
        return 'duplicate-applied';
      }),
    ).resolves.toMatchObject({ duplicate: true, reason: 'already_processed', status: 'duplicate' });
    await expect(
      consumer.consume({ tenantId, projectId, consumerName: 'audit-projection', eventId }, async () => {
        processed.push('audit:first');
        return 'audit-applied';
      }),
    ).resolves.toMatchObject({ duplicate: false, status: 'processed', value: 'audit-applied' });
    await expect(
      consumer.consume(
        { tenantId, projectId: otherProjectId, consumerName: 'broker-projection', eventId: otherEventId },
        async () => {
          processed.push('broker:other-project');
          return 'other-project-applied';
        },
      ),
    ).resolves.toMatchObject({ duplicate: false, status: 'processed', value: 'other-project-applied' });

    expect(processed).toEqual(['broker:first', 'audit:first', 'broker:other-project']);
    expect([...store.records.values()]).toMatchObject([
      {
        consumerName: 'broker-projection',
        eventId,
        tenantId,
        projectId,
        status: 'processed',
        attemptCount: 1,
      },
      {
        consumerName: 'audit-projection',
        eventId,
        tenantId,
        projectId,
        status: 'processed',
        attemptCount: 1,
      },
      {
        consumerName: 'broker-projection',
        eventId: otherEventId,
        tenantId,
        projectId: otherProjectId,
        status: 'processed',
        attemptCount: 1,
      },
    ]);
  });

  it('marks failed processing retryable and reclaims it on the next delivery', async () => {
    let currentTime = baseTime;
    const retryTime = new Date('2026-05-12T19:01:00.000Z');
    const store = new RecordingRuntimeInboxStore(
      sequence(['01890f42-98c4-7cc3-ba5e-0c567f1d3d20']),
    );
    const consumer = new RuntimeInboxConsumer({ now: () => currentTime, store });
    let attempt = 0;

    await expect(
      consumer.consume({ tenantId, projectId, consumerName: 'broker-projection', eventId }, async () => {
        attempt += 1;
        throw new Error('projection unavailable');
      }),
    ).rejects.toThrow(/projection unavailable/u);

    expect(store.records.get(inboxKey('broker-projection', eventId))).toMatchObject({
      tenantId,
      projectId,
      status: 'failed',
      attemptCount: 1,
      lastError: 'projection unavailable',
    });

    currentTime = retryTime;
    await expect(
      consumer.consume({ tenantId, projectId, consumerName: 'broker-projection', eventId }, async () => {
        attempt += 1;
        return 'applied-after-retry';
      }),
    ).resolves.toMatchObject({
      duplicate: false,
      status: 'processed',
      value: 'applied-after-retry',
    });

    expect(attempt).toBe(2);
    expect(store.records.get(inboxKey('broker-projection', eventId))).toMatchObject({
      status: 'processed',
      attemptCount: 2,
      processedAt: retryTime,
      lastError: null,
    });
  });
});
