import type { Kysely, Selectable } from 'kysely';
import type {
  AuthContext,
  CreateJobRequest,
  JobRecord,
  TenantProjectScope,
} from '@helix/contracts';

import type { HelixDatabase } from '../../db/schema.js';
import { assertProjectPermission } from '../iam/authorization.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';
import type {
  RuntimeEventRecord,
  RuntimeOutboxRecord,
} from '../runtime/transactional-outbox.js';

const runtimeEventTopic = 'helix.runtime.events';

export interface CreateJobInput extends TenantProjectScope {
  readonly idempotencyKey: string;
  readonly request: CreateJobRequest;
}

export interface GetJobInput extends TenantProjectScope {
  readonly jobId: string;
}

export interface CreateJobResult {
  readonly job: JobRecord;
  readonly created: boolean;
  readonly ready: boolean;
}

export interface JobRepositoryCreateInput {
  readonly job: JobRecord;
  readonly events: readonly RuntimeEventRecord[];
  readonly outbox: readonly RuntimeOutboxRecord[];
}

export interface JobRepositoryCreateResult {
  readonly job: JobRecord;
  readonly created: boolean;
}

export interface JobRepository {
  findJobByIdempotencyKey(input: TenantProjectScope & {
    readonly idempotencyKey: string;
  }): Promise<JobRecord | null>;
  createOrFindByIdempotencyKey(
    input: JobRepositoryCreateInput,
  ): Promise<JobRepositoryCreateResult>;
  findJobById(input: GetJobInput): Promise<JobRecord | null>;
  listJobs(input: TenantProjectScope): Promise<JobRecord[]>;
}

export interface JobServiceOptions {
  readonly repository: JobRepository;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class JobService {
  private readonly repository: JobRepository;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: JobServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
  }

  async createJob(authContext: AuthContext, input: CreateJobInput): Promise<CreateJobResult> {
    assertProjectPermission(authContext, input, 'jobs:create');
    assertNonBlank(input.idempotencyKey, 'idempotencyKey');

    const timestamp = this.now();
    const existing = await this.repository.findJobByIdempotencyKey({
      tenantId: input.tenantId,
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
    });

    if (existing !== null) {
      return {
        job: existing,
        created: false,
        ready: isReady(existing, timestamp),
      };
    }

    const readyAt = input.request.readyAt ?? timestamp.toISOString();
    const job: JobRecord = {
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      state: 'queued',
      priority: input.request.priority ?? 0,
      maxAttempts: input.request.maxAttempts ?? 3,
      attemptCount: 0,
      readyAt,
      idempotencyKey: input.idempotencyKey,
      constraints: input.request.constraints ?? {},
      metadata: input.request.metadata ?? {},
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
      finishedAt: null,
    };
    const events = this.createJobEvents(job, timestamp);
    const outbox = events.map((event) => this.createRuntimeOutbox(event, timestamp));
    const result = await this.repository.createOrFindByIdempotencyKey({ job, events, outbox });

    return {
      job: result.job,
      created: result.created,
      ready: isReady(result.job, timestamp),
    };
  }

  async getJob(authContext: AuthContext, input: GetJobInput): Promise<CreateJobResult | null> {
    assertProjectPermission(authContext, input, 'jobs:read');

    const job = await this.repository.findJobById(input);

    if (job === null) {
      return null;
    }

    return {
      job,
      created: false,
      ready: isReady(job, this.now()),
    };
  }

  async listJobs(authContext: AuthContext, input: TenantProjectScope): Promise<JobRecord[]> {
    assertProjectPermission(authContext, input, 'jobs:read');

    return this.repository.listJobs(input);
  }

  private createJobEvents(job: JobRecord, timestamp: Date): RuntimeEventRecord[] {
    const events: RuntimeEventRecord[] = [
      this.createRuntimeEvent({
        eventType: 'job.created',
        job,
        payload: {
          tenantId: job.tenantId,
          projectId: job.projectId,
          jobId: job.id,
          state: job.state,
          idempotencyKey: job.idempotencyKey,
          readyAt: job.readyAt,
        },
        timestamp,
      }),
    ];

    if (isReady(job, timestamp)) {
      events.push(
        this.createRuntimeEvent({
          eventType: 'job.ready',
          job,
          payload: {
            tenantId: job.tenantId,
            projectId: job.projectId,
            jobId: job.id,
            readyAt: job.readyAt,
          },
          timestamp,
        }),
      );
    }

    return events;
  }

  private createRuntimeEvent(input: {
    readonly eventType: string;
    readonly job: JobRecord;
    readonly payload: Record<string, unknown>;
    readonly timestamp: Date;
  }): RuntimeEventRecord {
    return {
      id: this.generateId(),
      tenantId: input.job.tenantId,
      projectId: input.job.projectId,
      eventType: input.eventType,
      eventVersion: 1,
      orderingKey: `project:${input.job.projectId}:job:${input.job.id}`,
      payload: input.payload,
      occurredAt: input.timestamp,
      recordedAt: input.timestamp,
    };
  }

  private createRuntimeOutbox(
    event: RuntimeEventRecord,
    timestamp: Date,
  ): RuntimeOutboxRecord {
    return {
      id: this.generateId(),
      tenantId: event.tenantId,
      projectId: event.projectId,
      eventId: event.id,
      topic: runtimeEventTopic,
      partitionKey: event.orderingKey,
      status: 'pending',
      publishAttempts: 0,
      nextAttemptAt: timestamp,
      publishedAt: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}

export class InMemoryJobRepository implements JobRepository {
  readonly jobs: JobRecord[] = [];
  readonly runtimeEvents: RuntimeEventRecord[] = [];
  readonly runtimeOutbox: RuntimeOutboxRecord[] = [];

  async findJobByIdempotencyKey(input: TenantProjectScope & {
    readonly idempotencyKey: string;
  }): Promise<JobRecord | null> {
    return (
      this.jobs.find(
        (job) =>
          job.tenantId === input.tenantId &&
          job.projectId === input.projectId &&
          job.idempotencyKey === input.idempotencyKey,
      ) ?? null
    );
  }

  async createOrFindByIdempotencyKey(
    input: JobRepositoryCreateInput,
  ): Promise<JobRepositoryCreateResult> {
    const existing = await this.findJobByIdempotencyKey({
      tenantId: input.job.tenantId,
      projectId: input.job.projectId,
      idempotencyKey: input.job.idempotencyKey ?? '',
    });

    if (existing !== null) {
      return { job: existing, created: false };
    }

    this.jobs.push(input.job);
    this.runtimeEvents.push(...input.events);
    this.runtimeOutbox.push(...input.outbox);

    return { job: input.job, created: true };
  }

  async findJobById(input: GetJobInput): Promise<JobRecord | null> {
    return (
      this.jobs.find(
        (job) =>
          job.tenantId === input.tenantId &&
          job.projectId === input.projectId &&
          job.id === input.jobId,
      ) ?? null
    );
  }

  async listJobs(input: TenantProjectScope): Promise<JobRecord[]> {
    return this.jobs.filter(
      (job) => job.tenantId === input.tenantId && job.projectId === input.projectId,
    );
  }
}

export class KyselyJobRepository implements JobRepository {
  private readonly db: Kysely<HelixDatabase>;

  constructor(db: Kysely<HelixDatabase>) {
    this.db = db;
  }

  async findJobByIdempotencyKey(input: TenantProjectScope & {
    readonly idempotencyKey: string;
  }): Promise<JobRecord | null> {
    const row = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();

    return row === undefined ? null : toJobRecord(row);
  }

  async createOrFindByIdempotencyKey(
    input: JobRepositoryCreateInput,
  ): Promise<JobRepositoryCreateResult> {
    return this.db.transaction().execute(async (transaction) => {
      const inserted = await transaction
        .insertInto('jobs')
        .values(toJobRow(input.job))
        .onConflict((conflict) =>
          conflict
            .columns(['tenant_id', 'project_id', 'idempotency_key'])
            .where('idempotency_key', 'is not', null)
            .doNothing(),
        )
        .returningAll()
        .executeTakeFirst();

      if (inserted === undefined) {
        const existing = await transaction
          .selectFrom('jobs')
          .selectAll()
          .where('tenant_id', '=', input.job.tenantId)
          .where('project_id', '=', input.job.projectId)
          .where('idempotency_key', '=', input.job.idempotencyKey)
          .executeTakeFirst();

        if (existing === undefined) {
          throw new Error('Job conflict row was not readable after idempotency conflict.');
        }

        return { job: toJobRecord(existing), created: false };
      }

      for (const event of input.events) {
        await transaction.insertInto('runtime_events').values(toRuntimeEventRow(event)).execute();
      }

      for (const outbox of input.outbox) {
        await transaction.insertInto('runtime_outbox').values(toRuntimeOutboxRow(outbox)).execute();
      }

      return { job: toJobRecord(inserted), created: true };
    });
  }

  async findJobById(input: GetJobInput): Promise<JobRecord | null> {
    const row = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('id', '=', input.jobId)
      .executeTakeFirst();

    return row === undefined ? null : toJobRecord(row);
  }

  async listJobs(input: TenantProjectScope): Promise<JobRecord[]> {
    const rows = await this.db
      .selectFrom('jobs')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .orderBy('updated_at', 'desc')
      .execute();

    return rows.map(toJobRecord);
  }
}

export function getRuntimeEventTopic(): string {
  return runtimeEventTopic;
}

function isReady(job: JobRecord, now: Date): boolean {
  return job.state === 'queued' && Date.parse(job.readyAt) <= now.getTime();
}

function toJobRow(job: JobRecord) {
  return {
    id: job.id,
    tenant_id: job.tenantId,
    project_id: job.projectId,
    state: job.state,
    priority: job.priority,
    max_attempts: job.maxAttempts,
    attempt_count: job.attemptCount,
    ready_at: job.readyAt,
    idempotency_key: job.idempotencyKey,
    constraints_json: job.constraints,
    metadata_json: job.metadata,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
  };
}

function toJobRecord(row: Selectable<HelixDatabase['jobs']>): JobRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    state: row.state,
    priority: row.priority,
    maxAttempts: row.max_attempts,
    attemptCount: row.attempt_count,
    readyAt: toIsoString(row.ready_at),
    idempotencyKey: row.idempotency_key,
    constraints: row.constraints_json,
    metadata: row.metadata_json,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    finishedAt: row.finished_at === null ? null : toIsoString(row.finished_at),
  };
}

function toRuntimeEventRow(event: RuntimeEventRecord) {
  return {
    id: event.id,
    tenant_id: event.tenantId,
    project_id: event.projectId,
    event_type: event.eventType,
    event_version: event.eventVersion,
    ordering_key: event.orderingKey,
    payload_json: event.payload,
    occurred_at: event.occurredAt,
    recorded_at: event.recordedAt,
  };
}

function toRuntimeOutboxRow(outbox: RuntimeOutboxRecord) {
  return {
    id: outbox.id,
    tenant_id: outbox.tenantId,
    project_id: outbox.projectId,
    event_id: outbox.eventId,
    topic: outbox.topic,
    partition_key: outbox.partitionKey,
    status: outbox.status,
    publish_attempts: outbox.publishAttempts,
    next_attempt_at: outbox.nextAttemptAt,
    published_at: outbox.publishedAt,
    last_error: outbox.lastError,
    created_at: outbox.createdAt,
    updated_at: outbox.updatedAt,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty.`);
  }
}
