import type { Insertable, Selectable } from 'kysely';
import { describe, expect, it } from 'vitest';

import type { HelixDatabase, JsonObject } from './schema.ts';

describe('runtime persistence Kysely schema', () => {
  it('models scoped event, outbox, and inbox persistence rows', () => {
    const payload: JsonObject = { runId: '01890f42-98c4-7cc3-ba5e-0c567f1d3a80' };
    const eventInsert: Insertable<HelixDatabase['runtime_events']> = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a79',
      tenant_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a01',
      project_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a02',
      event_type: 'workflow.run.started',
      event_version: 1,
      ordering_key: 'project:01890f42-98c4-7cc3-aa5e-0c567f1d3a02',
      payload_json: payload,
    };
    const outboxInsert: Insertable<HelixDatabase['runtime_outbox']> = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a81',
      tenant_id: eventInsert.tenant_id,
      project_id: eventInsert.project_id,
      event_id: eventInsert.id,
      topic: 'helix.runtime.events',
      partition_key: eventInsert.ordering_key,
    };
    const inboxRow: Selectable<HelixDatabase['runtime_inbox']> = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a82',
      tenant_id: eventInsert.tenant_id,
      project_id: eventInsert.project_id,
      consumer_name: 'broker-projection',
      event_id: eventInsert.id,
      status: 'processing',
      processing_started_at: new Date('2026-05-12T18:00:00.000Z'),
      processed_at: null,
      attempt_count: 1,
      last_error: null,
      updated_at: new Date('2026-05-12T18:00:00.000Z'),
    };

    expect(outboxInsert.tenant_id).toBe(eventInsert.tenant_id);
    expect(outboxInsert.project_id).toBe(eventInsert.project_id);
    expect(inboxRow.event_id).toBe(eventInsert.id);
  });
});
