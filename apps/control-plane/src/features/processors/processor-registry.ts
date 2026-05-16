import type { Kysely, Selectable } from 'kysely';
import type {
  AuthContext,
  ProcessorCapability,
  ProcessorHardware,
  ProcessorHeartbeatRequest,
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

import type { HelixDatabase, JsonObject } from '../../db/schema.js';
import type { RuntimeEventRecord, RuntimeOutboxRecord } from '../runtime/transactional-outbox.js';
import { assertProjectPermission, AuthorizationError } from '../iam/authorization.js';
import type { SecurityAuditSink } from '../iam/security-audit.js';
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

export interface UpdateProcessorCapabilitiesInput extends TenantProjectScope {
  readonly processorId: string;
  readonly capabilities: readonly ProcessorCapability[];
  readonly routingExplanation: RoutingExplanation;
}

export interface ReportProcessorHeartbeatInput extends TenantProjectScope {
  readonly processorId: string;
  readonly request: ProcessorHeartbeatRequest;
}

export interface ProcessorHeartbeatPersistenceInput {
  readonly processor: ProcessorRegistryRecord;
  readonly events: readonly RuntimeEventRecord[];
  readonly outbox: readonly RuntimeOutboxRecord[];
}

export interface ProcessorRegistryRepository {
  upsertProcessor(processor: ProcessorRegistryRecord): Promise<ProcessorRegistryRecord>;
  recordHeartbeat?(input: ProcessorHeartbeatPersistenceInput): Promise<ProcessorRegistryRecord>;
  listProcessors(scope: TenantProjectScope): Promise<ProcessorRegistryRecord[]>;
  findProcessorById(input: TenantProjectScope & { readonly processorId: string }): Promise<ProcessorRegistryRecord | null>;
  findProcessorByAgent(input: TenantProjectScope & { readonly agentId: string }): Promise<ProcessorRegistryRecord | null>;
}

export interface ProcessorRegistryServiceOptions {
  readonly repository: ProcessorRegistryRepository;
  readonly auditSink?: SecurityAuditSink;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class ProcessorAgentRequiredError extends Error {
  constructor() {
    super('Processor registration requires an agent token.');
  }
}

export class ProcessorRegistrationNotFoundError extends Error {
  constructor() {
    super('Processor registration was not found.');
  }
}

const runtimeEventTopic = 'helix.runtime.events';

export class ProcessorRegistryService {
  private readonly repository: ProcessorRegistryRepository;
  private readonly auditSink: SecurityAuditSink;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: ProcessorRegistryServiceOptions) {
    this.repository = options.repository;
    this.auditSink = options.auditSink ?? new NoopSecurityAuditSink();
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUuidV7LikeId;
  }

  async registerProcessor(
    authContext: AuthContext,
    input: RegisterProcessorInput,
  ): Promise<ProcessorRegistryRecord> {
    assertProjectPermission(authContext, input, 'agents:register');

    if (authContext.principal.type !== 'agent_token' || authContext.principal.id !== input.agentId) {
      throw new ProcessorAgentRequiredError();
    }

    const now = this.now();
    const timestamp = now.toISOString();
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
      lastHeartbeatAt: existing?.lastHeartbeatAt,
      healthStatus: existing?.healthStatus,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });

    const saved = await this.repository.upsertProcessor(processor);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: saved.tenantId,
      projectId: saved.projectId,
      actor: authContext.principal,
      action: existing === null ? 'processor.registered' : 'processor.registration_updated',
      resourceType: 'processor',
      resourceId: saved.id,
      metadata: { agentId: saved.agentId, capabilities: saved.capabilities },
      occurredAt: now,
    });

    return saved;
  }

  async updateCapabilities(
    authContext: AuthContext,
    input: UpdateProcessorCapabilitiesInput,
  ): Promise<ProcessorRegistryRecord> {
    assertProjectPermission(authContext, input, 'agents:register');

    if (authContext.principal.type !== 'agent_token') {
      throw new ProcessorAgentRequiredError();
    }

    const existing = await this.repository.findProcessorById(input);

    if (existing === null) {
      throw new ProcessorRegistrationNotFoundError();
    }

    if (existing.agentId !== authContext.principal.id) {
      throw new AuthorizationError('wrong_project_scope');
    }

    const now = this.now();
    const processor = processorRegistryRecordSchema.parse({
      ...existing,
      capabilities: input.capabilities.map((capability) => processorCapabilitySchema.parse(capability)),
      routingExplanation: routingExplanationSchema.parse(input.routingExplanation),
      updatedAt: now.toISOString(),
    });
    const saved = await this.repository.upsertProcessor(processor);
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: saved.tenantId,
      projectId: saved.projectId,
      actor: authContext.principal,
      action: 'processor.capabilities_updated',
      resourceType: 'processor',
      resourceId: saved.id,
      metadata: { agentId: saved.agentId, capabilities: saved.capabilities },
      occurredAt: now,
    });

    return saved;
  }

  async reportHeartbeat(
    authContext: AuthContext,
    input: ReportProcessorHeartbeatInput,
  ): Promise<ProcessorRegistryRecord | null> {
    assertProjectPermission(authContext, input, 'agents:register');

    if (authContext.principal.type !== 'agent_token') {
      throw new ProcessorAgentRequiredError();
    }

    const existing = await this.repository.findProcessorById(input);

    if (existing === null) {
      return null;
    }

    if (existing.agentId !== authContext.principal.id) {
      throw new AuthorizationError('wrong_project_scope');
    }

    const now = this.now();
    const processor = processorRegistryRecordSchema.parse({
      ...existing,
      lastHeartbeatAt: now.toISOString(),
      healthStatus: input.request.status,
      updatedAt: now.toISOString(),
    });
    const event = this.createRuntimeEvent({
      tenantId: input.tenantId,
      projectId: input.projectId,
      processorId: input.processorId,
      eventType: 'processor.heartbeat.reported',
      payload: {
        tenantId: input.tenantId,
        projectId: input.projectId,
        processorId: input.processorId,
        agentId: authContext.principal.id,
        status: input.request.status,
        ...(input.request.activeJobCount === undefined ? {} : { activeJobCount: input.request.activeJobCount }),
        ...(input.request.message === undefined ? {} : { message: input.request.message }),
        ...(input.request.metrics === undefined ? {} : { metrics: sanitizeMetadata(input.request.metrics) }),
        reportedAt: now.toISOString(),
      },
      timestamp: now,
    });
    const saved = this.repository.recordHeartbeat === undefined
      ? await this.repository.upsertProcessor(processor)
      : await this.repository.recordHeartbeat({
          processor,
          events: [event],
          outbox: [this.createRuntimeOutbox(event, now)],
        });
    await this.auditSink.record({
      id: this.generateId(),
      tenantId: saved.tenantId,
      projectId: saved.projectId,
      actor: authContext.principal,
      action: 'processor.heartbeat_reported',
      resourceType: 'processor',
      resourceId: saved.id,
      metadata: {
        agentId: saved.agentId,
        status: input.request.status,
        ...(input.request.activeJobCount === undefined ? {} : { activeJobCount: input.request.activeJobCount }),
      },
      occurredAt: now,
    });

    return saved;
  }

  async listProcessors(
    authContext: AuthContext,
    scope: TenantProjectScope,
  ): Promise<ProcessorRegistryRecord[]> {
    assertProjectPermission(authContext, scope, 'agents:read');

    return this.repository.listProcessors(scope);
  }

  private createRuntimeEvent(input: {
    readonly eventType: string;
    readonly tenantId: string;
    readonly projectId: string;
    readonly processorId: string;
    readonly payload: Record<string, unknown>;
    readonly timestamp: Date;
  }): RuntimeEventRecord {
    return {
      id: randomUuidV7LikeId(input.timestamp),
      tenantId: input.tenantId,
      projectId: input.projectId,
      eventType: input.eventType,
      eventVersion: 1,
      orderingKey: `project:${input.projectId}:processor:${input.processorId}`,
      payload: input.payload,
      occurredAt: input.timestamp,
      recordedAt: input.timestamp,
    };
  }

  private createRuntimeOutbox(event: RuntimeEventRecord, timestamp: Date): RuntimeOutboxRecord {
    return {
      id: randomUuidV7LikeId(timestamp),
      tenantId: event.tenantId,
      projectId: event.projectId,
      eventId: event.id,
      topic: runtimeEventTopic,
      partitionKey: event.orderingKey,
      status: 'pending',
      publishAttempts: 0,
      nextAttemptAt: timestamp,
      publishedAt: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}

export class InMemoryProcessorRegistryRepository implements ProcessorRegistryRepository {
  readonly processors: ProcessorRegistryRecord[] = [];
  readonly runtimeEvents: RuntimeEventRecord[] = [];
  readonly runtimeOutbox: RuntimeOutboxRecord[] = [];

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

  async recordHeartbeat(input: ProcessorHeartbeatPersistenceInput): Promise<ProcessorRegistryRecord> {
    const processor = await this.upsertProcessor(input.processor);

    this.runtimeEvents.push(...input.events);
    this.runtimeOutbox.push(...input.outbox);

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

  async findProcessorById(
    input: TenantProjectScope & { readonly processorId: string },
  ): Promise<ProcessorRegistryRecord | null> {
    return (
      this.processors.find(
        (processor) =>
          processor.tenantId === input.tenantId &&
          processor.projectId === input.projectId &&
          processor.id === input.processorId,
      ) ?? null
    );
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

export class KyselyProcessorRegistryRepository implements ProcessorRegistryRepository {
  constructor(private readonly db: Kysely<HelixDatabase>) {}

  async upsertProcessor(processor: ProcessorRegistryRecord): Promise<ProcessorRegistryRecord> {
    const row = await this.db
      .insertInto('processor_registrations')
      .values({
        id: processor.id,
        tenant_id: processor.tenantId,
        project_id: processor.projectId,
        agent_id: processor.agentId,
        capabilities_json: { items: processor.capabilities },
        hardware_json: processor.hardware as unknown as JsonObject,
        region: processor.region,
        labels_json: processor.labels,
        tags_json: processor.tags,
        routing_explanation_json: processor.routingExplanation as unknown as JsonObject,
        last_heartbeat_at: processor.lastHeartbeatAt ?? null,
        health_status: processor.healthStatus ?? null,
        created_at: processor.createdAt,
        updated_at: processor.updatedAt,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'project_id', 'agent_id']).doUpdateSet({
          capabilities_json: { items: processor.capabilities },
          hardware_json: processor.hardware as unknown as JsonObject,
          region: processor.region,
          labels_json: processor.labels,
          tags_json: processor.tags,
          routing_explanation_json: processor.routingExplanation as unknown as JsonObject,
          last_heartbeat_at: processor.lastHeartbeatAt ?? null,
          health_status: processor.healthStatus ?? null,
          updated_at: processor.updatedAt,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return toProcessorRegistryRecord(row);
  }

  async recordHeartbeat(input: ProcessorHeartbeatPersistenceInput): Promise<ProcessorRegistryRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('processor_registrations')
        .values({
          id: input.processor.id,
          tenant_id: input.processor.tenantId,
          project_id: input.processor.projectId,
          agent_id: input.processor.agentId,
          capabilities_json: { items: input.processor.capabilities },
          hardware_json: input.processor.hardware as unknown as JsonObject,
          region: input.processor.region,
          labels_json: input.processor.labels,
          tags_json: input.processor.tags,
          routing_explanation_json: input.processor.routingExplanation as unknown as JsonObject,
          last_heartbeat_at: input.processor.lastHeartbeatAt ?? null,
          health_status: input.processor.healthStatus ?? null,
          created_at: input.processor.createdAt,
          updated_at: input.processor.updatedAt,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'project_id', 'agent_id']).doUpdateSet({
            capabilities_json: { items: input.processor.capabilities },
            hardware_json: input.processor.hardware as unknown as JsonObject,
            region: input.processor.region,
            labels_json: input.processor.labels,
            tags_json: input.processor.tags,
            routing_explanation_json: input.processor.routingExplanation as unknown as JsonObject,
            last_heartbeat_at: input.processor.lastHeartbeatAt ?? null,
            health_status: input.processor.healthStatus ?? null,
            updated_at: input.processor.updatedAt,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const event of input.events) {
        await transaction.insertInto('runtime_events').values(toRuntimeEventRow(event)).execute();
      }
      for (const outbox of input.outbox) {
        await transaction.insertInto('runtime_outbox').values(toRuntimeOutboxRow(outbox)).execute();
      }

      return toProcessorRegistryRecord(row);
    });
  }

  async listProcessors(scope: TenantProjectScope): Promise<ProcessorRegistryRecord[]> {
    const rows = await this.db
      .selectFrom('processor_registrations')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('project_id', '=', scope.projectId)
      .orderBy('updated_at', 'desc')
      .execute();

    return rows.map(toProcessorRegistryRecord);
  }

  async findProcessorById(
    input: TenantProjectScope & { readonly processorId: string },
  ): Promise<ProcessorRegistryRecord | null> {
    const row = await this.db
      .selectFrom('processor_registrations')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('id', '=', input.processorId)
      .executeTakeFirst();

    return row === undefined ? null : toProcessorRegistryRecord(row);
  }

  async findProcessorByAgent(
    input: TenantProjectScope & { readonly agentId: string },
  ): Promise<ProcessorRegistryRecord | null> {
    const row = await this.db
      .selectFrom('processor_registrations')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('agent_id', '=', input.agentId)
      .executeTakeFirst();

    return row === undefined ? null : toProcessorRegistryRecord(row);
  }
}

class NoopSecurityAuditSink implements SecurityAuditSink {
  async record(): Promise<void> {
    return;
  }
}

function toProcessorRegistryRecord(
  row: Selectable<HelixDatabase['processor_registrations']>,
): ProcessorRegistryRecord {
  const capabilitiesJson = row.capabilities_json;
  const capabilities = Array.isArray(capabilitiesJson.items) ? capabilitiesJson.items : [];

  return processorRegistryRecordSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    agentId: row.agent_id,
    capabilities,
    hardware: row.hardware_json,
    region: row.region,
    labels: row.labels_json,
    tags: row.tags_json,
    routingExplanation: row.routing_explanation_json,
    ...(row.last_heartbeat_at === null ? {} : { lastHeartbeatAt: toIsoTimestamp(row.last_heartbeat_at) }),
    ...(row.health_status === null ? {} : { healthStatus: row.health_status }),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  });
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toRuntimeEventRow(event: RuntimeEventRecord) {
  return {
    id: event.id,
    tenant_id: event.tenantId,
    project_id: event.projectId,
    event_type: event.eventType,
    event_version: event.eventVersion,
    ordering_key: event.orderingKey,
    payload_json: event.payload,
    occurred_at: event.occurredAt,
    recorded_at: event.recordedAt,
  };
}

function toRuntimeOutboxRow(outbox: RuntimeOutboxRecord) {
  return {
    id: outbox.id,
    tenant_id: outbox.tenantId,
    project_id: outbox.projectId,
    event_id: outbox.eventId,
    topic: outbox.topic,
    partition_key: outbox.partitionKey,
    status: outbox.status,
    publish_attempts: outbox.publishAttempts,
    next_attempt_at: outbox.nextAttemptAt,
    published_at: outbox.publishedAt,
    last_error: outbox.lastError,
    created_at: outbox.createdAt,
    updated_at: outbox.updatedAt,
  };
}

const sensitiveKeyPattern = /(?:secret|token|password|authorization|api[-_]?key)/iu;

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sensitiveKeyPattern.test(key) ? '[redacted]' : sanitizeMetadataValue(nested),
    ]),
  );
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  return value;
}
