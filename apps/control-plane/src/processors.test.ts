import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@helix/contracts';
import { processorRegistryListResponseSchema, processorRegistryResponseSchema } from '@helix/contracts';

import {
  InMemoryProcessorRegistryRepository,
  ProcessorRegistryService,
} from './features/processors/processor-registry.js';
import { AuthorizationError } from './features/iam/authorization.js';
import type { SecurityAuditEvent, SecurityAuditSink } from './features/iam/security-audit.js';
import { createApp, type ApiAuthProvider } from './server/app.js';

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

class RecordingAuditSink implements SecurityAuditSink {
  readonly events: SecurityAuditEvent[] = [];

  async record(event: SecurityAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function createFixedApiAuthProvider(authContext: AuthContext | null): ApiAuthProvider {
  return {
    async authenticate(request) {
      if (request.headers.get('authorization') !== 'Bearer valid-agent-token') {
        return null;
      }

      return authContext;
    },
  };
}

function createService(options: { readonly auditSink?: SecurityAuditSink } = {}) {
  return new ProcessorRegistryService({
    ...(options.auditSink === undefined ? {} : { auditSink: options.auditSink }),
    repository: new InMemoryProcessorRegistryRepository(),
    generateId: () => '01890f42-98c4-7cc3-aa5e-0c567f1d3d10',
    now: () => new Date('2026-05-15T14:00:00.000Z'),
  });
}

function createProcessorsApp(authContext: AuthContext | null = agentAuth) {
  const auditSink = new RecordingAuditSink();
  const service = createService({ auditSink });
  const app = createApp({
    apiAuthProvider: createFixedApiAuthProvider(authContext),
    processorRegistryService: service,
  });

  return { app, auditSink, service };
}

const registrationBody = {
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
};

describe('processor registry API', () => {
  it('registers the authenticated agent through the public API and audits the write', async () => {
    const { app, auditSink } = createProcessorsApp();

    const response = await app.request('/api/v1/processors/register', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-agent-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(registrationBody),
    });

    expect(response.status).toBe(201);
    const body = processorRegistryResponseSchema.parse(await response.json());

    expect(body.processor).toMatchObject({
      tenantId,
      projectId,
      agentId,
      capabilities: [{ name: 'thumbnail', version: '1.2.0' }],
      region: 'us-east-1',
    });
    expect(auditSink.events).toMatchObject([
      {
        action: 'processor.registered',
        resourceType: 'processor',
        resourceId: body.processor.id,
      },
    ]);
  });

  it('rejects malicious scope fields and non-agent principals for registration', async () => {
    const { app } = createProcessorsApp();
    const projectKeyApp = createProcessorsApp({
      ...agentAuth,
      principal: { type: 'api_key', id: 'project-api-key-1' },
    }).app;

    const maliciousScope = await app.request('/api/v1/processors/register', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-agent-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...registrationBody, tenantId, projectId: otherProjectId }),
    });
    const projectKeyRegistration = await projectKeyApp.request('/api/v1/processors/register', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-agent-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(registrationBody),
    });

    expect(maliciousScope.status).toBe(400);
    expect(await maliciousScope.json()).toEqual({ error: 'invalid_processor_registration_request' });
    expect(projectKeyRegistration.status).toBe(403);
    expect(await projectKeyRegistration.json()).toEqual({ error: 'agent_token_required' });
  });

  it('updates processor capabilities through the public API and audits the change', async () => {
    const { app, auditSink } = createProcessorsApp();
    const registered = await app.request('/api/v1/processors/register', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-agent-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(registrationBody),
    });
    const registeredBody = processorRegistryResponseSchema.parse(await registered.json());

    const updated = await app.request(
      `/api/v1/processors/${registeredBody.processor.id}/capabilities`,
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer valid-agent-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          capabilities: [{ name: 'video-transcode', version: '2.0.0' }],
          routingExplanation: {
            eligible: true,
            reasons: ['capability video-transcode@2.0.0 matched'],
            matchedCapabilities: ['video-transcode'],
            rejectedConstraints: [],
            metadata: { score: 88 },
          },
        }),
      },
    );

    expect(updated.status).toBe(200);
    const updatedBody = processorRegistryResponseSchema.parse(await updated.json());
    const list = await app.request('/api/v1/processors', {
      headers: { authorization: 'Bearer valid-agent-token' },
    });
    const listBody = processorRegistryListResponseSchema.parse(await list.json());

    expect(updatedBody.processor.capabilities).toEqual([
      { name: 'video-transcode', version: '2.0.0' },
    ]);
    expect(listBody.processors).toHaveLength(1);
    expect(listBody.processors[0]?.capabilities).toEqual(updatedBody.processor.capabilities);
    expect(auditSink.events.map((event) => event.action)).toEqual([
      'processor.registered',
      'processor.capabilities_updated',
    ]);
  });
});

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
