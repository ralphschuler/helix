import { describe, expect, it } from 'vitest';

import { InMemoryWorkflowRepository } from './features/workflows/workflow-service.js';

const scope = {
  tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a77',
  projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a78',
};

const checkpoint = {
  ...scope,
  id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d30',
  workflowId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
  workflowVersionId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d11',
  runId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d12',
  stepId: 'render',
  sequence: 1,
  payloadRef: 'artifact://tenant/project/checkpoints/render-1.json',
  stateDigest: 'sha256:render-state-v1',
  metadata: { retentionClass: 'standard' },
  retainedUntil: '2026-06-15T13:00:00.000Z',
  createdAt: '2026-05-15T13:00:00.000Z',
};

describe('workflow checkpoints', () => {
  it('persists immutable tenant/project scoped checkpoint references for replay audit', async () => {
    const repository = new InMemoryWorkflowRepository();

    const created = await repository.createCheckpoint({ checkpoint });
    await repository.createCheckpoint({
      checkpoint: {
        ...checkpoint,
        id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d31',
        sequence: 2,
        stepId: 'notify',
        payloadRef: 'artifact://tenant/project/checkpoints/notify-2.json',
      },
    });

    expect(created).toEqual(checkpoint);
    expect(await repository.listCheckpoints({ ...scope, runId: checkpoint.runId })).toEqual([
      checkpoint,
      { ...checkpoint, id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d31', sequence: 2, stepId: 'notify', payloadRef: 'artifact://tenant/project/checkpoints/notify-2.json' },
    ]);
    expect(await repository.listCheckpoints({ ...scope, projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a79', runId: checkpoint.runId })).toEqual([]);
  });

  it('returns cloned checkpoint metadata so callers cannot mutate stored audit state', async () => {
    const repository = new InMemoryWorkflowRepository();

    const created = await repository.createCheckpoint({ checkpoint });
    created.metadata.retentionClass = 'mutated';

    expect(await repository.listCheckpoints({ ...scope, runId: checkpoint.runId })).toEqual([checkpoint]);
  });
});
