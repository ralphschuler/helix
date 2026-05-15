import type { Kysely, Selectable } from 'kysely';
import type {
  AuthContext,
  ClaimJobRequest,
  ClaimedJob as ClaimedJobRecord,
  CreateJobRequest,
  FailJobAttemptRequest,
  HeartbeatLeaseRequest,
  JobAttemptRecord,
  JobHistoryResponse,
  JobLeaseRecord,
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
const defaultLeaseTtlSeconds = 300;
const maxLeaseTtlSeconds = 86_400;
const defaultExpiredLeaseLimit = 50;

export interface CreateJobInput extends TenantProjectScope {
  readonly idempotencyKey: string;
  readonly request: CreateJobRequest;
}

export interface GetJobInput extends TenantProjectScope {
  readonly jobId: string;
}

export interface ClaimReadyJobInput extends TenantProjectScope {
  readonly request: ClaimJobRequest;
}

export interface HeartbeatLeaseInput extends TenantProjectScope {
  readonly jobId: string;
  readonly leaseId: string;
  readonly request: HeartbeatLeaseRequest;
}

export interface CompleteJobAttemptInput extends TenantProjectScope {
  readonly jobId: string;
  readonly attemptId: string;
  readonly leaseId: string;
}

export interface FailJobAttemptInput extends TenantProjectScope {
  readonly jobId: string;
  readonly attemptId: string;
  readonly leaseId: string;
  readonly request: FailJobAttemptRequest;
}

export interface ExpireLeasesInput extends TenantProjectScope {
  readonly limit?: number;
}

export interface CreateJobResult {
  readonly job: JobRecord;
  readonly created: boolean;
  readonly ready: boolean;
}

export type ClaimReadyJobResult = ClaimedJobRecord;
export type HeartbeatLeaseResult = JobLeaseRecord;
export type JobHistoryResult = JobHistoryResponse;
export type ExpiredLeaseResult = ClaimedJobRecord;

export interface CompleteJobAttemptResult {
  readonly transition: ClaimedJobRecord;
  readonly duplicate: boolean;
}

export type FailJobAttemptResult = CompleteJobAttemptResult;

export interface JobRepositoryCreateInput {
  readonly job: JobRecord;
  readonly events: readonly RuntimeEventRecord[];
  readonly outbox: readonly RuntimeOutboxRecord[];
}

export interface JobRepositoryCreateResult {
  readonly job: JobRecord;
  readonly created: boolean;
}

export interface JobRepositoryClaimInput extends TenantProjectScope {
  readonly agentId: string;
  readonly attemptId: string;
  readonly leaseId: string;
  readonly now: Date;
  readonly leaseExpiresAt: Date;
}

export interface JobRepositoryHeartbeatInput extends TenantProjectScope {
  readonly jobId: string;
  readonly leaseId: string;
  readonly agentId: string;
  readonly now: Date;
  readonly leaseExpiresAt: Date;
}

export interface JobRepositoryCompleteAttemptInput extends TenantProjectScope {
  readonly jobId: string;
  readonly attemptId: string;
  readonly leaseId: string;
  readonly agentId: string;
  readonly now: Date;
  readonly events: readonly RuntimeEventRecord[];
  readonly outbox: readonly RuntimeOutboxRecord[];
}

export interface JobRepositoryFailAttemptInput extends JobRepositoryCompleteAttemptInput {
  readonly failureCode: string;
  readonly failureMessage: string | null;
}

export type JobRepositoryTerminalAttemptResult =
  | { readonly status: 'applied'; readonly transition: ClaimedJobRecord }
  | { readonly status: 'duplicate'; readonly transition: ClaimedJobRecord }
  | { readonly status: 'not_found' }
  | { readonly status: 'stale' };

export type JobRepositoryCompleteAttemptResult = JobRepositoryTerminalAttemptResult;
export type JobRepositoryFailAttemptResult = JobRepositoryTerminalAttemptResult;

export interface JobRepositoryExpireLeasesInput extends TenantProjectScope {
  readonly now: Date;
  readonly limit: number;
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
  getJobHistory(input: GetJobInput): Promise<JobHistoryResult | null>;
  claimReadyJob(input: JobRepositoryClaimInput): Promise<ClaimedJobRecord | null>;
  heartbeatLease(input: JobRepositoryHeartbeatInput): Promise<JobLeaseRecord | null>;
  completeJobAttempt(
    input: JobRepositoryCompleteAttemptInput,
  ): Promise<JobRepositoryCompleteAttemptResult>;
  failJobAttempt(input: JobRepositoryFailAttemptInput): Promise<JobRepositoryFailAttemptResult>;
  expireLeases(input: JobRepositoryExpireLeasesInput): Promise<ExpiredLeaseResult[]>;
}

export interface JobServiceOptions {
  readonly repository: JobRepository;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class AgentClaimRequiredError extends Error {
  constructor() {
    super('Agent-token authentication is required to claim, heartbeat, complete, or fail jobs.');
    this.name = 'AgentClaimRequiredError';
  }
}

export class StaleJobAttemptError extends Error {
  constructor() {
    super('Job attempt is stale and cannot mutate terminal job state.');
    this.name = 'StaleJobAttemptError';
  }
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

  async getJobHistory(
    authContext: AuthContext,
    input: GetJobInput,
  ): Promise<JobHistoryResult | null> {
    assertProjectPermission(authContext, input, 'jobs:read');

    return this.repository.getJobHistory(input);
  }

  async claimReadyJob(
    authContext: AuthContext,
    input: ClaimReadyJobInput,
  ): Promise<ClaimReadyJobResult | null> {
    assertProjectPermission(authContext, input, 'agents:claim');
    const timestamp = this.now();

    return this.repository.claimReadyJob({
      tenantId: input.tenantId,
      projectId: input.projectId,
      agentId: getAgentIdForClaim(authContext),
      attemptId: this.generateId(),
      leaseId: this.generateId(),
      now: timestamp,
      leaseExpiresAt: calculateLeaseExpiresAt(input.request, timestamp),
    });
  }

  async heartbeatLease(
    authContext: AuthContext,
    input: HeartbeatLeaseInput,
  ): Promise<HeartbeatLeaseResult | null> {
    assertProjectPermission(authContext, input, 'agents:claim');
    const timestamp = this.now();

    return this.repository.heartbeatLease({
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: input.jobId,
      leaseId: input.leaseId,
      agentId: getAgentIdForClaim(authContext),
      now: timestamp,
      leaseExpiresAt: calculateLeaseExpiresAt(input.request, timestamp),
    });
  }

  async completeJobAttempt(
    authContext: AuthContext,
    input: CompleteJobAttemptInput,
  ): Promise<CompleteJobAttemptResult | null> {
    assertProjectPermission(authContext, input, 'agents:claim');
    const timestamp = this.now();
    const agentId = getAgentIdForClaim(authContext);
    const event = this.createRuntimeEvent({
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: input.jobId,
      eventType: 'job.completed',
      payload: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        leaseId: input.leaseId,
        agentId,
        completedAt: timestamp.toISOString(),
      },
      timestamp,
    });
    const result = await this.repository.completeJobAttempt({
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: input.jobId,
      attemptId: input.attemptId,
      leaseId: input.leaseId,
      agentId,
      now: timestamp,
      events: [event],
      outbox: [this.createRuntimeOutbox(event, timestamp)],
    });

    if (result.status === 'not_found') {
      return null;
    }

    if (result.status === 'stale') {
      throw new StaleJobAttemptError();
    }

    return {
      transition: result.transition,
      duplicate: result.status === 'duplicate',
    };
  }

  async failJobAttempt(
    authContext: AuthContext,
    input: FailJobAttemptInput,
  ): Promise<FailJobAttemptResult | null> {
    assertProjectPermission(authContext, input, 'agents:claim');
    const timestamp = this.now();
    const agentId = getAgentIdForClaim(authContext);
    const failureMessage = input.request.failureMessage ?? null;
    const event = this.createRuntimeEvent({
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: input.jobId,
      eventType: 'job.attempt.failed',
      payload: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        leaseId: input.leaseId,
        agentId,
        failureCode: input.request.failureCode,
        failureMessage,
        failedAt: timestamp.toISOString(),
      },
      timestamp,
    });
    const result = await this.repository.failJobAttempt({
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: input.jobId,
      attemptId: input.attemptId,
      leaseId: input.leaseId,
      agentId,
      now: timestamp,
      failureCode: input.request.failureCode,
      failureMessage,
      events: [event],
      outbox: [this.createRuntimeOutbox(event, timestamp)],
    });

    if (result.status === 'not_found') {
      return null;
    }

    if (result.status === 'stale') {
      throw new StaleJobAttemptError();
    }

    return {
      transition: result.transition,
      duplicate: result.status === 'duplicate',
    };
  }

  async expireLeases(input: ExpireLeasesInput): Promise<ExpiredLeaseResult[]> {
    const timestamp = this.now();

    return this.repository.expireLeases({
      tenantId: input.tenantId,
      projectId: input.projectId,
      now: timestamp,
      limit: normalizeLimit(input.limit),
    });
  }

  private createJobEvents(job: JobRecord, timestamp: Date): RuntimeEventRecord[] {
    const events: RuntimeEventRecord[] = [
      this.createRuntimeEvent({
        eventType: 'job.created',
        tenantId: job.tenantId,
        projectId: job.projectId,
        jobId: job.id,
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
          tenantId: job.tenantId,
          projectId: job.projectId,
          jobId: job.id,
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
    readonly tenantId: string;
    readonly projectId: string;
    readonly jobId: string;
    readonly payload: Record<string, unknown>;
    readonly timestamp: Date;
  }): RuntimeEventRecord {
    return {
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      eventType: input.eventType,
      eventVersion: 1,
      orderingKey: `project:${input.projectId}:job:${input.jobId}`,
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
  readonly attempts: JobAttemptRecord[] = [];
  readonly leases: JobLeaseRecord[] = [];
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

  async getJobHistory(input: GetJobInput): Promise<JobHistoryResult | null> {
    const job = await this.findJobById(input);

    if (job === null) {
      return null;
    }

    return {
      job,
      attempts: this.attempts
        .filter(
          (attempt) =>
            attempt.tenantId === input.tenantId &&
            attempt.projectId === input.projectId &&
            attempt.jobId === input.jobId,
        )
        .sort((left, right) => left.attemptNumber - right.attemptNumber),
      leases: this.leases
        .filter(
          (lease) =>
            lease.tenantId === input.tenantId &&
            lease.projectId === input.projectId &&
            lease.jobId === input.jobId,
        )
        .sort(compareLeasesByAcquisition),
    };
  }

  async claimReadyJob(input: JobRepositoryClaimInput): Promise<ClaimedJobRecord | null> {
    const job = this.jobs
      .filter(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.projectId === input.projectId &&
          isReady(candidate, input.now) &&
          candidate.attemptCount < candidate.maxAttempts &&
          !this.hasActiveLease(candidate),
      )
      .sort(compareClaimableJobs)[0];

    if (job === undefined) {
      return null;
    }

    const updatedJob: JobRecord = {
      ...job,
      state: 'running',
      attemptCount: job.attemptCount + 1,
      updatedAt: input.now.toISOString(),
      finishedAt: null,
    };
    const attempt: JobAttemptRecord = {
      id: input.attemptId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: job.id,
      attemptNumber: updatedJob.attemptCount,
      state: 'running',
      agentId: input.agentId,
      startedAt: input.now.toISOString(),
      finishedAt: null,
      failureCode: null,
      failureMessage: null,
    };
    const lease: JobLeaseRecord = {
      id: input.leaseId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: job.id,
      attemptId: attempt.id,
      agentId: input.agentId,
      state: 'active',
      acquiredAt: input.now.toISOString(),
      expiresAt: input.leaseExpiresAt.toISOString(),
      lastHeartbeatAt: input.now.toISOString(),
      releasedAt: null,
      expiredAt: null,
      canceledAt: null,
    };

    this.replaceJob(updatedJob);
    this.attempts.push(attempt);
    this.leases.push(lease);

    return { job: updatedJob, attempt, lease };
  }

  async heartbeatLease(input: JobRepositoryHeartbeatInput): Promise<JobLeaseRecord | null> {
    const lease = this.leases.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.jobId === input.jobId &&
        candidate.id === input.leaseId &&
        candidate.agentId === input.agentId &&
        candidate.state === 'active' &&
        Date.parse(candidate.expiresAt) > input.now.getTime(),
    );

    if (lease === undefined) {
      return null;
    }

    const extendedExpiresAt = maxDate(new Date(lease.expiresAt), input.leaseExpiresAt);
    const updatedLease: JobLeaseRecord = {
      ...lease,
      expiresAt: extendedExpiresAt.toISOString(),
      lastHeartbeatAt: input.now.toISOString(),
    };

    this.replaceLease(updatedLease);

    return updatedLease;
  }

  async completeJobAttempt(
    input: JobRepositoryCompleteAttemptInput,
  ): Promise<JobRepositoryCompleteAttemptResult> {
    const records = this.findAttemptTransitionRecords(input);

    if (records === null) {
      return { status: 'not_found' };
    }

    if (isCompleteDuplicate(records)) {
      return { status: 'duplicate', transition: records };
    }

    if (!canFinishRunningAttempt(records, input.now)) {
      return { status: 'stale' };
    }

    const timestamp = input.now.toISOString();
    const updatedLease: JobLeaseRecord = {
      ...records.lease,
      state: 'released',
      releasedAt: timestamp,
    };
    const updatedAttempt: JobAttemptRecord = {
      ...records.attempt,
      state: 'completed',
      finishedAt: timestamp,
    };
    const updatedJob: JobRecord = {
      ...records.job,
      state: 'completed',
      updatedAt: timestamp,
      finishedAt: timestamp,
    };

    this.replaceLease(updatedLease);
    this.replaceAttempt(updatedAttempt);
    this.replaceJob(updatedJob);
    this.runtimeEvents.push(...input.events);
    this.runtimeOutbox.push(...input.outbox);

    return {
      status: 'applied',
      transition: { job: updatedJob, attempt: updatedAttempt, lease: updatedLease },
    };
  }

  async failJobAttempt(
    input: JobRepositoryFailAttemptInput,
  ): Promise<JobRepositoryFailAttemptResult> {
    const records = this.findAttemptTransitionRecords(input);

    if (records === null) {
      return { status: 'not_found' };
    }

    if (isFailDuplicate(records)) {
      return { status: 'duplicate', transition: records };
    }

    if (!canFinishRunningAttempt(records, input.now)) {
      return { status: 'stale' };
    }

    const timestamp = input.now.toISOString();
    const exhaustedAttempts = records.job.attemptCount >= records.job.maxAttempts;
    const updatedLease: JobLeaseRecord = {
      ...records.lease,
      state: 'released',
      releasedAt: timestamp,
    };
    const updatedAttempt: JobAttemptRecord = {
      ...records.attempt,
      state: 'failed',
      finishedAt: timestamp,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
    };
    const updatedJob: JobRecord = {
      ...records.job,
      state: exhaustedAttempts ? 'dead_lettered' : 'retrying',
      readyAt: timestamp,
      updatedAt: timestamp,
      finishedAt: exhaustedAttempts ? timestamp : null,
    };

    this.replaceLease(updatedLease);
    this.replaceAttempt(updatedAttempt);
    this.replaceJob(updatedJob);
    this.runtimeEvents.push(...input.events);
    this.runtimeOutbox.push(...input.outbox);

    return {
      status: 'applied',
      transition: { job: updatedJob, attempt: updatedAttempt, lease: updatedLease },
    };
  }

  async expireLeases(input: JobRepositoryExpireLeasesInput): Promise<ExpiredLeaseResult[]> {
    const expired: ExpiredLeaseResult[] = [];
    const activeExpiredLeases = this.leases
      .filter(
        (lease) =>
          lease.tenantId === input.tenantId &&
          lease.projectId === input.projectId &&
          lease.state === 'active' &&
          Date.parse(lease.expiresAt) <= input.now.getTime(),
      )
      .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
      .slice(0, input.limit);

    for (const lease of activeExpiredLeases) {
      const attempt = this.attempts.find(
        (candidate) =>
          candidate.tenantId === lease.tenantId &&
          candidate.projectId === lease.projectId &&
          candidate.jobId === lease.jobId &&
          candidate.id === lease.attemptId &&
          candidate.state === 'running',
      );
      const job = this.jobs.find(
        (candidate) =>
          candidate.tenantId === lease.tenantId &&
          candidate.projectId === lease.projectId &&
          candidate.id === lease.jobId &&
          candidate.state === 'running',
      );

      if (attempt === undefined || job === undefined) {
        continue;
      }

      const updatedLease: JobLeaseRecord = {
        ...lease,
        state: 'expired',
        expiredAt: input.now.toISOString(),
      };
      const updatedAttempt: JobAttemptRecord = {
        ...attempt,
        state: 'expired',
        finishedAt: input.now.toISOString(),
      };
      const exhaustedAttempts = job.attemptCount >= job.maxAttempts;
      const updatedJob: JobRecord = {
        ...job,
        state: exhaustedAttempts ? 'dead_lettered' : 'retrying',
        readyAt: input.now.toISOString(),
        updatedAt: input.now.toISOString(),
        finishedAt: exhaustedAttempts ? input.now.toISOString() : null,
      };

      this.replaceLease(updatedLease);
      this.replaceAttempt(updatedAttempt);
      this.replaceJob(updatedJob);
      expired.push({ job: updatedJob, attempt: updatedAttempt, lease: updatedLease });
    }

    return expired;
  }

  private findAttemptTransitionRecords(
    input: JobRepositoryCompleteAttemptInput,
  ): ClaimedJobRecord | null {
    const lease = this.leases.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.jobId === input.jobId &&
        candidate.attemptId === input.attemptId &&
        candidate.id === input.leaseId &&
        candidate.agentId === input.agentId,
    );

    if (lease === undefined) {
      return null;
    }

    const attempt = this.attempts.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.jobId === input.jobId &&
        candidate.id === input.attemptId,
    );
    const job = this.jobs.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.id === input.jobId,
    );

    if (attempt === undefined || job === undefined) {
      return null;
    }

    return { job, attempt, lease };
  }

  private hasActiveLease(job: JobRecord): boolean {
    return this.leases.some(
      (lease) =>
        lease.tenantId === job.tenantId &&
        lease.projectId === job.projectId &&
        lease.jobId === job.id &&
        lease.state === 'active',
    );
  }

  private replaceJob(job: JobRecord): void {
    const index = this.jobs.findIndex(
      (candidate) =>
        candidate.tenantId === job.tenantId &&
        candidate.projectId === job.projectId &&
        candidate.id === job.id,
    );

    if (index === -1) {
      this.jobs.push(job);
      return;
    }

    this.jobs[index] = job;
  }

  private replaceAttempt(attempt: JobAttemptRecord): void {
    const index = this.attempts.findIndex(
      (candidate) =>
        candidate.tenantId === attempt.tenantId &&
        candidate.projectId === attempt.projectId &&
        candidate.id === attempt.id,
    );

    if (index === -1) {
      this.attempts.push(attempt);
      return;
    }

    this.attempts[index] = attempt;
  }

  private replaceLease(lease: JobLeaseRecord): void {
    const index = this.leases.findIndex(
      (candidate) =>
        candidate.tenantId === lease.tenantId &&
        candidate.projectId === lease.projectId &&
        candidate.id === lease.id,
    );

    if (index === -1) {
      this.leases.push(lease);
      return;
    }

    this.leases[index] = lease;
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

  async getJobHistory(input: GetJobInput): Promise<JobHistoryResult | null> {
    return this.db.transaction().execute(async (transaction) => {
      const job = await transaction
        .selectFrom('jobs')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.jobId)
        .executeTakeFirst();

      if (job === undefined) {
        return null;
      }

      const attempts = await transaction
        .selectFrom('job_attempts')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('job_id', '=', input.jobId)
        .orderBy('attempt_number', 'asc')
        .execute();
      const leases = await transaction
        .selectFrom('job_leases')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('job_id', '=', input.jobId)
        .orderBy('acquired_at', 'asc')
        .orderBy('id', 'asc')
        .execute();

      return {
        job: toJobRecord(job),
        attempts: attempts.map(toJobAttemptRecord),
        leases: leases.map(toJobLeaseRecord),
      };
    });
  }

  async claimReadyJob(input: JobRepositoryClaimInput): Promise<ClaimedJobRecord | null> {
    return this.db.transaction().execute(async (transaction) => {
      const job = await transaction
        .selectFrom('jobs')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('state', 'in', ['queued', 'retrying'])
        .where('ready_at', '<=', input.now)
        .where((builder) => builder('attempt_count', '<', builder.ref('max_attempts')))
        .orderBy('priority', 'desc')
        .orderBy('ready_at', 'asc')
        .orderBy('created_at', 'asc')
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();

      if (job === undefined) {
        return null;
      }

      const updatedJob = await transaction
        .updateTable('jobs')
        .set({
          state: 'running',
          attempt_count: job.attempt_count + 1,
          updated_at: input.now,
          finished_at: null,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', job.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const attempt = await transaction
        .insertInto('job_attempts')
        .values({
          id: input.attemptId,
          tenant_id: input.tenantId,
          project_id: input.projectId,
          job_id: job.id,
          attempt_number: updatedJob.attempt_count,
          state: 'running',
          agent_id: input.agentId,
          started_at: input.now,
          finished_at: null,
          failure_code: null,
          failure_message: null,
          created_at: input.now,
          updated_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const lease = await transaction
        .insertInto('job_leases')
        .values({
          id: input.leaseId,
          tenant_id: input.tenantId,
          project_id: input.projectId,
          job_id: job.id,
          attempt_id: attempt.id,
          agent_id: input.agentId,
          state: 'active',
          acquired_at: input.now,
          expires_at: input.leaseExpiresAt,
          last_heartbeat_at: input.now,
          released_at: null,
          expired_at: null,
          canceled_at: null,
          created_at: input.now,
          updated_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        job: toJobRecord(updatedJob),
        attempt: toJobAttemptRecord(attempt),
        lease: toJobLeaseRecord(lease),
      };
    });
  }

  async heartbeatLease(input: JobRepositoryHeartbeatInput): Promise<JobLeaseRecord | null> {
    return this.db.transaction().execute(async (transaction) => {
      const lease = await transaction
        .selectFrom('job_leases')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('job_id', '=', input.jobId)
        .where('id', '=', input.leaseId)
        .where('agent_id', '=', input.agentId)
        .where('state', '=', 'active')
        .where('expires_at', '>', input.now)
        .forUpdate()
        .executeTakeFirst();

      if (lease === undefined) {
        return null;
      }

      const extendedExpiresAt = maxDate(toDate(lease.expires_at), input.leaseExpiresAt);
      const updatedLease = await transaction
        .updateTable('job_leases')
        .set({
          expires_at: extendedExpiresAt,
          last_heartbeat_at: input.now,
          updated_at: input.now,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.leaseId)
        .where('state', '=', 'active')
        .returningAll()
        .executeTakeFirst();

      return updatedLease === undefined ? null : toJobLeaseRecord(updatedLease);
    });
  }

  async completeJobAttempt(
    input: JobRepositoryCompleteAttemptInput,
  ): Promise<JobRepositoryCompleteAttemptResult> {
    return this.db.transaction().execute(async (transaction) => {
      const lease = await transaction
        .selectFrom('job_leases')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('job_id', '=', input.jobId)
        .where('attempt_id', '=', input.attemptId)
        .where('id', '=', input.leaseId)
        .where('agent_id', '=', input.agentId)
        .forUpdate()
        .executeTakeFirst();

      if (lease === undefined) {
        return { status: 'not_found' };
      }

      const attempt = await transaction
        .selectFrom('job_attempts')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('job_id', '=', input.jobId)
        .where('id', '=', input.attemptId)
        .forUpdate()
        .executeTakeFirst();
      const job = await transaction
        .selectFrom('jobs')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.jobId)
        .forUpdate()
        .executeTakeFirst();

      if (attempt === undefined || job === undefined) {
        return { status: 'not_found' };
      }

      const records = {
        job: toJobRecord(job),
        attempt: toJobAttemptRecord(attempt),
        lease: toJobLeaseRecord(lease),
      };

      if (isCompleteDuplicate(records)) {
        return { status: 'duplicate', transition: records };
      }

      if (!canFinishRunningAttempt(records, input.now)) {
        return { status: 'stale' };
      }

      const updatedLease = await transaction
        .updateTable('job_leases')
        .set({
          state: 'released',
          released_at: input.now,
          updated_at: input.now,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.leaseId)
        .where('state', '=', 'active')
        .returningAll()
        .executeTakeFirstOrThrow();
      const updatedAttempt = await transaction
        .updateTable('job_attempts')
        .set({
          state: 'completed',
          finished_at: input.now,
          updated_at: input.now,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.attemptId)
        .where('state', '=', 'running')
        .returningAll()
        .executeTakeFirstOrThrow();
      const updatedJob = await transaction
        .updateTable('jobs')
        .set({
          state: 'completed',
          updated_at: input.now,
          finished_at: input.now,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.jobId)
        .where('state', '=', 'running')
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const event of input.events) {
        await transaction.insertInto('runtime_events').values(toRuntimeEventRow(event)).execute();
      }

      for (const outbox of input.outbox) {
        await transaction.insertInto('runtime_outbox').values(toRuntimeOutboxRow(outbox)).execute();
      }

      return {
        status: 'applied',
        transition: {
          job: toJobRecord(updatedJob),
          attempt: toJobAttemptRecord(updatedAttempt),
          lease: toJobLeaseRecord(updatedLease),
        },
      };
    });
  }

  async failJobAttempt(
    input: JobRepositoryFailAttemptInput,
  ): Promise<JobRepositoryFailAttemptResult> {
    return this.db.transaction().execute(async (transaction) => {
      const lease = await transaction
        .selectFrom('job_leases')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('job_id', '=', input.jobId)
        .where('attempt_id', '=', input.attemptId)
        .where('id', '=', input.leaseId)
        .where('agent_id', '=', input.agentId)
        .forUpdate()
        .executeTakeFirst();

      if (lease === undefined) {
        return { status: 'not_found' };
      }

      const attempt = await transaction
        .selectFrom('job_attempts')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('job_id', '=', input.jobId)
        .where('id', '=', input.attemptId)
        .forUpdate()
        .executeTakeFirst();
      const job = await transaction
        .selectFrom('jobs')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.jobId)
        .forUpdate()
        .executeTakeFirst();

      if (attempt === undefined || job === undefined) {
        return { status: 'not_found' };
      }

      const records = {
        job: toJobRecord(job),
        attempt: toJobAttemptRecord(attempt),
        lease: toJobLeaseRecord(lease),
      };

      if (isFailDuplicate(records)) {
        return { status: 'duplicate', transition: records };
      }

      if (!canFinishRunningAttempt(records, input.now)) {
        return { status: 'stale' };
      }

      const exhaustedAttempts = records.job.attemptCount >= records.job.maxAttempts;
      const updatedLease = await transaction
        .updateTable('job_leases')
        .set({
          state: 'released',
          released_at: input.now,
          updated_at: input.now,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.leaseId)
        .where('state', '=', 'active')
        .returningAll()
        .executeTakeFirstOrThrow();
      const updatedAttempt = await transaction
        .updateTable('job_attempts')
        .set({
          state: 'failed',
          finished_at: input.now,
          failure_code: input.failureCode,
          failure_message: input.failureMessage,
          updated_at: input.now,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.attemptId)
        .where('state', '=', 'running')
        .returningAll()
        .executeTakeFirstOrThrow();
      const updatedJob = await transaction
        .updateTable('jobs')
        .set({
          state: exhaustedAttempts ? 'dead_lettered' : 'retrying',
          ready_at: input.now,
          updated_at: input.now,
          finished_at: exhaustedAttempts ? input.now : null,
        })
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('id', '=', input.jobId)
        .where('state', '=', 'running')
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const event of input.events) {
        await transaction.insertInto('runtime_events').values(toRuntimeEventRow(event)).execute();
      }

      for (const outbox of input.outbox) {
        await transaction.insertInto('runtime_outbox').values(toRuntimeOutboxRow(outbox)).execute();
      }

      return {
        status: 'applied',
        transition: {
          job: toJobRecord(updatedJob),
          attempt: toJobAttemptRecord(updatedAttempt),
          lease: toJobLeaseRecord(updatedLease),
        },
      };
    });
  }

  async expireLeases(input: JobRepositoryExpireLeasesInput): Promise<ExpiredLeaseResult[]> {
    return this.db.transaction().execute(async (transaction) => {
      const leases = await transaction
        .selectFrom('job_leases')
        .selectAll()
        .where('tenant_id', '=', input.tenantId)
        .where('project_id', '=', input.projectId)
        .where('state', '=', 'active')
        .where('expires_at', '<=', input.now)
        .orderBy('expires_at', 'asc')
        .limit(input.limit)
        .forUpdate()
        .skipLocked()
        .execute();
      const expired: ExpiredLeaseResult[] = [];

      for (const lease of leases) {
        const attempt = await transaction
          .selectFrom('job_attempts')
          .selectAll()
          .where('tenant_id', '=', lease.tenant_id)
          .where('project_id', '=', lease.project_id)
          .where('job_id', '=', lease.job_id)
          .where('id', '=', lease.attempt_id)
          .where('state', '=', 'running')
          .forUpdate()
          .executeTakeFirst();
        const job = await transaction
          .selectFrom('jobs')
          .selectAll()
          .where('tenant_id', '=', lease.tenant_id)
          .where('project_id', '=', lease.project_id)
          .where('id', '=', lease.job_id)
          .where('state', '=', 'running')
          .forUpdate()
          .executeTakeFirst();

        if (attempt === undefined || job === undefined) {
          continue;
        }

        const updatedLease = await transaction
          .updateTable('job_leases')
          .set({
            state: 'expired',
            expired_at: input.now,
            updated_at: input.now,
          })
          .where('tenant_id', '=', lease.tenant_id)
          .where('project_id', '=', lease.project_id)
          .where('id', '=', lease.id)
          .where('state', '=', 'active')
          .returningAll()
          .executeTakeFirst();
        const updatedAttempt = await transaction
          .updateTable('job_attempts')
          .set({
            state: 'expired',
            finished_at: input.now,
            updated_at: input.now,
          })
          .where('tenant_id', '=', attempt.tenant_id)
          .where('project_id', '=', attempt.project_id)
          .where('id', '=', attempt.id)
          .where('state', '=', 'running')
          .returningAll()
          .executeTakeFirst();
        const exhaustedAttempts = job.attempt_count >= job.max_attempts;
        const updatedJob = await transaction
          .updateTable('jobs')
          .set({
            state: exhaustedAttempts ? 'dead_lettered' : 'retrying',
            ready_at: input.now,
            updated_at: input.now,
            finished_at: exhaustedAttempts ? input.now : null,
          })
          .where('tenant_id', '=', job.tenant_id)
          .where('project_id', '=', job.project_id)
          .where('id', '=', job.id)
          .where('state', '=', 'running')
          .returningAll()
          .executeTakeFirst();

        if (
          updatedLease === undefined ||
          updatedAttempt === undefined ||
          updatedJob === undefined
        ) {
          continue;
        }

        expired.push({
          job: toJobRecord(updatedJob),
          attempt: toJobAttemptRecord(updatedAttempt),
          lease: toJobLeaseRecord(updatedLease),
        });
      }

      return expired;
    });
  }
}

export function getRuntimeEventTopic(): string {
  return runtimeEventTopic;
}

function getAgentIdForClaim(authContext: AuthContext): string {
  if (authContext.principal.type !== 'agent_token') {
    throw new AgentClaimRequiredError();
  }

  return authContext.principal.id;
}

function calculateLeaseExpiresAt(
  request: ClaimJobRequest | HeartbeatLeaseRequest,
  timestamp: Date,
): Date {
  const leaseTtlSeconds = request.leaseTtlSeconds ?? defaultLeaseTtlSeconds;

  if (
    !Number.isInteger(leaseTtlSeconds) ||
    leaseTtlSeconds <= 0 ||
    leaseTtlSeconds > maxLeaseTtlSeconds
  ) {
    throw new Error('leaseTtlSeconds must be a positive integer no greater than 86400.');
  }

  return new Date(timestamp.getTime() + leaseTtlSeconds * 1000);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return defaultExpiredLeaseLimit;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('limit must be a positive integer.');
  }

  return limit;
}

function isReady(job: JobRecord, now: Date): boolean {
  return (
    (job.state === 'queued' || job.state === 'retrying') &&
    job.attemptCount < job.maxAttempts &&
    Date.parse(job.readyAt) <= now.getTime()
  );
}

function compareClaimableJobs(left: JobRecord, right: JobRecord): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  const readyAtDelta = Date.parse(left.readyAt) - Date.parse(right.readyAt);

  if (readyAtDelta !== 0) {
    return readyAtDelta;
  }

  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

function compareLeasesByAcquisition(left: JobLeaseRecord, right: JobLeaseRecord): number {
  const acquiredAtDelta = Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt);

  if (acquiredAtDelta !== 0) {
    return acquiredAtDelta;
  }

  return left.id.localeCompare(right.id);
}

function isCompleteDuplicate(records: ClaimedJobRecord): boolean {
  return (
    records.job.state === 'completed' &&
    records.attempt.state === 'completed' &&
    records.lease.state === 'released'
  );
}

function canFinishRunningAttempt(records: ClaimedJobRecord, now: Date): boolean {
  return (
    records.job.state === 'running' &&
    records.attempt.state === 'running' &&
    records.lease.state === 'active' &&
    Date.parse(records.lease.expiresAt) > now.getTime()
  );
}

function isFailDuplicate(records: ClaimedJobRecord): boolean {
  return (
    records.attempt.state === 'failed' &&
    records.lease.state === 'released' &&
    (records.job.state === 'retrying' ||
      records.job.state === 'failed' ||
      records.job.state === 'dead_lettered') &&
    records.job.attemptCount === records.attempt.attemptNumber
  );
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

function toJobAttemptRecord(row: Selectable<HelixDatabase['job_attempts']>): JobAttemptRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    jobId: row.job_id,
    attemptNumber: row.attempt_number,
    state: row.state,
    agentId: row.agent_id,
    startedAt: toIsoString(row.started_at),
    finishedAt: row.finished_at === null ? null : toIsoString(row.finished_at),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
  };
}

function toJobLeaseRecord(row: Selectable<HelixDatabase['job_leases']>): JobLeaseRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    jobId: row.job_id,
    attemptId: row.attempt_id,
    agentId: row.agent_id,
    state: row.state,
    acquiredAt: toIsoString(row.acquired_at),
    expiresAt: toIsoString(row.expires_at),
    lastHeartbeatAt: toIsoString(row.last_heartbeat_at),
    releasedAt: row.released_at === null ? null : toIsoString(row.released_at),
    expiredAt: row.expired_at === null ? null : toIsoString(row.expired_at),
    canceledAt: row.canceled_at === null ? null : toIsoString(row.canceled_at),
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

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIsoString(value: Date | string): string {
  return toDate(value).toISOString();
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty.`);
  }
}
