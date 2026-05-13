import { describe, expect, it } from 'vitest';

import {
  TransactionalOutboxWriter,
  type RuntimeEventRecord,
  type RuntimeOutboxRecord,
  type RuntimeOutboxStore,
  type RuntimeOutboxTransaction,
} from './features/runtime/transactional-outbox.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const eventId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d01';
const outboxId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d02';

interface SampleStateRow {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly eventId: string;
}

interface SampleStateTransaction {
  insertSampleState(row: SampleStateRow): Promise<void>;
}

class RecordingRuntimeOutboxStore implements RuntimeOutboxStore<SampleStateTransaction> {
  readonly sampleStateRows: SampleStateRow[] = [];
  readonly runtimeEvents: RuntimeEventRecord[] = [];
  readonly runtimeOutbox: RuntimeOutboxRecord[] = [];
  failNextOutboxInsert = false;

  async transaction<T>(
    callback: (transaction: RuntimeOutboxTransaction<SampleStateTransaction>) => Promise<T>,
  ): Promise<T> {
    const consumeOutboxFailure = (): void => {
      if (this.failNextOutboxInsert) {
        this.failNextOutboxInsert = false;
        throw new Error('simulated outbox insert failure');
      }
    };
    const draftState = [...this.sampleStateRows];
    const draftEvents = [...this.runtimeEvents];
    const draftOutbox = [...this.runtimeOutbox];
    const transaction: RuntimeOutboxTransaction<SampleStateTransaction> = {
      state: {
        async insertSampleState(row) {
          draftState.push(row);
        },
      },
      async findCommittedOutboxEvent(input) {
        const event = draftEvents.find(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            candidate.projectId === input.projectId &&
            candidate.id === input.eventId,
        );
        const outbox = draftOutbox.find(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            candidate.projectId === input.projectId &&
            candidate.eventId === input.eventId,
        );

        return event === undefined || outbox === undefined ? null : { event, outbox };
      },
      async insertRuntimeEvent(record) {
        draftEvents.push(record);
      },
      async insertRuntimeOutbox(record) {
        consumeOutboxFailure();
        draftOutbox.push(record);
      },
    };

    const result = await callback(transaction);
    this.sampleStateRows.splice(0, this.sampleStateRows.length, ...draftState);
    this.runtimeEvents.splice(0, this.runtimeEvents.length, ...draftEvents);
    this.runtimeOutbox.splice(0, this.runtimeOutbox.length, ...draftOutbox);

    return result;
  }
}

function createWriter(store: RecordingRuntimeOutboxStore): TransactionalOutboxWriter<SampleStateTransaction> {
  return new TransactionalOutboxWriter({
    generateId: () => outboxId,
    now: () => new Date('2026-05-12T18:30:00.000Z'),
    store,
  });
}

function runtimeEventInput() {
  return {
    id: eventId,
    tenantId,
    projectId,
    eventType: 'sample.state.changed',
    eventVersion: 1,
    orderingKey: `project:${projectId}`,
    payload: { sampleId: 'sample-state-1' },
    occurredAt: new Date('2026-05-12T18:29:59.000Z'),
  };
}

describe('transactional runtime outbox writer', () => {
  it('commits durable state and its scoped outbox event in one transaction', async () => {
    const store = new RecordingRuntimeOutboxStore();
    const writer = createWriter(store);

    const result = await writer.writeWithStateChange({
      event: runtimeEventInput(),
      topic: 'helix.runtime.events',
      writeState: async (transaction) => {
        await transaction.state.insertSampleState({
          id: 'sample-state-1',
          tenantId,
          projectId,
          eventId,
        });

        return { sampleStateId: 'sample-state-1' };
      },
    });

    expect(result).toMatchObject({
      duplicate: false,
      state: { sampleStateId: 'sample-state-1' },
    });
    expect(store.sampleStateRows).toEqual([
      { id: 'sample-state-1', tenantId, projectId, eventId },
    ]);
    expect(store.runtimeEvents).toMatchObject([
      {
        id: eventId,
        tenantId,
        projectId,
        eventType: 'sample.state.changed',
        eventVersion: 1,
        orderingKey: `project:${projectId}`,
        payload: { sampleId: 'sample-state-1' },
      },
    ]);
    expect(store.runtimeOutbox).toMatchObject([
      {
        id: outboxId,
        tenantId,
        projectId,
        eventId,
        topic: 'helix.runtime.events',
        partitionKey: `project:${projectId}`,
        status: 'pending',
        publishAttempts: 0,
      },
    ]);
  });

  it('rolls back durable state and event rows when the outbox write fails', async () => {
    const store = new RecordingRuntimeOutboxStore();
    store.failNextOutboxInsert = true;
    const writer = createWriter(store);

    await expect(
      writer.writeWithStateChange({
        event: runtimeEventInput(),
        topic: 'helix.runtime.events',
        writeState: async (transaction) => {
          await transaction.state.insertSampleState({
            id: 'sample-state-rollback',
            tenantId,
            projectId,
            eventId,
          });

          return { sampleStateId: 'sample-state-rollback' };
        },
      }),
    ).rejects.toThrow(/simulated outbox insert failure/u);

    expect(store.sampleStateRows).toEqual([]);
    expect(store.runtimeEvents).toEqual([]);
    expect(store.runtimeOutbox).toEqual([]);
  });

  it('treats the stable event id as a duplicate guard and skips duplicate state mutation', async () => {
    const store = new RecordingRuntimeOutboxStore();
    const writer = createWriter(store);
    let stateWriteCount = 0;

    await writer.writeWithStateChange({
      event: runtimeEventInput(),
      topic: 'helix.runtime.events',
      writeState: async (transaction) => {
        stateWriteCount += 1;
        await transaction.state.insertSampleState({
          id: `sample-state-${stateWriteCount}`,
          tenantId,
          projectId,
          eventId,
        });

        return { sampleStateId: `sample-state-${stateWriteCount}` };
      },
    });

    const duplicate = await writer.writeWithStateChange({
      event: runtimeEventInput(),
      topic: 'helix.runtime.events',
      writeState: async (transaction) => {
        stateWriteCount += 1;
        await transaction.state.insertSampleState({
          id: `sample-state-${stateWriteCount}`,
          tenantId,
          projectId,
          eventId,
        });

        return { sampleStateId: `sample-state-${stateWriteCount}` };
      },
    });

    expect(duplicate).toMatchObject({ duplicate: true, state: null });
    expect(stateWriteCount).toBe(1);
    expect(store.sampleStateRows).toHaveLength(1);
    expect(store.runtimeEvents).toHaveLength(1);
    expect(store.runtimeOutbox).toHaveLength(1);
  });
});
