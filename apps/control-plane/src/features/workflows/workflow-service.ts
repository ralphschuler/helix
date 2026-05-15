import type { Kysely, Selectable } from 'kysely';
import type {
  AuthContext,
  CreateWorkflowRequest,
  StartWorkflowRunRequest,
  TenantProjectScope,
  UpdateWorkflowDraftRequest,
  WorkflowDefinitionRecord,
  WorkflowRunRecord,
  WorkflowVersionRecord,
} from '@helix/contracts';

import type { HelixDatabase } from '../../db/schema.js';
import { assertProjectPermission } from '../iam/authorization.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';

export interface WorkflowRepositoryCreateInput {
  readonly workflow: WorkflowDefinitionRecord;
}

export interface WorkflowRepositoryUpdateDraftInput extends TenantProjectScope {
  readonly workflowId: string;
  readonly patch: UpdateWorkflowDraftRequest;
  readonly updatedAt: string;
}

export interface WorkflowRepositoryPublishInput {
  readonly version: WorkflowVersionRecord;
}

export interface WorkflowRepositoryStartRunInput {
  readonly run: WorkflowRunRecord;
}

export interface WorkflowRepository {
  createWorkflow(input: WorkflowRepositoryCreateInput): Promise<WorkflowDefinitionRecord>;
  updateDraft(input: WorkflowRepositoryUpdateDraftInput): Promise<WorkflowDefinitionRecord | null>;
  findWorkflow(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowDefinitionRecord | null>;
  listWorkflows(input: TenantProjectScope): Promise<WorkflowDefinitionRecord[]>;
  findLatestVersion(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowVersionRecord | null>;
  findVersion(input: TenantProjectScope & { readonly workflowVersionId: string }): Promise<WorkflowVersionRecord | null>;
  nextVersionNumber(input: TenantProjectScope & { readonly workflowId: string }): Promise<number>;
  publishVersion(input: WorkflowRepositoryPublishInput): Promise<WorkflowVersionRecord>;
  findRunByIdempotencyKey(input: TenantProjectScope & { readonly workflowId: string; readonly idempotencyKey: string }): Promise<WorkflowRunRecord | null>;
  createRun(input: WorkflowRepositoryStartRunInput): Promise<WorkflowRunRecord>;
}

export interface WorkflowServiceOptions {
  readonly repository: WorkflowRepository;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class WorkflowNotFoundError extends Error {
  constructor() {
    super('Workflow not found.');
    this.name = 'WorkflowNotFoundError';
  }
}

export class WorkflowVersionNotFoundError extends Error {
  constructor() {
    super('Workflow version not found.');
    this.name = 'WorkflowVersionNotFoundError';
  }
}

export class WorkflowRunIdempotencyConflictError extends Error {
  constructor() {
    super('Workflow run idempotency key was reused with different start parameters.');
    this.name = 'WorkflowRunIdempotencyConflictError';
  }
}

export class WorkflowService {
  private readonly repository: WorkflowRepository;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: WorkflowServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => randomUuidV7LikeId(this.now()));
  }

  async createWorkflow(
    authContext: AuthContext,
    input: TenantProjectScope & { readonly request: CreateWorkflowRequest },
  ): Promise<WorkflowDefinitionRecord> {
    assertProjectPermission(authContext, input, 'workflows:create');

    const timestamp = this.now().toISOString();
    const workflow: WorkflowDefinitionRecord = {
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      slug: input.request.slug,
      name: input.request.name,
      description: input.request.description ?? null,
      draftGraph: cloneJsonObject(input.request.draftGraph),
      metadata: cloneJsonObject(input.request.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.repository.createWorkflow({ workflow });
  }

  async updateDraft(
    authContext: AuthContext,
    input: TenantProjectScope & { readonly workflowId: string; readonly request: UpdateWorkflowDraftRequest },
  ): Promise<WorkflowDefinitionRecord | null> {
    assertProjectPermission(authContext, input, 'workflows:update');

    return this.repository.updateDraft({
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowId: input.workflowId,
      patch: input.request,
      updatedAt: this.now().toISOString(),
    });
  }

  async getWorkflow(
    authContext: AuthContext,
    input: TenantProjectScope & { readonly workflowId: string },
  ): Promise<WorkflowDefinitionRecord | null> {
    assertProjectPermission(authContext, input, 'workflows:read');

    return this.repository.findWorkflow(input);
  }

  async listWorkflows(authContext: AuthContext, input: TenantProjectScope): Promise<WorkflowDefinitionRecord[]> {
    assertProjectPermission(authContext, input, 'workflows:read');

    return this.repository.listWorkflows(input);
  }

  async publishWorkflow(
    authContext: AuthContext,
    input: TenantProjectScope & { readonly workflowId: string },
  ): Promise<WorkflowVersionRecord | null> {
    assertProjectPermission(authContext, input, 'workflows:publish');

    const workflow = await this.repository.findWorkflow(input);

    if (workflow === null) {
      return null;
    }

    const timestamp = this.now().toISOString();
    const version: WorkflowVersionRecord = {
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowId: workflow.id,
      versionNumber: await this.repository.nextVersionNumber(input),
      graph: cloneJsonObject(workflow.draftGraph),
      metadata: cloneJsonObject(workflow.metadata),
      publishedAt: timestamp,
      createdAt: timestamp,
    };

    return this.repository.publishVersion({ version });
  }

  async startRun(
    authContext: AuthContext,
    input: TenantProjectScope & {
      readonly workflowId: string;
      readonly idempotencyKey: string;
      readonly request: StartWorkflowRunRequest;
    },
  ): Promise<{ readonly run: WorkflowRunRecord; readonly created: boolean } | null> {
    assertProjectPermission(authContext, input, 'workflows:start');

    const workflow = await this.repository.findWorkflow(input);

    if (workflow === null) {
      return null;
    }

    const version = input.request.workflowVersionId === undefined
      ? await this.repository.findLatestVersion(input)
      : await this.repository.findVersion({
          tenantId: input.tenantId,
          projectId: input.projectId,
          workflowVersionId: input.request.workflowVersionId,
        });

    if (version === null || version.workflowId !== input.workflowId) {
      throw new WorkflowVersionNotFoundError();
    }

    const existing = await this.repository.findRunByIdempotencyKey(input);

    if (existing !== null) {
      if (existing.workflowVersionId !== version.id) {
        throw new WorkflowRunIdempotencyConflictError();
      }

      return { run: existing, created: false };
    }

    const timestamp = this.now().toISOString();
    const run: WorkflowRunRecord = {
      id: this.generateId(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      state: 'queued',
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      return { run: await this.repository.createRun({ run }), created: true };
    } catch (error) {
      const existingAfterRace = await this.repository.findRunByIdempotencyKey(input);

      if (existingAfterRace !== null) {
        if (existingAfterRace.workflowVersionId !== version.id) {
          throw new WorkflowRunIdempotencyConflictError();
        }

        return { run: existingAfterRace, created: false };
      }

      throw error;
    }
  }
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  readonly workflows: WorkflowDefinitionRecord[] = [];
  readonly versions: WorkflowVersionRecord[] = [];
  readonly runs: WorkflowRunRecord[] = [];

  async createWorkflow(input: WorkflowRepositoryCreateInput): Promise<WorkflowDefinitionRecord> {
    this.workflows.push(cloneWorkflow(input.workflow));
    return cloneWorkflow(input.workflow);
  }

  async updateDraft(input: WorkflowRepositoryUpdateDraftInput): Promise<WorkflowDefinitionRecord | null> {
    const workflow = await this.findWorkflow(input);

    if (workflow === null) {
      return null;
    }

    const updated: WorkflowDefinitionRecord = {
      ...workflow,
      name: input.patch.name ?? workflow.name,
      description: input.patch.description === undefined ? workflow.description : input.patch.description,
      draftGraph: input.patch.draftGraph === undefined ? workflow.draftGraph : cloneJsonObject(input.patch.draftGraph),
      metadata: input.patch.metadata === undefined ? workflow.metadata : cloneJsonObject(input.patch.metadata),
      updatedAt: input.updatedAt,
    };
    const index = this.workflows.findIndex((candidate) => candidate.id === workflow.id);
    this.workflows[index] = cloneWorkflow(updated);

    return cloneWorkflow(updated);
  }

  async findWorkflow(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowDefinitionRecord | null> {
    const workflow = this.workflows.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.id === input.workflowId,
    );

    return workflow === undefined ? null : cloneWorkflow(workflow);
  }

  async listWorkflows(input: TenantProjectScope): Promise<WorkflowDefinitionRecord[]> {
    return this.workflows
      .filter((workflow) => workflow.tenantId === input.tenantId && workflow.projectId === input.projectId)
      .map(cloneWorkflow);
  }

  async findLatestVersion(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowVersionRecord | null> {
    const version = this.versions
      .filter(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.projectId === input.projectId &&
          candidate.workflowId === input.workflowId,
      )
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];

    return version === undefined ? null : cloneVersion(version);
  }

  async findVersion(input: TenantProjectScope & { readonly workflowVersionId: string }): Promise<WorkflowVersionRecord | null> {
    const version = this.versions.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.id === input.workflowVersionId,
    );

    return version === undefined ? null : cloneVersion(version);
  }

  async nextVersionNumber(input: TenantProjectScope & { readonly workflowId: string }): Promise<number> {
    const latest = await this.findLatestVersion(input);
    return latest === null ? 1 : latest.versionNumber + 1;
  }

  async publishVersion(input: WorkflowRepositoryPublishInput): Promise<WorkflowVersionRecord> {
    this.versions.push(cloneVersion(input.version));
    return cloneVersion(input.version);
  }

  async findRunByIdempotencyKey(input: TenantProjectScope & { readonly workflowId: string; readonly idempotencyKey: string }): Promise<WorkflowRunRecord | null> {
    const run = this.runs.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.workflowId === input.workflowId &&
        candidate.idempotencyKey === input.idempotencyKey,
    );

    return run === undefined ? null : cloneRun(run);
  }

  async createRun(input: WorkflowRepositoryStartRunInput): Promise<WorkflowRunRecord> {
    this.runs.push(cloneRun(input.run));
    return cloneRun(input.run);
  }
}

export class KyselyWorkflowRepository implements WorkflowRepository {
  constructor(private readonly db: Kysely<HelixDatabase>) {}

  async createWorkflow(input: WorkflowRepositoryCreateInput): Promise<WorkflowDefinitionRecord> {
    const row = await this.db
      .insertInto('workflow_definitions')
      .values(toWorkflowDefinitionRow(input.workflow))
      .returningAll()
      .executeTakeFirstOrThrow();
    return toWorkflowDefinitionRecord(row);
  }

  async updateDraft(input: WorkflowRepositoryUpdateDraftInput): Promise<WorkflowDefinitionRecord | null> {
    const update: Record<string, unknown> = { updated_at: input.updatedAt };
    if (input.patch.name !== undefined) update.name = input.patch.name;
    if (input.patch.description !== undefined) update.description = input.patch.description;
    if (input.patch.draftGraph !== undefined) update.draft_graph_json = input.patch.draftGraph;
    if (input.patch.metadata !== undefined) update.metadata_json = input.patch.metadata;

    const row = await this.db
      .updateTable('workflow_definitions')
      .set(update)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('id', '=', input.workflowId)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toWorkflowDefinitionRecord(row);
  }

  async findWorkflow(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowDefinitionRecord | null> {
    const row = await this.db
      .selectFrom('workflow_definitions')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('id', '=', input.workflowId)
      .executeTakeFirst();
    return row === undefined ? null : toWorkflowDefinitionRecord(row);
  }

  async listWorkflows(input: TenantProjectScope): Promise<WorkflowDefinitionRecord[]> {
    const rows = await this.db
      .selectFrom('workflow_definitions')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(toWorkflowDefinitionRecord);
  }

  async findLatestVersion(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowVersionRecord | null> {
    const row = await this.db
      .selectFrom('workflow_versions')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('workflow_id', '=', input.workflowId)
      .orderBy('version_number', 'desc')
      .executeTakeFirst();
    return row === undefined ? null : toWorkflowVersionRecord(row);
  }

  async findVersion(input: TenantProjectScope & { readonly workflowVersionId: string }): Promise<WorkflowVersionRecord | null> {
    const row = await this.db
      .selectFrom('workflow_versions')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('id', '=', input.workflowVersionId)
      .executeTakeFirst();
    return row === undefined ? null : toWorkflowVersionRecord(row);
  }

  async nextVersionNumber(input: TenantProjectScope & { readonly workflowId: string }): Promise<number> {
    const latest = await this.findLatestVersion(input);
    return latest === null ? 1 : latest.versionNumber + 1;
  }

  async publishVersion(input: WorkflowRepositoryPublishInput): Promise<WorkflowVersionRecord> {
    const row = await this.db
      .insertInto('workflow_versions')
      .values(toWorkflowVersionRow(input.version))
      .returningAll()
      .executeTakeFirstOrThrow();
    return toWorkflowVersionRecord(row);
  }

  async findRunByIdempotencyKey(input: TenantProjectScope & { readonly workflowId: string; readonly idempotencyKey: string }): Promise<WorkflowRunRecord | null> {
    const row = await this.db
      .selectFrom('workflow_runs')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('workflow_id', '=', input.workflowId)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();
    return row === undefined ? null : toWorkflowRunRecord(row);
  }

  async createRun(input: WorkflowRepositoryStartRunInput): Promise<WorkflowRunRecord> {
    const row = await this.db
      .insertInto('workflow_runs')
      .values(toWorkflowRunRow(input.run))
      .returningAll()
      .executeTakeFirstOrThrow();
    return toWorkflowRunRecord(row);
  }
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneWorkflow(workflow: WorkflowDefinitionRecord): WorkflowDefinitionRecord {
  return { ...workflow, draftGraph: cloneJsonObject(workflow.draftGraph), metadata: cloneJsonObject(workflow.metadata) };
}

function cloneVersion(version: WorkflowVersionRecord): WorkflowVersionRecord {
  return { ...version, graph: cloneJsonObject(version.graph), metadata: cloneJsonObject(version.metadata) };
}

function cloneRun(run: WorkflowRunRecord): WorkflowRunRecord {
  return { ...run };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toWorkflowDefinitionRecord(row: Selectable<HelixDatabase['workflow_definitions']>): WorkflowDefinitionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    draftGraph: row.draft_graph_json,
    metadata: row.metadata_json,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toWorkflowVersionRecord(row: Selectable<HelixDatabase['workflow_versions']>): WorkflowVersionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    graph: row.graph_json,
    metadata: row.metadata_json,
    publishedAt: toIsoString(row.published_at),
    createdAt: toIsoString(row.created_at),
  };
}

function toWorkflowRunRecord(row: Selectable<HelixDatabase['workflow_runs']>): WorkflowRunRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    workflowId: row.workflow_id,
    workflowVersionId: row.workflow_version_id,
    state: row.state,
    idempotencyKey: row.idempotency_key,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toWorkflowDefinitionRow(workflow: WorkflowDefinitionRecord) {
  return {
    id: workflow.id,
    tenant_id: workflow.tenantId,
    project_id: workflow.projectId,
    slug: workflow.slug,
    name: workflow.name,
    description: workflow.description,
    draft_graph_json: workflow.draftGraph,
    metadata_json: workflow.metadata,
    created_at: workflow.createdAt,
    updated_at: workflow.updatedAt,
  };
}

function toWorkflowVersionRow(version: WorkflowVersionRecord) {
  return {
    id: version.id,
    tenant_id: version.tenantId,
    project_id: version.projectId,
    workflow_id: version.workflowId,
    version_number: version.versionNumber,
    graph_json: version.graph,
    metadata_json: version.metadata,
    published_at: version.publishedAt,
    created_at: version.createdAt,
  };
}

function toWorkflowRunRow(run: WorkflowRunRecord) {
  return {
    id: run.id,
    tenant_id: run.tenantId,
    project_id: run.projectId,
    workflow_id: run.workflowId,
    workflow_version_id: run.workflowVersionId,
    state: run.state,
    idempotency_key: run.idempotencyKey,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}
