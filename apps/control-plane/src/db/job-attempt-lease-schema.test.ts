import type { Insertable, Selectable } from 'kysely';
import { describe, expect, it } from 'vitest';

import type { HelixDatabase, JsonObject } from './schema.ts';

describe('job attempt lease Kysely schema', () => {
  it('models scoped job, attempt, and lease rows for audit-safe broker state', () => {
    const scope = {
      tenant_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a01',
      project_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a02',
    };
    const constraints: JsonObject = { capability: 'thumbnail' };
    const metadata: JsonObject = { requestedBy: 'producer-sdk' };
    const jobInsert: Insertable<HelixDatabase['jobs']> = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3b01',
      ...scope,
      ready_at: '2026-05-12T19:00:00.000Z',
      idempotency_key: 'create-job:client-request-1',
      constraints_json: constraints,
      metadata_json: metadata,
    };
    const attemptRow: Selectable<HelixDatabase['job_attempts']> = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3b02',
      ...scope,
      job_id: jobInsert.id,
      attempt_number: 1,
      state: 'running',
      agent_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3b03',
      started_at: new Date('2026-05-12T19:01:00.000Z'),
      finished_at: null,
      failure_code: null,
      failure_message: null,
      created_at: new Date('2026-05-12T19:01:00.000Z'),
      updated_at: new Date('2026-05-12T19:01:00.000Z'),
    };
    const leaseRow: Selectable<HelixDatabase['job_leases']> = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3b04',
      ...scope,
      job_id: jobInsert.id,
      attempt_id: attemptRow.id,
      agent_id: attemptRow.agent_id ?? '01890f42-98c4-7cc3-aa5e-0c567f1d3b03',
      state: 'active',
      acquired_at: new Date('2026-05-12T19:01:00.000Z'),
      expires_at: new Date('2026-05-12T19:06:00.000Z'),
      last_heartbeat_at: new Date('2026-05-12T19:02:00.000Z'),
      released_at: null,
      expired_at: null,
      canceled_at: null,
      created_at: new Date('2026-05-12T19:01:00.000Z'),
      updated_at: new Date('2026-05-12T19:02:00.000Z'),
    };

    expect(jobInsert.tenant_id).toBe(scope.tenant_id);
    expect(attemptRow.project_id).toBe(jobInsert.project_id);
    expect(leaseRow.attempt_id).toBe(attemptRow.id);
  });
});
