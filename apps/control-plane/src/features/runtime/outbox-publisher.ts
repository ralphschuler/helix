import { sql, type Kysely } from 'kysely';

import type { HelixDatabase, JsonObject, RuntimeOutboxStatus } from '../../db/schema.js';
import type { RuntimeEventRecord, RuntimeOutboxRecord } from './transactional-outbox.js';

export interface RuntimeOutboxPublishRecord {
  readonly event: RuntimeEventRecord;
  readonly outbox: RuntimeOutboxRecord;
}

export interface RuntimeOutboxPublishMessage {
  readonly topic: string;
  readonly partitionKey: string;
  readonly event: RuntimeEventRecord;
}

export interface RuntimeEventProducer {
  publish(message: RuntimeOutboxPublishMessage): Promise<void>;
}

export interface RuntimeOutboxPublisherStore {
  listDue(input: { readonly now: Date; readonly limit: number }): Promise<RuntimeOutboxPublishRecord[]>;
  markPublished(input: {
    readonly outboxId: string;
    readonly eventId: string;
    readonly publishedAt: Date;
  }): Promise<void>;
  markPublishFailed(input: {
    readonly outboxId: string;
    readonly eventId: string;
    readonly attemptedAt: Date;
    readonly nextAttemptAt: Date;
    readonly errorMessage: string;
  }): Promise<void>;
}

export interface RuntimeOutboxPublisherOptions {
  readonly store: RuntimeOutboxPublisherStore;
  readonly producer: RuntimeEventProducer;
  readonly now?: () => Date;
  readonly batchSize?: number;
  readonly retryDelayMs?: number;
}

export interface RuntimeOutboxPublishResult {
  readonly attempted: number;
  readonly published: number;
  readonly failed: number;
}

export class RuntimeOutboxPublisher {
  private readonly store: RuntimeOutboxPublisherStore;
  private readonly producer: RuntimeEventProducer;
  private readonly now: () => Date;
  private readonly batchSize: number;
  private readonly retryDelayMs: number;

  constructor(options: RuntimeOutboxPublisherOptions) {
    this.store = options.store;
    this.producer = options.producer;
    this.now = options.now ?? (() => new Date());
    this.batchSize = options.batchSize ?? 100;
    this.retryDelayMs = options.retryDelayMs ?? 5_000;

    if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) {
      throw new Error('batchSize must be a positive integer.');
    }

    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs <= 0) {
      throw new Error('retryDelayMs must be a positive integer.');
    }
  }

  async publishDue(): Promise<RuntimeOutboxPublishResult> {
    const dueRecords = await this.store.listDue({ now: this.now(), limit: this.batchSize });
    let published = 0;
    let failed = 0;

    for (const record of dueRecords) {
      try {
        await this.producer.publish({
          topic: record.outbox.topic,
          partitionKey: record.outbox.partitionKey,
          event: record.event,
        });
      } catch (error) {
        const attemptedAt = this.now();
        await this.store.markPublishFailed({
          outboxId: record.outbox.id,
          eventId: record.event.id,
          attemptedAt,
          nextAttemptAt: new Date(attemptedAt.getTime() + this.retryDelayMs),
          errorMessage: publishErrorMessage(error),
        });
        failed += 1;
        continue;
      }

      await this.store.markPublished({
        outboxId: record.outbox.id,
        eventId: record.event.id,
        publishedAt: this.now(),
      });
      published += 1;
    }

    return {
      attempted: dueRecords.length,
      failed,
      published,
    };
  }
}

export class KyselyRuntimeOutboxPublisherStore implements RuntimeOutboxPublisherStore {
  private readonly db: Kysely<HelixDatabase>;

  constructor(db: Kysely<HelixDatabase>) {
    this.db = db;
  }

  async listDue(input: { readonly now: Date; readonly limit: number }): Promise<RuntimeOutboxPublishRecord[]> {
    const rows = await this.db
      .selectFrom('runtime_outbox')
      .innerJoin('runtime_events', (join) =>
        join
          .onRef('runtime_events.id', '=', 'runtime_outbox.event_id')
          .onRef('runtime_events.tenant_id', '=', 'runtime_outbox.tenant_id')
          .onRef('runtime_events.project_id', '=', 'runtime_outbox.project_id'),
      )
      .select([
        'runtime_outbox.id as outbox_id',
        'runtime_outbox.tenant_id as outbox_tenant_id',
        'runtime_outbox.project_id as outbox_project_id',
        'runtime_outbox.event_id as outbox_event_id',
        'runtime_outbox.topic as outbox_topic',
        'runtime_outbox.partition_key as outbox_partition_key',
        'runtime_outbox.status as outbox_status',
        'runtime_outbox.publish_attempts as outbox_publish_attempts',
        'runtime_outbox.next_attempt_at as outbox_next_attempt_at',
        'runtime_outbox.published_at as outbox_published_at',
        'runtime_outbox.last_error as outbox_last_error',
        'runtime_outbox.created_at as outbox_created_at',
        'runtime_outbox.updated_at as outbox_updated_at',
        'runtime_events.id as event_id',
        'runtime_events.tenant_id as event_tenant_id',
        'runtime_events.project_id as event_project_id',
        'runtime_events.event_type as event_type',
        'runtime_events.event_version as event_version',
        'runtime_events.ordering_key as event_ordering_key',
        'runtime_events.payload_json as event_payload_json',
        'runtime_events.occurred_at as event_occurred_at',
        'runtime_events.recorded_at as event_recorded_at',
      ])
      .where('runtime_outbox.published_at', 'is', null)
      .where('runtime_outbox.status', '!=', 'published')
      .where('runtime_outbox.next_attempt_at', '<=', input.now)
      .orderBy('runtime_outbox.next_attempt_at', 'asc')
      .orderBy('runtime_outbox.created_at', 'asc')
      .limit(input.limit)
      .execute();

    return rows.map(toRuntimeOutboxPublishRecord);
  }

  async markPublished(input: {
    readonly outboxId: string;
    readonly eventId: string;
    readonly publishedAt: Date;
  }): Promise<void> {
    await this.db
      .updateTable('runtime_outbox')
      .set({
        status: 'published',
        published_at: input.publishedAt,
        last_error: null,
        updated_at: input.publishedAt,
      })
      .where('id', '=', input.outboxId)
      .where('event_id', '=', input.eventId)
      .where('published_at', 'is', null)
      .execute();
  }

  async markPublishFailed(input: {
    readonly outboxId: string;
    readonly eventId: string;
    readonly attemptedAt: Date;
    readonly nextAttemptAt: Date;
    readonly errorMessage: string;
  }): Promise<void> {
    await this.db
      .updateTable('runtime_outbox')
      .set({
        status: 'pending',
        publish_attempts: sql<number>`publish_attempts + 1`,
        next_attempt_at: input.nextAttemptAt,
        last_error: input.errorMessage,
        updated_at: input.attemptedAt,
      })
      .where('id', '=', input.outboxId)
      .where('event_id', '=', input.eventId)
      .where('published_at', 'is', null)
      .execute();
  }
}

function publishErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Unknown publish error';
}

function toRuntimeOutboxPublishRecord(row: {
  readonly outbox_id: string;
  readonly outbox_tenant_id: string;
  readonly outbox_project_id: string;
  readonly outbox_event_id: string;
  readonly outbox_topic: string;
  readonly outbox_partition_key: string;
  readonly outbox_status: RuntimeOutboxStatus;
  readonly outbox_publish_attempts: number;
  readonly outbox_next_attempt_at: Date;
  readonly outbox_published_at: Date | null;
  readonly outbox_last_error: string | null;
  readonly outbox_created_at: Date;
  readonly outbox_updated_at: Date;
  readonly event_id: string;
  readonly event_tenant_id: string;
  readonly event_project_id: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly event_ordering_key: string;
  readonly event_payload_json: JsonObject;
  readonly event_occurred_at: Date;
  readonly event_recorded_at: Date;
}): RuntimeOutboxPublishRecord {
  return {
    event: {
      id: row.event_id,
      tenantId: row.event_tenant_id,
      projectId: row.event_project_id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      orderingKey: row.event_ordering_key,
      payload: row.event_payload_json,
      occurredAt: row.event_occurred_at,
      recordedAt: row.event_recorded_at,
    },
    outbox: {
      id: row.outbox_id,
      tenantId: row.outbox_tenant_id,
      projectId: row.outbox_project_id,
      eventId: row.outbox_event_id,
      topic: row.outbox_topic,
      partitionKey: row.outbox_partition_key,
      status: row.outbox_status,
      publishAttempts: row.outbox_publish_attempts,
      nextAttemptAt: row.outbox_next_attempt_at,
      publishedAt: row.outbox_published_at,
      lastError: row.outbox_last_error,
      createdAt: row.outbox_created_at,
      updatedAt: row.outbox_updated_at,
    },
  };
}
