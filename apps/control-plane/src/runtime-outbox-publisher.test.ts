import { describe, expect, it } from 'vitest';

import {
  RuntimeOutboxPublisher,
  type RuntimeEventProducer,
  type RuntimeOutboxPublishMessage,
  type RuntimeOutboxPublisherStore,
} from './features/runtime/outbox-publisher.js';
import type { RuntimeEventRecord, RuntimeOutboxRecord } from './features/runtime/transactional-outbox.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const eventId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d01';
const outboxId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d02';
const baseTime = new Date('2026-05-12T18:30:00.000Z');

class RecordingOutboxPublisherStore implements RuntimeOutboxPublisherStore {
  constructor(readonly records: PublishedOutboxFixture[]) {}

  async listDue(input: { readonly now: Date; readonly limit: number }): Promise<PublishedOutboxFixture[]> {
    return this.records
      .filter(
        (record) =>
          record.outbox.publishedAt === null &&
          record.outbox.status !== 'published' &&
          record.outbox.nextAttemptAt.getTime() <= input.now.getTime(),
      )
      .slice(0, input.limit);
  }

  async markPublished(input: {
    readonly outboxId: string;
    readonly eventId: string;
    readonly publishedAt: Date;
  }): Promise<void> {
    const record = this.findUnpublishedRecord(input.outboxId, input.eventId);

    if (record === null) {
      return;
    }

    record.outbox = {
      ...record.outbox,
      status: 'published',
      publishedAt: input.publishedAt,
      lastError: null,
      updatedAt: input.publishedAt,
    };
  }

  async markPublishFailed(input: {
    readonly outboxId: string;
    readonly eventId: string;
    readonly attemptedAt: Date;
    readonly nextAttemptAt: Date;
    readonly errorMessage: string;
  }): Promise<void> {
    const record = this.findUnpublishedRecord(input.outboxId, input.eventId);

    if (record === null) {
      return;
    }

    record.outbox = {
      ...record.outbox,
      status: 'pending',
      publishAttempts: record.outbox.publishAttempts + 1,
      nextAttemptAt: input.nextAttemptAt,
      lastError: input.errorMessage,
      updatedAt: input.attemptedAt,
    };
  }

  private findUnpublishedRecord(outboxId: string, eventId: string): PublishedOutboxFixture | null {
    const record = this.records.find(
      (candidate) => candidate.outbox.id === outboxId && candidate.event.id === eventId,
    );

    return record === undefined || record.outbox.publishedAt !== null ? null : record;
  }
}

class RecordingEventProducer implements RuntimeEventProducer {
  readonly attempts: RuntimeOutboxPublishMessage[] = [];
  readonly failures: Error[] = [];

  async publish(message: RuntimeOutboxPublishMessage): Promise<void> {
    this.attempts.push(message);
    const failure = this.failures.shift();

    if (failure !== undefined) {
      throw failure;
    }
  }
}

interface PublishedOutboxFixture {
  readonly event: RuntimeEventRecord;
  outbox: RuntimeOutboxRecord;
}

function createOutboxFixture(overrides: Partial<RuntimeOutboxRecord> = {}): PublishedOutboxFixture {
  const event: RuntimeEventRecord = {
    id: eventId,
    tenantId,
    projectId,
    eventType: 'sample.state.changed',
    eventVersion: 1,
    orderingKey: `project:${projectId}`,
    payload: { sampleId: 'sample-state-1' },
    occurredAt: new Date('2026-05-12T18:29:59.000Z'),
    recordedAt: baseTime,
  };

  return {
    event,
    outbox: {
      id: outboxId,
      tenantId,
      projectId,
      eventId,
      topic: 'helix.runtime.events',
      partitionKey: `project:${projectId}`,
      status: 'pending',
      publishAttempts: 0,
      nextAttemptAt: baseTime,
      publishedAt: null,
      lastError: null,
      createdAt: baseTime,
      updatedAt: baseTime,
      ...overrides,
    },
  };
}

describe('runtime outbox publisher', () => {
  it('publishes one due outbox event and marks it published without republishing it', async () => {
    const record = createOutboxFixture();
    const store = new RecordingOutboxPublisherStore([record]);
    const producer = new RecordingEventProducer();
    const publisher = new RuntimeOutboxPublisher({
      now: () => baseTime,
      producer,
      store,
    });

    await expect(publisher.publishDue()).resolves.toEqual({
      attempted: 1,
      failed: 0,
      published: 1,
    });

    expect(producer.attempts).toMatchObject([
      {
        topic: 'helix.runtime.events',
        partitionKey: `project:${projectId}`,
        event: {
          id: eventId,
          tenantId,
          projectId,
          eventType: 'sample.state.changed',
          payload: { sampleId: 'sample-state-1' },
        },
      },
    ]);
    expect(record.outbox).toMatchObject({
      status: 'published',
      publishedAt: baseTime,
      lastError: null,
    });

    await expect(publisher.publishDue()).resolves.toEqual({
      attempted: 0,
      failed: 0,
      published: 0,
    });
    expect(producer.attempts).toHaveLength(1);
  });

  it('keeps an outage failure pending, schedules retry, then drains it after recovery', async () => {
    let currentTime = baseTime;
    const retryAt = new Date('2026-05-12T18:31:00.000Z');
    const record = createOutboxFixture();
    const store = new RecordingOutboxPublisherStore([record]);
    const producer = new RecordingEventProducer();
    producer.failures.push(new Error('redpanda offline'));
    const publisher = new RuntimeOutboxPublisher({
      now: () => currentTime,
      producer,
      retryDelayMs: 60_000,
      store,
    });

    await expect(publisher.publishDue()).resolves.toEqual({
      attempted: 1,
      failed: 1,
      published: 0,
    });

    expect(record.outbox).toMatchObject({
      status: 'pending',
      publishAttempts: 1,
      nextAttemptAt: retryAt,
      publishedAt: null,
      lastError: 'redpanda offline',
    });

    currentTime = new Date('2026-05-12T18:30:59.999Z');
    await expect(publisher.publishDue()).resolves.toEqual({
      attempted: 0,
      failed: 0,
      published: 0,
    });

    currentTime = retryAt;
    await expect(publisher.publishDue()).resolves.toEqual({
      attempted: 1,
      failed: 0,
      published: 1,
    });

    expect(producer.attempts).toHaveLength(2);
    expect(record.outbox).toMatchObject({
      status: 'published',
      publishAttempts: 1,
      publishedAt: retryAt,
      lastError: null,
    });
  });
});
