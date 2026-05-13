import type { Kysely, Transaction } from 'kysely';

import type { HelixDatabase, JsonObject, RuntimeOutboxStatus } from '../../db/schema.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';

export interface RuntimeEventInput {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly orderingKey: string;
  readonly payload?: JsonObject;
  readonly occurredAt?: Date;
}

export interface RuntimeEventRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly orderingKey: string;
  readonly payload: JsonObject;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
}

export interface RuntimeOutboxRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly eventId: string;
  readonly topic: string;
  readonly partitionKey: string;
  readonly status: RuntimeOutboxStatus;
  readonly publishAttempts: number;
  readonly nextAttemptAt: Date;
  readonly publishedAt: Date | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CommittedOutboxEvent {
  readonly event: RuntimeEventRecord;
  readonly outbox: RuntimeOutboxRecord;
}

export interface RuntimeOutboxTransaction<TStateTransaction = unknown> {
  readonly state: TStateTransaction;
  findCommittedOutboxEvent(input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly eventId: string;
  }): Promise<CommittedOutboxEvent | null>;
  insertRuntimeEvent(record: RuntimeEventRecord): Promise<void>;
  insertRuntimeOutbox(record: RuntimeOutboxRecord): Promise<void>;
}

export interface RuntimeOutboxStore<TStateTransaction = unknown> {
  transaction<T>(
    callback: (transaction: RuntimeOutboxTransaction<TStateTransaction>) => Promise<T>,
  ): Promise<T>;
}

export type TransactionalOutboxResult<TStateResult> =
  | {
      readonly duplicate: false;
      readonly state: TStateResult;
      readonly event: RuntimeEventRecord;
      readonly outbox: RuntimeOutboxRecord;
    }
  | {
      readonly duplicate: true;
      readonly state: null;
      readonly event: RuntimeEventRecord;
      readonly outbox: RuntimeOutboxRecord;
    };

export interface WriteWithStateChangeInput<TStateTransaction, TStateResult> {
  readonly event: RuntimeEventInput;
  readonly topic: string;
  readonly partitionKey?: string;
  readonly outboxId?: string;
  readonly writeState: (
    transaction: RuntimeOutboxTransaction<TStateTransaction>,
  ) => Promise<TStateResult>;
}

export interface TransactionalOutboxWriterOptions<TStateTransaction = unknown> {
  readonly store: RuntimeOutboxStore<TStateTransaction>;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class TransactionalOutboxWriter<TStateTransaction = unknown> {
  private readonly store: RuntimeOutboxStore<TStateTransaction>;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: TransactionalOutboxWriterOptions<TStateTransaction>) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
  }

  async writeWithStateChange<TStateResult>(
    input: WriteWithStateChangeInput<TStateTransaction, TStateResult>,
  ): Promise<TransactionalOutboxResult<TStateResult>> {
    const event = this.createEventRecord(input.event);
    assertNonBlank(input.topic, 'topic');

    return this.store.transaction(async (transaction) => {
      const existing = await transaction.findCommittedOutboxEvent({
        tenantId: event.tenantId,
        projectId: event.projectId,
        eventId: event.id,
      });

      if (existing !== null) {
        return {
          duplicate: true,
          state: null,
          event: existing.event,
          outbox: existing.outbox,
        };
      }

      const state = await input.writeState(transaction);
      const timestamp = this.now();
      const outbox: RuntimeOutboxRecord = {
        id: input.outboxId ?? this.generateId(),
        tenantId: event.tenantId,
        projectId: event.projectId,
        eventId: event.id,
        topic: input.topic,
        partitionKey: input.partitionKey ?? event.orderingKey,
        status: 'pending',
        publishAttempts: 0,
        nextAttemptAt: timestamp,
        publishedAt: null,
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await transaction.insertRuntimeEvent(event);
      await transaction.insertRuntimeOutbox(outbox);

      return {
        duplicate: false,
        state,
        event,
        outbox,
      };
    });
  }

  private createEventRecord(input: RuntimeEventInput): RuntimeEventRecord {
    assertNonBlank(input.id, 'event.id');
    assertNonBlank(input.tenantId, 'event.tenantId');
    assertNonBlank(input.projectId, 'event.projectId');
    assertNonBlank(input.eventType, 'event.eventType');
    assertNonBlank(input.orderingKey, 'event.orderingKey');

    if (!Number.isInteger(input.eventVersion) || input.eventVersion <= 0) {
      throw new Error('event.eventVersion must be a positive integer.');
    }

    const timestamp = this.now();

    return {
      id: input.id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      eventType: input.eventType,
      eventVersion: input.eventVersion,
      orderingKey: input.orderingKey,
      payload: input.payload ?? {},
      occurredAt: input.occurredAt ?? timestamp,
      recordedAt: timestamp,
    };
  }
}

export class KyselyRuntimeOutboxStore implements RuntimeOutboxStore<Transaction<HelixDatabase>> {
  private readonly db: Kysely<HelixDatabase>;

  constructor(db: Kysely<HelixDatabase>) {
    this.db = db;
  }

  async transaction<T>(
    callback: (transaction: RuntimeOutboxTransaction<Transaction<HelixDatabase>>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(async (transaction) =>
      callback(new KyselyRuntimeOutboxTransaction(transaction)),
    );
  }
}

class KyselyRuntimeOutboxTransaction
  implements RuntimeOutboxTransaction<Transaction<HelixDatabase>>
{
  readonly state: Transaction<HelixDatabase>;

  constructor(transaction: Transaction<HelixDatabase>) {
    this.state = transaction;
  }

  async findCommittedOutboxEvent(input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly eventId: string;
  }): Promise<CommittedOutboxEvent | null> {
    const eventRow = await this.state
      .selectFrom('runtime_events')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('id', '=', input.eventId)
      .executeTakeFirst();

    const outboxRow = await this.state
      .selectFrom('runtime_outbox')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('event_id', '=', input.eventId)
      .executeTakeFirst();

    if (eventRow === undefined || outboxRow === undefined) {
      return null;
    }

    return {
      event: {
        id: eventRow.id,
        tenantId: eventRow.tenant_id,
        projectId: eventRow.project_id,
        eventType: eventRow.event_type,
        eventVersion: eventRow.event_version,
        orderingKey: eventRow.ordering_key,
        payload: eventRow.payload_json,
        occurredAt: eventRow.occurred_at,
        recordedAt: eventRow.recorded_at,
      },
      outbox: {
        id: outboxRow.id,
        tenantId: outboxRow.tenant_id,
        projectId: outboxRow.project_id,
        eventId: outboxRow.event_id,
        topic: outboxRow.topic,
        partitionKey: outboxRow.partition_key,
        status: outboxRow.status,
        publishAttempts: outboxRow.publish_attempts,
        nextAttemptAt: outboxRow.next_attempt_at,
        publishedAt: outboxRow.published_at,
        lastError: outboxRow.last_error,
        createdAt: outboxRow.created_at,
        updatedAt: outboxRow.updated_at,
      },
    };
  }

  async insertRuntimeEvent(record: RuntimeEventRecord): Promise<void> {
    await this.state
      .insertInto('runtime_events')
      .values({
        id: record.id,
        tenant_id: record.tenantId,
        project_id: record.projectId,
        event_type: record.eventType,
        event_version: record.eventVersion,
        ordering_key: record.orderingKey,
        payload_json: record.payload,
        occurred_at: record.occurredAt,
        recorded_at: record.recordedAt,
      })
      .execute();
  }

  async insertRuntimeOutbox(record: RuntimeOutboxRecord): Promise<void> {
    await this.state
      .insertInto('runtime_outbox')
      .values({
        id: record.id,
        tenant_id: record.tenantId,
        project_id: record.projectId,
        event_id: record.eventId,
        topic: record.topic,
        partition_key: record.partitionKey,
        status: record.status,
        publish_attempts: record.publishAttempts,
        next_attempt_at: record.nextAttemptAt,
        published_at: record.publishedAt,
        last_error: record.lastError,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })
      .execute();
  }
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty.`);
  }
}
