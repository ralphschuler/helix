import { describe, expect, it } from 'vitest';
import type { JobRecord, ProcessorRegistryRecord } from '@helix/contracts';

import { evaluateCapabilityRoute } from './routing-policy.js';

const baseJob: JobRecord = {
  id: '01890f42-98c4-7cc3-aa5e-0c567f1d3c01',
  tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a77',
  projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a78',
  state: 'queued',
  priority: 0,
  maxAttempts: 3,
  attemptCount: 0,
  readyAt: '2026-05-15T13:00:00.000Z',
  idempotencyKey: 'route-test',
  constraints: {},
  metadata: {},
  createdAt: '2026-05-15T13:00:00.000Z',
  updatedAt: '2026-05-15T13:00:00.000Z',
  finishedAt: null,
};

const processor: ProcessorRegistryRecord = {
  id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d01',
  tenantId: baseJob.tenantId,
  projectId: baseJob.projectId,
  agentId: '01890f42-98c4-7cc3-aa5e-0c567f1d3d02',
  capabilities: [
    { name: 'thumbnail', version: '1.2.0' },
    { name: 'ocr', version: '2.0.0' },
  ],
  hardware: { gpu: true, gpuCount: 1, gpuModel: 'a10', memoryMb: 16_384 },
  region: 'us-east-1',
  labels: { tier: 'prod', arch: 'x64' },
  tags: ['images', 'fast'],
  routingExplanation: {
    eligible: true,
    reasons: ['registered'],
    matchedCapabilities: ['thumbnail'],
    rejectedConstraints: [],
    metadata: {},
  },
  createdAt: '2026-05-15T13:00:00.000Z',
  updatedAt: '2026-05-15T13:00:00.000Z',
};

function jobWith(constraints: Record<string, unknown>): JobRecord {
  return { ...baseJob, constraints };
}

describe('capability routing policy', () => {
  it('accepts processors that match capability, version, gpu, memory, region, labels, and tags', () => {
    const explanation = evaluateCapabilityRoute({
      job: jobWith({
        capability: 'thumbnail',
        capabilityVersion: '1.2.0',
        requireGpu: true,
        minMemoryMb: 8192,
        region: 'us-east-1',
        labels: { tier: 'prod' },
        tags: ['images'],
      }),
      processor,
    });

    expect(explanation).toMatchObject({
      eligible: true,
      matchedCapabilities: ['thumbnail'],
      rejectedConstraints: [],
    });
    expect(explanation.reasons).toEqual(expect.arrayContaining([
      'capability thumbnail@1.2.0 matched',
      'gpu matched',
      'memoryMb 8192 matched',
      'region us-east-1 matched',
      'label tier=prod matched',
      'tag images matched',
    ]));
  });

  it('rejects processors with explicit explanations for missing constraints', () => {
    const explanation = evaluateCapabilityRoute({
      job: jobWith({
        capability: 'video-transcode',
        version: '3.0.0',
        minMemoryMb: 32_768,
        region: 'eu-west-1',
        labels: { tier: 'staging' },
        tags: ['video'],
      }),
      processor,
    });

    expect(explanation).toMatchObject({
      eligible: false,
      matchedCapabilities: [],
      rejectedConstraints: [
        'capability video-transcode@3.0.0 unavailable',
        'memoryMb 32768 required',
        'region eu-west-1 required',
        'label tier=staging required',
        'tag video required',
      ],
    });
  });
});
