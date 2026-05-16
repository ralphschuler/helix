import type { Insertable, Selectable } from 'kysely';
import { describe, expect, it } from 'vitest';

import type { HelixDatabase, JsonObject } from './schema.ts';

describe('processor registry Kysely schema', () => {
  it('models project-scoped processor registrations with routing explanation data', () => {
    const scope = {
      tenant_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a01',
      project_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3a02',
    };
    const capabilities: JsonObject = {
      items: [{ name: 'thumbnail', version: '1.2.0' }],
    };
    const hardware: JsonObject = {
      gpu: true,
      gpuModel: 'nvidia-l4',
      gpuCount: 1,
      memoryMb: 24_576,
    };
    const labels: JsonObject = { tier: 'interactive' };
    const routingExplanation: JsonObject = {
      eligible: true,
      reasons: ['capability matched'],
      matchedCapabilities: ['thumbnail'],
      rejectedConstraints: [],
      metadata: { score: 98 },
    };

    const insert: Insertable<HelixDatabase['processor_registrations']> = {
      id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
      ...scope,
      agent_id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
      capabilities_json: capabilities,
      hardware_json: hardware,
      region: 'us-east-1',
      labels_json: labels,
      tags_json: ['gpu', 'image'],
      routing_explanation_json: routingExplanation,
      last_heartbeat_at: new Date('2026-05-15T14:05:00.000Z'),
      health_status: 'healthy',
    };

    const selected: Selectable<HelixDatabase['processor_registrations']> = {
      id: insert.id,
      ...scope,
      agent_id: insert.agent_id,
      capabilities_json: capabilities,
      hardware_json: hardware,
      region: insert.region,
      labels_json: labels,
      tags_json: ['gpu', 'image'],
      routing_explanation_json: routingExplanation,
      last_heartbeat_at: new Date('2026-05-15T14:05:00.000Z'),
      health_status: 'healthy',
      created_at: new Date('2026-05-15T14:00:00.000Z'),
      updated_at: new Date('2026-05-15T14:01:00.000Z'),
    };

    expect(selected.tenant_id).toBe(scope.tenant_id);
    expect(selected.project_id).toBe(scope.project_id);
    expect(selected.agent_id).toBe(insert.agent_id);
    expect(selected.routing_explanation_json).toEqual(routingExplanation);
    expect(selected.health_status).toBe('healthy');
  });
});
