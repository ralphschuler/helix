import { sql, type Kysely, type Transaction } from 'kysely';

import type { HelixDatabase, RuntimeInboxStatus } from '../../db/schema.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';

export interface RuntimeInboxEventScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly eventId: string;
}

export interface RuntimeInboxRecord extends RuntimeInboxEventScope {
  readonly id: string;
  readonly consumerName: string;
  readonly status: RuntimeInboxStatus;
  readonly processingStartedAt: Date;
  readonly processedAt: Date | null;
  readonly attemptCount: number;
  readonly lastError: string | null;
  readonly updatedAt: Date;
}

export interface ClaimRuntimeInboxInput extends RuntimeInboxEventScope {
  readonly consumerName: string;
  readonly inboxId: string;
  readonly claimedAt: Date;
}

export interface CompleteRuntimeInboxInput extends RuntimeInboxEventScope {
  readonly consumerName: string;
  readonly processedAt: Date;
}

export interface FailRuntimeInboxInput extends RuntimeInboxEventScope {
  readonly consumerName: string;
  readonly failedAt: Date;
  readonly errorMessage: string;
}

export type RuntimeInboxDuplicateReason = 'already_processing' | 'already_processed';

export type RuntimeInboxClaimResult =
  | {
      readonly claimed: true;
      readonly duplicate: false;
      readonly inbox: RuntimeInboxRecord;
    }
  | {
      readonly claimed: false;
      readonly duplicate: true;
      readonly reason: RuntimeInboxDuplicateReason;
      readonly inbox: RuntimeInboxRecord;
    };

export interface RuntimeInboxStore {
  claim(input: ClaimRuntimeInboxInput): Promise<RuntimeInboxClaimResult>;
  complete(input: CompleteRuntimeInboxInput): Promise<RuntimeInboxRecord | null>;
  fail(input: FailRuntimeInboxInput): Promise<RuntimeInboxRecord | null>;
}

export interface RuntimeInboxConsumerOptions {
  readonly store: RuntimeInboxStore;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export interface RuntimeInboxConsumeInput extends RuntimeInboxEventScope {
  readonly consumerName: string;
}

export type RuntimeInboxConsumeResult<TValue> =
  | {
      readonly status: 'processed';
      readonly duplicate: false;
      readonly value: TValue;
      readonly inbox: RuntimeInboxRecord;
    }
  | {
      readonly status: 'duplicate';
      readonly duplicate: true;
      readonly reason: RuntimeInboxDuplicateReason;
      readonly inbox: RuntimeInboxRecord;
    };

export class RuntimeInboxConsumer {
  private readonly store: RuntimeInboxStore;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: RuntimeInboxConsumerOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
  }

  async claim(input: RuntimeInboxConsumeInput): Promise<RuntimeInboxClaimResult> {
    validateInboxScope(input);

    return this.store.claim({
      ...input,
      claimedAt: this.now(),
      inboxId: this.generateId(),
    });
  }

  async complete(input: RuntimeInboxConsumeInput): Promise<RuntimeInboxRecord | null> {
    validateInboxScope(input);

    return this.store.complete({
      ...input,
      processedAt: this.now(),
    });
  }

  async fail(input: RuntimeInboxConsumeInput & { readonly errorMessage: string }): Promise<RuntimeInboxRecord | null> {
    validateInboxScope(input);
    assertNonBlank(input.errorMessage, 'errorMessage');

    return this.store.fail({
      ...input,
      failedAt: this.now(),
    });
  }

  async consume<TValue>(
    input: RuntimeInboxConsumeInput,
    handler: (inbox: RuntimeInboxRecord) => Promise<TValue>,
  ): Promise<RuntimeInboxConsumeResult<TValue>> {
    const claim = await this.claim(input);

    if (!claim.claimed) {
      return {
        duplicate: true,
        inbox: claim.inbox,
        reason: claim.reason,
        status: 'duplicate',
      };
    }

    let value: TValue;

    try {
      value = await handler(claim.inbox);
    } catch (error) {
      await this.fail({
        ...input,
        errorMessage: runtimeInboxErrorMessage(error),
      });
      throw error;
    }

    const completed = await this.complete(input);

    if (completed === null) {
      throw new Error('Claimed runtime inbox row could not be completed.');
    }

    return {
      duplicate: false,
      inbox: completed,
      status: 'processed',
      value,
    };
  }
}

export class KyselyRuntimeInboxStore implements RuntimeInboxStore {
  private readonly db: Kysely<HelixDatabase>;

  constructor(db: Kysely<HelixDatabase>) {
    this.db = db;
  }

  async claim(input: ClaimRuntimeInboxInput): Promise<RuntimeInboxClaimResult> {
    validateClaimInput(input);

    return this.db.transaction().execute(async (transaction) => {
      const inserted = await transaction
        .insertInto('runtime_inbox')
        .values({
          id: input.inboxId,
          consumer_name: input.consumerName,
          event_id: input.eventId,
          tenant_id: input.tenantId,
          project_id: input.projectId,
          status: 'processing',
          processing_started_at: input.claimedAt,
          processed_at: null,
          attempt_count: 1,
          last_error: null,
          updated_at: input.claimedAt,
        })
        .onConflict((conflict) => conflict.columns(['consumer_name', 'event_id']).doNothing())
        .returningAll()
        .executeTakeFirst();

      if (inserted !== undefined) {
        return { claimed: true, duplicate: false, inbox: toRuntimeInboxRecord(inserted) };
      }

      const existing = await findRuntimeInboxRecord(transaction, input);

      if (existing === null) {
        throw new Error('Runtime inbox conflict row was not readable after claim conflict.');
      }

      assertSameScope(existing, input);

      if (existing.status !== 'failed') {
        return {
          claimed: false,
          duplicate: true,
          inbox: existing,
          reason: existing.status === 'processed' ? 'already_processed' : 'already_processing',
        };
      }

      const retried = await transaction
        .updateTable('runtime_inbox')
        .set({
          status: 'processing',
          processing_started_at: input.claimedAt,
          processed_at: null,
          attempt_count: sql<number>`attempt_count + 1`,
          last_error: null,
          updated_at: input.claimedAt,
        })
        .where('consumer_name', '=', input.consumerName)
        .where('event_id', '=', input.eventId)
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('status', '=', 'failed')
        .returningAll()
        .executeTakeFirst();

      if (retried !== undefined) {
        return { claimed: true, duplicate: false, inbox: toRuntimeInboxRecord(retried) };
      }

      const current = await findRuntimeInboxRecord(transaction, input);

      if (current === null) {
        throw new Error('Runtime inbox retry row disappeared during claim.');
      }

      assertSameScope(current, input);

      return {
        claimed: false,
        duplicate: true,
        inbox: current,
        reason: current.status === 'processed' ? 'already_processed' : 'already_processing',
      };
    });
  }

  async complete(input: CompleteRuntimeInboxInput): Promise<RuntimeInboxRecord | null> {
    validateCompleteInput(input);

    const row = await this.db
      .updateTable('runtime_inbox')
      .set({
        status: 'processed',
        processed_at: input.processedAt,
        last_error: null,
        updated_at: input.processedAt,
      })
      .where('consumer_name', '=', input.consumerName)
      .where('event_id', '=', input.eventId)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('status', '=', 'processing')
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toRuntimeInboxRecord(row);
  }

  async fail(input: FailRuntimeInboxInput): Promise<RuntimeInboxRecord | null> {
    validateFailInput(input);

    const row = await this.db
      .updateTable('runtime_inbox')
      .set({
        status: 'failed',
        processed_at: null,
        last_error: input.errorMessage,
        updated_at: input.failedAt,
      })
      .where('consumer_name', '=', input.consumerName)
      .where('event_id', '=', input.eventId)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('status', '=', 'processing')
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toRuntimeInboxRecord(row);
  }
}

async function findRuntimeInboxRecord(
  transaction: Transaction<HelixDatabase>,
  input: RuntimeInboxConsumeInput,
): Promise<RuntimeInboxRecord | null> {
  const row = await transaction
    .selectFrom('runtime_inbox')
    .selectAll()
    .where('consumer_name', '=', input.consumerName)
    .where('event_id', '=', input.eventId)
    .executeTakeFirst();

  return row === undefined ? null : toRuntimeInboxRecord(row);
}

function toRuntimeInboxRecord(row: {
  readonly id: string;
  readonly consumer_name: string;
  readonly event_id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly status: RuntimeInboxStatus;
  readonly processing_started_at: Date;
  readonly processed_at: Date | null;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly updated_at: Date;
}): RuntimeInboxRecord {
  return {
    id: row.id,
    consumerName: row.consumer_name,
    eventId: row.event_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    status: row.status,
    processingStartedAt: row.processing_started_at,
    processedAt: row.processed_at,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function assertSameScope(record: RuntimeInboxRecord, input: RuntimeInboxEventScope): void {
  if (record.tenantId !== input.tenantId || record.projectId !== input.projectId) {
    throw new Error('Runtime inbox event id belongs to a different tenant/project scope.');
  }
}

function validateClaimInput(input: ClaimRuntimeInboxInput): void {
  validateInboxScope(input);
  assertNonBlank(input.inboxId, 'inboxId');
}

function validateCompleteInput(input: CompleteRuntimeInboxInput): void {
  validateInboxScope(input);
}

function validateFailInput(input: FailRuntimeInboxInput): void {
  validateInboxScope(input);
  assertNonBlank(input.errorMessage, 'errorMessage');
}

function validateInboxScope(input: RuntimeInboxConsumeInput): void {
  assertNonBlank(input.consumerName, 'consumerName');
  assertNonBlank(input.eventId, 'eventId');
  assertNonBlank(input.tenantId, 'tenantId');
  assertNonBlank(input.projectId, 'projectId');
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty.`);
  }
}

function runtimeInboxErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return 'Unknown runtime inbox error';
}
