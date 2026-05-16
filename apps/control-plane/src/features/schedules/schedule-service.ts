import type {
  AuthContext,
  CreateScheduleRequest,
  ScheduleRecord,
  TenantProjectScope,
  UpdateScheduleRequest,
} from '@helix/contracts';

import { assertProjectPermission } from '../iam/authorization.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';

export interface CreateScheduleInput extends TenantProjectScope {
  readonly request: CreateScheduleRequest;
}

export interface GetScheduleInput extends TenantProjectScope {
  readonly scheduleId: string;
}

export interface UpdateScheduleInput extends GetScheduleInput {
  readonly request: UpdateScheduleRequest;
}

export type DeleteScheduleInput = GetScheduleInput;

export interface ScheduleRepositoryCreateInput {
  readonly schedule: ScheduleRecord;
}

export interface ScheduleRepositoryUpdateInput extends GetScheduleInput {
  readonly patch: UpdateScheduleRequest;
  readonly updatedAt: string;
}

export interface ScheduleRepository {
  createSchedule(input: ScheduleRepositoryCreateInput): Promise<ScheduleRecord>;
  findSchedule(input: GetScheduleInput): Promise<ScheduleRecord | null>;
  listSchedules(input: TenantProjectScope): Promise<ScheduleRecord[]>;
  updateSchedule(input: ScheduleRepositoryUpdateInput): Promise<ScheduleRecord | null>;
  deleteSchedule(input: DeleteScheduleInput): Promise<boolean>;
}

export interface ScheduleServiceOptions {
  readonly repository: ScheduleRepository;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class ScheduleService {
  private readonly repository: ScheduleRepository;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: ScheduleServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
  }

  async createSchedule(authContext: AuthContext, input: CreateScheduleInput): Promise<ScheduleRecord> {
    assertProjectPermission(authContext, input, 'schedules:create');

    const timestamp = this.now().toISOString();
    const schedule: ScheduleRecord = {
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      name: input.request.name,
      description: input.request.description ?? null,
      state: input.request.state ?? 'enabled',
      target: cloneJson(input.request.target),
      mode: cloneJson(input.request.mode),
      misfirePolicy: input.request.misfirePolicy ?? 'skip',
      fireIdempotencyKeyPrefix: input.request.fireIdempotencyKeyPrefix,
      metadata: cloneJson(input.request.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.repository.createSchedule({ schedule });
  }

  async getSchedule(authContext: AuthContext, input: GetScheduleInput): Promise<ScheduleRecord | null> {
    assertProjectPermission(authContext, input, 'schedules:read');

    return this.repository.findSchedule(input);
  }

  async listSchedules(authContext: AuthContext, input: TenantProjectScope): Promise<ScheduleRecord[]> {
    assertProjectPermission(authContext, input, 'schedules:read');

    return this.repository.listSchedules(input);
  }

  async updateSchedule(authContext: AuthContext, input: UpdateScheduleInput): Promise<ScheduleRecord | null> {
    assertProjectPermission(authContext, input, 'schedules:update');

    return this.repository.updateSchedule({
      tenantId: input.tenantId,
      projectId: input.projectId,
      scheduleId: input.scheduleId,
      patch: input.request,
      updatedAt: this.now().toISOString(),
    });
  }

  async deleteSchedule(authContext: AuthContext, input: DeleteScheduleInput): Promise<boolean> {
    assertProjectPermission(authContext, input, 'schedules:delete');

    return this.repository.deleteSchedule(input);
  }
}

export class InMemoryScheduleRepository implements ScheduleRepository {
  readonly schedules: ScheduleRecord[] = [];

  async createSchedule(input: ScheduleRepositoryCreateInput): Promise<ScheduleRecord> {
    const schedule = cloneSchedule(input.schedule);
    this.schedules.push(schedule);
    return cloneSchedule(schedule);
  }

  async findSchedule(input: GetScheduleInput): Promise<ScheduleRecord | null> {
    const schedule = this.schedules.find((candidate) => matchesScope(candidate, input) && candidate.id === input.scheduleId);
    return schedule === undefined ? null : cloneSchedule(schedule);
  }

  async listSchedules(input: TenantProjectScope): Promise<ScheduleRecord[]> {
    return this.schedules
      .filter((schedule) => matchesScope(schedule, input))
      .map((schedule) => cloneSchedule(schedule));
  }

  async updateSchedule(input: ScheduleRepositoryUpdateInput): Promise<ScheduleRecord | null> {
    const index = this.schedules.findIndex((schedule) => matchesScope(schedule, input) && schedule.id === input.scheduleId);

    if (index === -1) {
      return null;
    }

    const current = this.schedules[index];

    if (current === undefined) {
      return null;
    }

    const updated: ScheduleRecord = {
      ...current,
      name: input.patch.name ?? current.name,
      description: input.patch.description !== undefined ? input.patch.description : current.description,
      state: input.patch.state ?? current.state,
      target: input.patch.target !== undefined ? cloneJson(input.patch.target) : current.target,
      mode: input.patch.mode !== undefined ? cloneJson(input.patch.mode) : current.mode,
      misfirePolicy: input.patch.misfirePolicy ?? current.misfirePolicy,
      fireIdempotencyKeyPrefix: input.patch.fireIdempotencyKeyPrefix ?? current.fireIdempotencyKeyPrefix,
      metadata: input.patch.metadata !== undefined ? cloneJson(input.patch.metadata) : current.metadata,
      updatedAt: input.updatedAt,
    };
    this.schedules[index] = updated;
    return cloneSchedule(updated);
  }

  async deleteSchedule(input: DeleteScheduleInput): Promise<boolean> {
    const index = this.schedules.findIndex((schedule) => matchesScope(schedule, input) && schedule.id === input.scheduleId);

    if (index === -1) {
      return false;
    }

    this.schedules.splice(index, 1);
    return true;
  }
}

function matchesScope(schedule: TenantProjectScope, scope: TenantProjectScope): boolean {
  return schedule.tenantId === scope.tenantId && schedule.projectId === scope.projectId;
}

function cloneSchedule(schedule: ScheduleRecord): ScheduleRecord {
  return cloneJson(schedule);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
