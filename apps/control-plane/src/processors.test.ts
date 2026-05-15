import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import { processorRegistryListResponseSchema, processorRegistryResponseSchema } from '@helix/contracts';

import {
  InMemoryProcessorRegistryRepository,
  ProcessorRegistryService,
} from './features/processors/processor-registry.js';
import { AuthorizationError } from './features/iam/authorization.js';

const tenantId = '01890f42-98c4-7cc3-8a5e-0c567f1d3a77';
const projectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a78';
const otherProjectId = '01890f42-98c4-7cc3-9a5e-0c567f1d3a79';
const agentId = '01890f42-98c4-7cc3-aa5e-0c567f1d3d11';

const agentAuth: AuthContext = {
  tenantId,
  projectId,
  principal: {
    type: 'agent_token',
    id: agentId,
  },
  permissions: ['agents:register', 'agents:read'],
};

const readOnlyAuth: AuthContext = {
  ...agentAuth,
  permissions: ['agents:read'],
};

function createService() {
  return new ProcessorRegistryService({
    repository: new InMemoryProcessorRegistryRepository(),
    generateId: () => '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
    now: () => new Date('2026-05-15T14:00:00.000Z'),
  });
}

describe('processor registry service', () => {
  it('registers processor capabilities inside project scope and returns routing explanation data', async () => {
    const service = createService();

    const processor = await service.registerProcessor(agentAuth, {
      tenantId,
      projectId,
      agentId,
      capabilities: [{ name: 'thumbnail', version: '1.2.0' }],
      hardware: {
        gpu: true,
        gpuModel: 'nvidia-l4',
        gpuCount: 1,
        memoryMb: 24_576,
      },
      region: 'us-east-1',
      labels: { tier: 'interactive' },
      tags: ['gpu', 'image'],
      routingExplanation: {
        eligible: true,
        reasons: ['capability thumbnail@1.2.0 matched'],
        matchedCapabilities: ['thumbnail'],
        rejectedConstraints: [],
        metadata: { score: 98 },
      },
    });

    const listed = await service.listProcessors(agentAuth, { tenantId, projectId });

    expect(processorRegistryResponseSchema.parse({ processor })).toEqual({ processor });
    expect(processorRegistryListResponseSchema.parse({ processors: listed })).toEqual({
      processors: [processor],
    });
    expect(processor).toMatchObject({
      tenantId,
      projectId,
      agentId,
      capabilities: [{ name: 'thumbnail', version: '1.2.0' }],
      hardware: { gpu: true, gpuModel: 'nvidia-l4', gpuCount: 1, memoryMb: 24_576 },
      region: 'us-east-1',
      labels: { tier: 'interactive' },
      tags: ['gpu', 'image'],
      routingExplanation: {
        eligible: true,
        matchedCapabilities: ['thumbnail'],
        rejectedConstraints: [],
      },
      createdAt: '2026-05-15T14:00:00.000Z',
      updatedAt: '2026-05-15T14:00:00.000Z',
    });
  });

  it('prevents cross-project registry writes and unauthorized updates', async () => {
    const service = createService();
    const registration = {
      tenantId,
      projectId: otherProjectId,
      agentId,
      capabilities: [{ name: 'thumbnail', version: '1.2.0' }],
      hardware: { gpu: false, memoryMb: 1024 },
      region: 'us-east-1',
      labels: {},
      tags: [],
      routingExplanation: {
        eligible: false,
        reasons: ['project mismatch'],
        matchedCapabilities: [],
        rejectedConstraints: ['project'],
        metadata: {},
      },
    };

    await expect(service.registerProcessor(agentAuth, registration)).rejects.toMatchObject({
      reason: 'wrong_project_scope',
    });
    await expect(service.registerProcessor(readOnlyAuth, { ...registration, projectId })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(service.listProcessors(agentAuth, { tenantId, projectId: otherProjectId })).rejects.toMatchObject({
      reason: 'wrong_project_scope',
    });
  });
});
