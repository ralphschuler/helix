import type { ScheduleRecord, ScheduleTarget, TenantProjectScope } from '@helix/contracts';

export const workspaceName = '@helix/scheduler';
export const defaultClockSkewToleranceMs = 0;
export const defaultSchedulerLeaseTtlMs = 30_000;

export interface ScheduledWork extends TenantProjectScope {
  readonly scheduleId: string;
  readonly fireTime: string;
  readonly idempotencyKey: string;
  readonly target: ScheduleTarget;
}

export interface ScheduleEvent extends TenantProjectScope {
  readonly scheduleId: string;
  readonly fireTime: string;
  readonly idempotencyKey: string;
  readonly type: 'schedule.fire.enqueued' | 'schedule.fire.skipped_duplicate';
  readonly emittedAt: string;
  readonly retentionPolicyId: string | null;
  readonly scheduleName: string;
}

export interface SchedulerLeaseEvent {
  readonly type: 'scheduler.lease.acquired' | 'scheduler.lease.released' | 'scheduler.lease.busy';
  readonly instanceId: string;
  readonly leaseId: string;
  readonly observedAt: string;
}

export interface SchedulerEvaluationLease {
  readonly id: string;
  readonly instanceId: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface ScheduleEvaluationResult {
  readonly evaluated: number;
  readonly enqueued: number;
  readonly skipped: number;
}

export interface ScheduleEvaluationStore {
  acquireEvaluationLease(input: AcquireEvaluationLeaseInput): Promise<SchedulerEvaluationLease | null>;
  releaseEvaluationLease(lease: SchedulerEvaluationLease, releasedAt: Date): Promise<void>;
  listEnabledSchedulesDueBefore(now: Date): Promise<ScheduleRecord[]>;
  enqueueScheduledWorkOnce(work: ScheduledWork): Promise<'enqueued' | 'duplicate'>;
  emitScheduleEvent(event: ScheduleEvent): Promise<void>;
}

export interface AcquireEvaluationLeaseInput {
  readonly instanceId: string;
  readonly now: Date;
  readonly ttlMs: number;
}

export interface ScheduleEvaluatorOptions {
  readonly store: ScheduleEvaluationStore;
  readonly now?: () => Date;
  readonly instanceId?: string;
  readonly clockSkewToleranceMs?: number;
  readonly leaseTtlMs?: number;
}

export class ScheduleEvaluator {
  private readonly store: ScheduleEvaluationStore;
  private readonly now: () => Date;
  private readonly instanceId: string;
  private readonly clockSkewToleranceMs: number;
  private readonly leaseTtlMs: number;

  constructor(options: ScheduleEvaluatorOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.instanceId = options.instanceId ?? 'scheduler';
    this.clockSkewToleranceMs = options.clockSkewToleranceMs ?? defaultClockSkewToleranceMs;
    this.leaseTtlMs = options.leaseTtlMs ?? defaultSchedulerLeaseTtlMs;
  }

  async evaluateDueSchedules(): Promise<ScheduleEvaluationResult> {
    const currentTime = this.now();
    const lease = await this.store.acquireEvaluationLease({ instanceId: this.instanceId, now: currentTime, ttlMs: this.leaseTtlMs });

    if (lease === null) {
      return { evaluated: 0, enqueued: 0, skipped: 0 };
    }

    try {
      const dueCutoff = new Date(currentTime.getTime() + this.clockSkewToleranceMs);
      const schedules = await this.store.listEnabledSchedulesDueBefore(dueCutoff);
      let enqueued = 0;
      let skipped = 0;

      for (const schedule of schedules) {
        const fireTime = getDueFireTime(schedule, dueCutoff);

        if (fireTime === null) {
          continue;
        }

        const idempotencyKey = `${schedule.fireIdempotencyKeyPrefix}:${fireTime}`;
        const work: ScheduledWork = {
          tenantId: schedule.tenantId,
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          fireTime,
          idempotencyKey,
          target: cloneJson(schedule.target),
        };
        const result = await this.store.enqueueScheduledWorkOnce(work);

        if (result === 'enqueued') {
          enqueued += 1;
          await this.store.emitScheduleEvent({
            ...work,
            type: 'schedule.fire.enqueued',
            emittedAt: currentTime.toISOString(),
            retentionPolicyId: getRetentionPolicyId(schedule),
            scheduleName: schedule.name,
          });
        } else {
          skipped += 1;
          await this.store.emitScheduleEvent({
            ...work,
            type: 'schedule.fire.skipped_duplicate',
            emittedAt: currentTime.toISOString(),
            retentionPolicyId: getRetentionPolicyId(schedule),
            scheduleName: schedule.name,
          });
        }
      }

      return { evaluated: schedules.length, enqueued, skipped };
    } finally {
      await this.store.releaseEvaluationLease(lease, this.now());
    }
  }
}

export class InMemoryScheduleEvaluationStore implements ScheduleEvaluationStore {
  readonly schedules: ScheduleRecord[];
  readonly enqueuedWork: ScheduledWork[] = [];
  readonly events: ScheduleEvent[] = [];
  readonly leaseEvents: SchedulerLeaseEvent[] = [];
  private readonly idempotencyKeys = new Set<string>();
  private activeLease: SchedulerEvaluationLease | null = null;

  constructor(schedules: readonly ScheduleRecord[] = []) {
    this.schedules = schedules.map((schedule) => cloneJson(schedule));
  }

  async acquireEvaluationLease(input: AcquireEvaluationLeaseInput): Promise<SchedulerEvaluationLease | null> {
    if (this.activeLease !== null && Date.parse(this.activeLease.expiresAt) > input.now.getTime()) {
      this.leaseEvents.push({
        type: 'scheduler.lease.busy',
        instanceId: input.instanceId,
        leaseId: this.activeLease.id,
        observedAt: input.now.toISOString(),
      });
      return null;
    }

    const lease: SchedulerEvaluationLease = {
      id: `${input.instanceId}:${input.now.toISOString()}`,
      instanceId: input.instanceId,
      acquiredAt: input.now.toISOString(),
      expiresAt: new Date(input.now.getTime() + input.ttlMs).toISOString(),
    };
    this.activeLease = lease;
    this.leaseEvents.push({
      type: 'scheduler.lease.acquired',
      instanceId: input.instanceId,
      leaseId: lease.id,
      observedAt: input.now.toISOString(),
    });
    return cloneJson(lease);
  }

  async releaseEvaluationLease(lease: SchedulerEvaluationLease, releasedAt: Date): Promise<void> {
    if (this.activeLease?.id === lease.id) {
      this.activeLease = null;
    }

    this.leaseEvents.push({
      type: 'scheduler.lease.released',
      instanceId: lease.instanceId,
      leaseId: lease.id,
      observedAt: releasedAt.toISOString(),
    });
  }

  async listEnabledSchedulesDueBefore(now: Date): Promise<ScheduleRecord[]> {
    return this.schedules
      .filter((schedule) => schedule.state === 'enabled' && getDueFireTime(schedule, now) !== null)
      .map((schedule) => cloneJson(schedule));
  }

  async enqueueScheduledWorkOnce(work: ScheduledWork): Promise<'enqueued' | 'duplicate'> {
    if (this.idempotencyKeys.has(work.idempotencyKey)) {
      return 'duplicate';
    }

    this.idempotencyKeys.add(work.idempotencyKey);
    this.enqueuedWork.push(cloneJson(work));
    return 'enqueued';
  }

  async emitScheduleEvent(event: ScheduleEvent): Promise<void> {
    this.events.push(cloneJson(event));
  }
}

function getRetentionPolicyId(schedule: ScheduleRecord): string | null {
  const retentionPolicyId = schedule.metadata.retentionPolicyId;
  return typeof retentionPolicyId === 'string' ? retentionPolicyId : null;
}

function getDueFireTime(schedule: ScheduleRecord, now: Date): string | null {
  if (schedule.state !== 'enabled') {
    return null;
  }

  if (schedule.mode.type === 'delayed') {
    return Date.parse(schedule.mode.runAt) <= now.getTime() ? schedule.mode.runAt : null;
  }

  return null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
