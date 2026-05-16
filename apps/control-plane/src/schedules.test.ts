import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import { scheduleListResponseSchema, scheduleResponseSchema } from '@helix/contracts';

import { createApp, type ApiAuthProvider } from './server/app.js';
import type { SecurityAuditEvent, SecurityAuditSink } from './features/iam/security-audit.js';
import { InMemoryScheduleRepository, ScheduleService } from './features/schedules/schedule-service.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const workflowId = '01890f42-98c4-7cc3-aa5e-0c567f1d4a01';
const workflowVersionId = '01890f42-98c4-7cc3-aa5e-0c567f1d4a02';

const scheduleAuth: AuthContext = {
  tenantId,
  projectId,
  principal: { type: 'api_key', id: 'project-api-key-1' },
  permissions: ['schedules:create', 'schedules:read', 'schedules:update', 'schedules:delete'],
};

function createFixedApiAuthProvider(authContext: AuthContext | null): ApiAuthProvider {
  return {
    async authenticate(request) {
      if (request.headers.get('authorization') !== 'Bearer valid-project-token') {
        return null;
      }

      return authContext;
    },
  };
}

class RecordingAuditSink implements SecurityAuditSink {
  readonly events: SecurityAuditEvent[] = [];

  async record(event: SecurityAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function createSchedulesApp(authContext: AuthContext | null = scheduleAuth) {
  const repository = new InMemoryScheduleRepository();
  const auditSink = new RecordingAuditSink();
  const service = new ScheduleService({
    auditSink,
    generateId: () => '01890f42-98c4-7cc3-aa5e-0c567f1d4a03',
    now: () => new Date('2026-05-16T10:00:00.000Z'),
    repository,
  });
  const app = createApp({
    apiAuthProvider: createFixedApiAuthProvider(authContext),
    scheduleService: service,
  });

  return { app, auditSink, repository, service };
}

const jsonHeaders = {
  authorization: 'Bearer valid-project-token',
  'content-type': 'application/json',
};

describe('schedule API', () => {
  it('creates, reads, lists, updates, and deletes tenant/project scoped schedules', async () => {
    const { app } = createSchedulesApp();

    const createdResponse = await app.request('/api/v1/schedules', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Nightly thumbnail batch',
        description: 'Runs once per night',
        target: {
          type: 'job',
          request: { priority: 5, metadata: { source: 'schedule' } },
        },
        mode: { type: 'cron', expression: '0 2 * * *', timezone: 'UTC' },
        misfirePolicy: 'fire_once',
        fireIdempotencyKeyPrefix: 'schedule:nightly-thumbnail',
        metadata: { owner: 'ops' },
      }),
    });
    const created = scheduleResponseSchema.parse(await createdResponse.json());

    const getResponse = await app.request(`/api/v1/schedules/${created.schedule.id}`, {
      headers: jsonHeaders,
    });
    const listedResponse = await app.request('/api/v1/schedules', { headers: jsonHeaders });
    const updatedResponse = await app.request(`/api/v1/schedules/${created.schedule.id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ state: 'disabled' }),
    });
    const deletedResponse = await app.request(`/api/v1/schedules/${created.schedule.id}`, {
      method: 'DELETE',
      headers: jsonHeaders,
    });

    expect(createdResponse.status).toBe(201);
    expect(getResponse.status).toBe(200);
    expect(scheduleResponseSchema.parse(await getResponse.json()).schedule).toMatchObject({
      tenantId,
      projectId,
      state: 'enabled',
      fireIdempotencyKeyPrefix: 'schedule:nightly-thumbnail',
    });
    expect(scheduleListResponseSchema.parse(await listedResponse.json()).schedules).toHaveLength(1);
    expect(scheduleResponseSchema.parse(await updatedResponse.json()).schedule.state).toBe('disabled');
    expect(deletedResponse.status).toBe(204);
  });

  it('audits security-sensitive schedule mutations with retention metadata', async () => {
    const { app, auditSink } = createSchedulesApp();

    const createdResponse = await app.request('/api/v1/schedules', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Retention aware batch',
        target: {
          type: 'job',
          request: { priority: 5, metadata: { source: 'schedule' } },
        },
        mode: { type: 'delayed', runAt: '2026-05-16T10:05:00.000Z' },
        fireIdempotencyKeyPrefix: 'schedule:retention-aware-batch',
        metadata: { retentionPolicyId: 'schedule-events-30d' },
      }),
    });
    const created = scheduleResponseSchema.parse(await createdResponse.json());

    await app.request(`/api/v1/schedules/${created.schedule.id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ state: 'disabled' }),
    });
    await app.request(`/api/v1/schedules/${created.schedule.id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ state: 'enabled' }),
    });
    await app.request(`/api/v1/schedules/${created.schedule.id}`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Renamed batch' }),
    });
    await app.request(`/api/v1/schedules/${created.schedule.id}`, {
      method: 'DELETE',
      headers: jsonHeaders,
    });

    expect(auditSink.events.map((event) => event.action)).toEqual([
      'schedule.created',
      'schedule.disabled',
      'schedule.enabled',
      'schedule.updated',
      'schedule.deleted',
    ]);
    expect(auditSink.events[0]).toMatchObject({
      tenantId,
      projectId,
      actor: scheduleAuth.principal,
      resourceType: 'schedule',
      resourceId: created.schedule.id,
      metadata: {
        retentionPolicyId: 'schedule-events-30d',
        scheduleName: 'Retention aware batch',
      },
    });
  });

  it('rejects invalid schedule definitions at the public API boundary', async () => {
    const { app } = createSchedulesApp();

    const invalidResponse = await app.request('/api/v1/schedules', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        name: 'Invalid schedule',
        target: { type: 'workflow', workflowId, request: { workflowVersionId } },
        mode: { type: 'interval', everySeconds: 0 },
        fireIdempotencyKeyPrefix: 'schedule:invalid',
      }),
    });

    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({ error: 'invalid_schedule_request' });
  });
});
