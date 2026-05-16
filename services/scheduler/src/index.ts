import type { ScheduleRecord, ScheduleTarget, TenantProjectScope } from '@helix/contracts';

export const workspaceName = '@helix/scheduler';

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
}

export interface ScheduleEvaluationResult {
  readonly evaluated: number;
  readonly enqueued: number;
  readonly skipped: number;
}

export interface ScheduleEvaluationStore {
  listEnabledSchedulesDueBefore(now: Date): Promise<ScheduleRecord[]>;
  enqueueScheduledWorkOnce(work: ScheduledWork): Promise<'enqueued' | 'duplicate'>;
  emitScheduleEvent(event: ScheduleEvent): Promise<void>;
}

export interface ScheduleEvaluatorOptions {
  readonly store: ScheduleEvaluationStore;
  readonly now?: () => Date;
}

export class ScheduleEvaluator {
  private readonly store: ScheduleEvaluationStore;
  private readonly now: () => Date;

  constructor(options: ScheduleEvaluatorOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  async evaluateDueSchedules(): Promise<ScheduleEvaluationResult> {
    const currentTime = this.now();
    const schedules = await this.store.listEnabledSchedulesDueBefore(currentTime);
    let enqueued = 0;
    let skipped = 0;

    for (const schedule of schedules) {
      const fireTime = getDueFireTime(schedule, currentTime);

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
        await this.store.emitScheduleEvent({ ...work, type: 'schedule.fire.enqueued', emittedAt: currentTime.toISOString() });
      } else {
        skipped += 1;
        await this.store.emitScheduleEvent({
          ...work,
          type: 'schedule.fire.skipped_duplicate',
          emittedAt: currentTime.toISOString(),
        });
      }
    }

    return { evaluated: schedules.length, enqueued, skipped };
  }
}

export class InMemoryScheduleEvaluationStore implements ScheduleEvaluationStore {
  readonly schedules: ScheduleRecord[];
  readonly enqueuedWork: ScheduledWork[] = [];
  readonly events: ScheduleEvent[] = [];
  private readonly idempotencyKeys = new Set<string>();

  constructor(schedules: readonly ScheduleRecord[] = []) {
    this.schedules = schedules.map((schedule) => cloneJson(schedule));
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
