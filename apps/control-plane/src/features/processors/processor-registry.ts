import type {
  AuthContext,
  ProcessorCapability,
  ProcessorHardware,
  ProcessorLabels,
  ProcessorRegistryRecord,
  ProcessorTags,
  RoutingExplanation,
  TenantProjectScope,
} from '@helix/contracts';
import {
  processorCapabilitySchema,
  processorHardwareSchema,
  processorLabelsSchema,
  processorRegistryRecordSchema,
  processorTagsSchema,
  routingExplanationSchema,
} from '@helix/contracts';

import { assertProjectPermission } from '../iam/authorization.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';

export interface RegisterProcessorInput extends TenantProjectScope {
  readonly agentId: string;
  readonly capabilities: readonly ProcessorCapability[];
  readonly hardware: ProcessorHardware;
  readonly region: string;
  readonly labels: ProcessorLabels;
  readonly tags: ProcessorTags;
  readonly routingExplanation: RoutingExplanation;
}

export interface ProcessorRegistryRepository {
  upsertProcessor(processor: ProcessorRegistryRecord): Promise<ProcessorRegistryRecord>;
  listProcessors(scope: TenantProjectScope): Promise<ProcessorRegistryRecord[]>;
  findProcessorByAgent(input: TenantProjectScope & { readonly agentId: string }): Promise<ProcessorRegistryRecord | null>;
}

export interface ProcessorRegistryServiceOptions {
  readonly repository: ProcessorRegistryRepository;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class ProcessorRegistryService {
  private readonly repository: ProcessorRegistryRepository;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: ProcessorRegistryServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUuidV7LikeId;
  }

  async registerProcessor(
    authContext: AuthContext,
    input: RegisterProcessorInput,
  ): Promise<ProcessorRegistryRecord> {
    assertProjectPermission(authContext, input, 'agents:register');

    const timestamp = this.now().toISOString();
    const existing = await this.repository.findProcessorByAgent(input);
    const processor = processorRegistryRecordSchema.parse({
      id: existing?.id ?? this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      agentId: input.agentId,
      capabilities: input.capabilities.map((capability) => processorCapabilitySchema.parse(capability)),
      hardware: processorHardwareSchema.parse(input.hardware),
      region: input.region,
      labels: processorLabelsSchema.parse(input.labels),
      tags: processorTagsSchema.parse(input.tags),
      routingExplanation: routingExplanationSchema.parse(input.routingExplanation),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });

    return this.repository.upsertProcessor(processor);
  }

  async listProcessors(
    authContext: AuthContext,
    scope: TenantProjectScope,
  ): Promise<ProcessorRegistryRecord[]> {
    assertProjectPermission(authContext, scope, 'agents:read');

    return this.repository.listProcessors(scope);
  }
}

export class InMemoryProcessorRegistryRepository implements ProcessorRegistryRepository {
  readonly processors: ProcessorRegistryRecord[] = [];

  async upsertProcessor(processor: ProcessorRegistryRecord): Promise<ProcessorRegistryRecord> {
    const index = this.processors.findIndex(
      (existing) =>
        existing.tenantId === processor.tenantId &&
        existing.projectId === processor.projectId &&
        existing.agentId === processor.agentId,
    );

    if (index === -1) {
      this.processors.push({ ...processor });
      return processor;
    }

    this.processors[index] = { ...processor };
    return processor;
  }

  async listProcessors(scope: TenantProjectScope): Promise<ProcessorRegistryRecord[]> {
    return this.processors
      .filter(
        (processor) =>
          processor.tenantId === scope.tenantId && processor.projectId === scope.projectId,
      )
      .map((processor) => ({ ...processor }));
  }

  async findProcessorByAgent(
    input: TenantProjectScope & { readonly agentId: string },
  ): Promise<ProcessorRegistryRecord | null> {
    return (
      this.processors.find(
        (processor) =>
          processor.tenantId === input.tenantId &&
          processor.projectId === input.projectId &&
          processor.agentId === input.agentId,
      ) ?? null
    );
  }
}
