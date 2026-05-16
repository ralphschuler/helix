import { describe, expect, it } from 'vitest';

import {
  InMemoryRuntimeEventStoreProjection,
  decodeRuntimeEventCursor,
  encodeRuntimeEventCursor,
} from './features/runtime/event-store.js';

const scope = {
  tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a77',
  projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a78',
};

function event(sequence: number, occurredAt = `2026-05-15T13:00:0${sequence}.000Z`) {
  return {
    ...scope,
    id: `01890f42-98c4-7cc3-aa5e-0c567f1d3d1${sequence}`,
    eventType: 'workflow.step.completed',
    eventVersion: 1,
    orderingKey: `run:01890f42-98c4-7cc3-aa5e-0c567f1d3d20`,
    payload: { sequence },
    occurredAt: new Date(occurredAt),
    recordedAt: new Date(`2026-05-15T13:00:1${sequence}.000Z`),
  };
}

describe('runtime event store projection', () => {
  it('projects durable runtime events into tenant/project scoped rows with opaque cursors', async () => {
    const projection = new InMemoryRuntimeEventStoreProjection({ retainForDays: 30 });

    await projection.project(event(1));
    await projection.project(event(2));
    await projection.project({ ...event(3), projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a79' });

    const firstPage = await projection.list({ ...scope, limit: 1 });
    expect(firstPage.events).toMatchObject([{ sequence: 1, eventId: event(1).id, eventType: 'workflow.step.completed' }]);
    expect(firstPage.events[0]?.cursor).not.toContain(event(1).id);
    expect(firstPage.nextCursor).toBe(firstPage.events[0]?.cursor);

    const secondPage = await projection.list({ ...scope, after: firstPage.nextCursor, limit: 5 });
    expect(secondPage.events.map((row) => row.sequence)).toEqual([2]);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.events[0]).toMatchObject({
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      payload: { sequence: 2 },
      retainedUntil: new Date('2026-06-14T13:00:02.000Z'),
    });
  });

  it('treats duplicate event projection as idempotent and non-authoritative', async () => {
    const projection = new InMemoryRuntimeEventStoreProjection();

    const first = await projection.project(event(1));
    const duplicate = await projection.project({ ...event(1), payload: { mutated: true } });

    expect(duplicate).toEqual(first);
    expect(await projection.list({ ...scope, limit: 10 })).toMatchObject({
      events: [{ payload: { sequence: 1 } }],
    });
  });

  it('rejects malformed opaque cursors at the boundary', () => {
    const cursor = encodeRuntimeEventCursor({ sequence: 12 });

    expect(decodeRuntimeEventCursor(cursor)).toEqual({ sequence: 12 });
    expect(() => decodeRuntimeEventCursor('12')).toThrow('Invalid runtime event cursor.');
  });
});
