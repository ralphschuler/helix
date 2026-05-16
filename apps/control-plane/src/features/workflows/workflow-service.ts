import type { Kysely, Selectable } from 'kysely';
import type {
  AuthContext,
  CreateJobRequest,
  CreateWorkflowRequest,
  StartWorkflowRunRequest,
  TenantProjectScope,
  UpdateWorkflowDraftRequest,
  WorkflowDefinitionRecord,
  WorkflowRunRecord,
  WorkflowStepRecord,
  WorkflowStepType,
  WorkflowVersionRecord,
} from '@helix/contracts';

import type { HelixDatabase } from '../../db/schema.js';
import { assertProjectPermission } from '../iam/authorization.js';
import { randomUuidV7LikeId } from '../iam/token-secrets.js';
import type {
  RuntimeEventRecord,
  RuntimeOutboxRecord,
} from '../runtime/transactional-outbox.js';
import { assertValidWorkflowDag } from './workflow-dag-validator.js';
import { transitionWorkflowStepState } from './workflow-step-state-machine.js';

export { WorkflowGraphValidationError } from './workflow-dag-validator.js';

const runtimeEventTopic = 'helix.runtime.events';

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

export interface WorkflowStepDependencyRecord extends TenantProjectScope {
  readonly workflowId: string;
  readonly workflowVersionId: string;
  readonly runId: string;
  readonly fromStepId: string;
  readonly toStepId: string;
  readonly createdAt: string;
}

export interface WorkflowRepositoryStartRunInput {
  readonly run: WorkflowRunRecord;
  readonly steps: readonly WorkflowStepRecord[];
  readonly dependencies: readonly WorkflowStepDependencyRecord[];
  readonly events: readonly RuntimeEventRecord[];
  readonly outbox: readonly RuntimeOutboxRecord[];
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
  findRun(input: TenantProjectScope & { readonly workflowId: string; readonly runId: string }): Promise<WorkflowRunRecord | null>;
  listRuns(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowRunRecord[]>;
  findRunByIdempotencyKey(input: TenantProjectScope & { readonly workflowId: string; readonly idempotencyKey: string }): Promise<WorkflowRunRecord | null>;
  listRunSteps(input: TenantProjectScope & { readonly runId: string }): Promise<WorkflowStepRecord[]>;
  listRunStepDependencies(input: TenantProjectScope & { readonly runId: string }): Promise<WorkflowStepDependencyRecord[]>;
  updateStep(input: TenantProjectScope & {
    readonly runId: string;
    readonly stepId: string;
    readonly state?: WorkflowStepRecord['state'];
    readonly jobId?: string | null;
    readonly updatedAt: string;
  }): Promise<WorkflowStepRecord | null>;
  createRun(input: WorkflowRepositoryStartRunInput): Promise<WorkflowRunRecord>;
}

export interface WorkflowJobActivationInput {
  readonly scope: TenantProjectScope;
  readonly idempotencyKey: string;
  readonly request: CreateJobRequest;
}

export interface WorkflowJobActivationResult {
  readonly job: { readonly id: string };
  readonly created: boolean;
}

export type WorkflowJobActivator = (input: WorkflowJobActivationInput) => Promise<WorkflowJobActivationResult>;

export interface WorkflowServiceOptions {
  readonly repository: WorkflowRepository;
  readonly jobActivator?: WorkflowJobActivator;
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

export class WorkflowStepNotFoundError extends Error {
  constructor() {
    super('Workflow step not found.');
    this.name = 'WorkflowStepNotFoundError';
  }
}

export class WorkflowStepJobMismatchError extends Error {
  constructor() {
    super('Workflow step is not bound to the completed job.');
    this.name = 'WorkflowStepJobMismatchError';
  }
}

interface ParsedWorkflowNode {
  readonly id: string;
  readonly type: WorkflowStepType;
}

interface ParsedWorkflowEdge {
  readonly from: string;
  readonly to: string;
}

interface ParsedWorkflowGraph {
  readonly nodes: readonly ParsedWorkflowNode[];
  readonly edges: readonly ParsedWorkflowEdge[];
}

export class WorkflowService {
  private readonly repository: WorkflowRepository;
  private readonly jobActivator: WorkflowJobActivator | undefined;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: WorkflowServiceOptions) {
    this.repository = options.repository;
    this.jobActivator = options.jobActivator;
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

    assertValidWorkflowDag(workflow.draftGraph);

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

  async getRun(
    authContext: AuthContext,
    input: TenantProjectScope & { readonly workflowId: string; readonly runId: string },
  ): Promise<WorkflowRunRecord | null> {
    assertProjectPermission(authContext, input, 'workflows:read');

    return this.repository.findRun(input);
  }

  async listRuns(
    authContext: AuthContext,
    input: TenantProjectScope & { readonly workflowId: string },
  ): Promise<WorkflowRunRecord[]> {
    assertProjectPermission(authContext, input, 'workflows:read');

    return this.repository.listRuns(input);
  }

  async completeStep(
    authContext: AuthContext,
    input: TenantProjectScope & {
      readonly workflowId: string;
      readonly runId: string;
      readonly stepId: string;
      readonly completedJobId?: string;
    },
  ): Promise<WorkflowStepRecord> {
    assertProjectPermission(authContext, input, 'workflows:start');

    const run = await this.repository.findRun({
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowId: input.workflowId,
      runId: input.runId,
    });

    if (run === null) {
      throw new WorkflowStepNotFoundError();
    }

    const steps = await this.repository.listRunSteps(input);
    const step = steps.find((candidate) => candidate.stepId === input.stepId);

    if (step === undefined) {
      throw new WorkflowStepNotFoundError();
    }

    if (input.completedJobId !== undefined && step.jobId !== input.completedJobId) {
      throw new WorkflowStepJobMismatchError();
    }

    const nextState = transitionWorkflowStepState(step.state, 'completed');
    const completed = await this.repository.updateStep({
      tenantId: input.tenantId,
      projectId: input.projectId,
      runId: input.runId,
      stepId: input.stepId,
      state: nextState,
      updatedAt: this.now().toISOString(),
    });

    if (completed === null) {
      throw new WorkflowStepNotFoundError();
    }

    await this.activateNewlyReadyJobSteps(run);

    return completed;
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

    assertValidWorkflowDag(version.graph);

    const existing = await this.repository.findRunByIdempotencyKey(input);

    if (existing !== null) {
      if (existing.workflowVersionId !== version.id) {
        throw new WorkflowRunIdempotencyConflictError();
      }

      await this.activateInitialReadyJobSteps(existing);
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

    const workflowGraph = parseWorkflowGraph(version.graph);
    const readyStepIds = findInitialReadyJobStepIds(workflowGraph);
    const steps = workflowGraph.nodes.map((node): WorkflowStepRecord => ({
      id: randomUuidV7LikeId(new Date(timestamp)),
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runId: run.id,
      stepId: node.id,
      type: node.type,
      state: readyStepIds.has(node.id) ? 'running' : 'pending',
      jobId: null,
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const dependencies = workflowGraph.edges.map((edge): WorkflowStepDependencyRecord => ({
      tenantId: input.tenantId,
      projectId: input.projectId,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      runId: run.id,
      fromStepId: edge.from,
      toStepId: edge.to,
      createdAt: timestamp,
    }));
    const events = [this.createRunStartedEvent(run, timestamp)];
    const outbox = events.map((event) => this.createRuntimeOutbox(event, new Date(timestamp)));

    try {
      const createdRun = await this.repository.createRun({ run, steps, dependencies, events, outbox });
      await this.activateInitialReadyJobSteps(createdRun);
      return { run: createdRun, created: true };
    } catch (error) {
      const existingAfterRace = await this.repository.findRunByIdempotencyKey(input);

      if (existingAfterRace !== null) {
        if (existingAfterRace.workflowVersionId !== version.id) {
          throw new WorkflowRunIdempotencyConflictError();
        }

        await this.activateInitialReadyJobSteps(existingAfterRace);
        return { run: existingAfterRace, created: false };
      }

      throw error;
    }
  }

  private async activateInitialReadyJobSteps(run: WorkflowRunRecord): Promise<void> {
    const steps = await this.repository.listRunSteps({
      tenantId: run.tenantId,
      projectId: run.projectId,
      runId: run.id,
    });

    for (const step of steps.filter((candidate) => candidate.type === 'job' && candidate.state === 'running')) {
      await this.activateJobStep(run, step);
    }
  }

  private async activateNewlyReadyJobSteps(run: WorkflowRunRecord): Promise<void> {
    const scope = { tenantId: run.tenantId, projectId: run.projectId, runId: run.id };
    const dependencies = await this.repository.listRunStepDependencies(scope);
    let steps = await this.repository.listRunSteps(scope);
    let progressed = true;

    while (progressed) {
      progressed = false;
      const completedStepIds = new Set(steps
        .filter((step) => step.state === 'completed')
        .map((step) => step.stepId));

      for (const step of steps.filter((candidate) => candidate.state === 'pending')) {
        const incoming = dependencies.filter((dependency) => dependency.toStepId === step.stepId);
        const isReady = incoming.length > 0 && incoming.every((dependency) => completedStepIds.has(dependency.fromStepId));

        if (!isReady) {
          continue;
        }

        if (step.type === 'job') {
          const running = await this.repository.updateStep({
            tenantId: run.tenantId,
            projectId: run.projectId,
            runId: run.id,
            stepId: step.stepId,
            state: transitionWorkflowStepState(step.state, 'running'),
            updatedAt: this.now().toISOString(),
          });

          if (running !== null) {
            await this.activateJobStep(run, running);
            steps = await this.repository.listRunSteps(scope);
            progressed = true;
          }
        }

        if (step.type === 'join') {
          const running = await this.repository.updateStep({
            tenantId: run.tenantId,
            projectId: run.projectId,
            runId: run.id,
            stepId: step.stepId,
            state: transitionWorkflowStepState(step.state, 'running'),
            updatedAt: this.now().toISOString(),
          });

          if (running !== null) {
            const completed = await this.repository.updateStep({
              tenantId: run.tenantId,
              projectId: run.projectId,
              runId: run.id,
              stepId: step.stepId,
              state: transitionWorkflowStepState(running.state, 'completed'),
              updatedAt: this.now().toISOString(),
            });

            if (completed !== null) {
              steps = await this.repository.listRunSteps(scope);
              progressed = true;
            }
          }
        }
      }
    }
  }

  private async activateJobStep(run: WorkflowRunRecord, step: WorkflowStepRecord): Promise<void> {
    if (this.jobActivator === undefined || step.jobId !== null) {
      return;
    }

    const result = await this.jobActivator({
      scope: { tenantId: run.tenantId, projectId: run.projectId },
      idempotencyKey: `workflow-step:${run.id}:${step.stepId}`,
      request: {
        metadata: {
          workflowId: run.workflowId,
          workflowVersionId: run.workflowVersionId,
          workflowRunId: run.id,
          workflowStepId: step.stepId,
        },
      },
    });

    await this.repository.updateStep({
      tenantId: run.tenantId,
      projectId: run.projectId,
      runId: run.id,
      stepId: step.stepId,
      jobId: result.job.id,
      updatedAt: this.now().toISOString(),
    });
  }

  private createRunStartedEvent(run: WorkflowRunRecord, timestamp: string): RuntimeEventRecord {
    const occurredAt = new Date(timestamp);

    return {
      id: randomUuidV7LikeId(occurredAt),
      tenantId: run.tenantId,
      projectId: run.projectId,
      eventType: 'workflow.run.started',
      eventVersion: 1,
      orderingKey: `project:${run.projectId}:workflow:${run.workflowId}:run:${run.id}`,
      payload: {
        tenantId: run.tenantId,
        projectId: run.projectId,
        workflowId: run.workflowId,
        workflowVersionId: run.workflowVersionId,
        runId: run.id,
        state: run.state,
        idempotencyKey: run.idempotencyKey,
        startedAt: timestamp,
      },
      occurredAt,
      recordedAt: occurredAt,
    };
  }

  private createRuntimeOutbox(
    event: RuntimeEventRecord,
    timestamp: Date,
  ): RuntimeOutboxRecord {
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

export class InMemoryWorkflowRepository implements WorkflowRepository {
  readonly workflows: WorkflowDefinitionRecord[] = [];
  readonly versions: WorkflowVersionRecord[] = [];
  readonly runs: WorkflowRunRecord[] = [];
  readonly steps: WorkflowStepRecord[] = [];
  readonly stepDependencies: WorkflowStepDependencyRecord[] = [];
  readonly runtimeEvents: RuntimeEventRecord[] = [];
  readonly runtimeOutbox: RuntimeOutboxRecord[] = [];

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

  async findRun(input: TenantProjectScope & { readonly workflowId: string; readonly runId: string }): Promise<WorkflowRunRecord | null> {
    const run = this.runs.find(
      (candidate) =>
        candidate.tenantId === input.tenantId &&
        candidate.projectId === input.projectId &&
        candidate.workflowId === input.workflowId &&
        candidate.id === input.runId,
    );

    return run === undefined ? null : cloneRun(run);
  }

  async listRuns(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowRunRecord[]> {
    return this.runs
      .filter(
        (run) =>
          run.tenantId === input.tenantId &&
          run.projectId === input.projectId &&
          run.workflowId === input.workflowId,
      )
      .map(cloneRun);
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

  async listRunSteps(input: TenantProjectScope & { readonly runId: string }): Promise<WorkflowStepRecord[]> {
    return this.steps
      .filter(
        (step) =>
          step.tenantId === input.tenantId &&
          step.projectId === input.projectId &&
          step.runId === input.runId,
      )
      .map(cloneStep);
  }

  async listRunStepDependencies(input: TenantProjectScope & { readonly runId: string }): Promise<WorkflowStepDependencyRecord[]> {
    return this.stepDependencies
      .filter(
        (dependency) =>
          dependency.tenantId === input.tenantId &&
          dependency.projectId === input.projectId &&
          dependency.runId === input.runId,
      )
      .map(cloneStepDependency);
  }

  async updateStep(input: TenantProjectScope & {
    readonly runId: string;
    readonly stepId: string;
    readonly state?: WorkflowStepRecord['state'];
    readonly jobId?: string | null;
    readonly updatedAt: string;
  }): Promise<WorkflowStepRecord | null> {
    const index = this.steps.findIndex(
      (step) =>
        step.tenantId === input.tenantId &&
        step.projectId === input.projectId &&
        step.runId === input.runId &&
        step.stepId === input.stepId,
    );

    if (index === -1) {
      return null;
    }

    const current = this.steps[index];
    if (current === undefined) {
      return null;
    }

    const updated: WorkflowStepRecord = {
      ...current,
      state: input.state ?? current.state,
      jobId: input.jobId === undefined ? current.jobId : input.jobId,
      updatedAt: input.updatedAt,
    };
    this.steps[index] = cloneStep(updated);

    return cloneStep(updated);
  }

  async createRun(input: WorkflowRepositoryStartRunInput): Promise<WorkflowRunRecord> {
    this.runs.push(cloneRun(input.run));
    this.steps.push(...input.steps.map(cloneStep));
    this.stepDependencies.push(...input.dependencies.map(cloneStepDependency));
    this.runtimeEvents.push(...input.events.map(cloneRuntimeEvent));
    this.runtimeOutbox.push(...input.outbox.map(cloneRuntimeOutbox));
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

  async findRun(input: TenantProjectScope & { readonly workflowId: string; readonly runId: string }): Promise<WorkflowRunRecord | null> {
    const row = await this.db
      .selectFrom('workflow_runs')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('workflow_id', '=', input.workflowId)
      .where('id', '=', input.runId)
      .executeTakeFirst();
    return row === undefined ? null : toWorkflowRunRecord(row);
  }

  async listRuns(input: TenantProjectScope & { readonly workflowId: string }): Promise<WorkflowRunRecord[]> {
    const rows = await this.db
      .selectFrom('workflow_runs')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('workflow_id', '=', input.workflowId)
      .orderBy('created_at', 'asc')
      .execute();
    return rows.map(toWorkflowRunRecord);
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

  async listRunSteps(input: TenantProjectScope & { readonly runId: string }): Promise<WorkflowStepRecord[]> {
    const rows = await this.db
      .selectFrom('workflow_steps')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('run_id', '=', input.runId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(toWorkflowStepRecord);
  }

  async listRunStepDependencies(input: TenantProjectScope & { readonly runId: string }): Promise<WorkflowStepDependencyRecord[]> {
    const rows = await this.db
      .selectFrom('workflow_step_dependencies')
      .selectAll()
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('run_id', '=', input.runId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(toWorkflowStepDependencyRecord);
  }

  async updateStep(input: TenantProjectScope & {
    readonly runId: string;
    readonly stepId: string;
    readonly state?: WorkflowStepRecord['state'];
    readonly jobId?: string | null;
    readonly updatedAt: string;
  }): Promise<WorkflowStepRecord | null> {
    const update: Record<string, unknown> = { updated_at: input.updatedAt };
    if (input.state !== undefined) update.state = input.state;
    if (input.jobId !== undefined) update.job_id = input.jobId;

    const row = await this.db
      .updateTable('workflow_steps')
      .set(update)
      .where('tenant_id', '=', input.tenantId)
      .where('project_id', '=', input.projectId)
      .where('run_id', '=', input.runId)
      .where('step_id', '=', input.stepId)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? null : toWorkflowStepRecord(row);
  }

  async createRun(input: WorkflowRepositoryStartRunInput): Promise<WorkflowRunRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const row = await transaction
        .insertInto('workflow_runs')
        .values(toWorkflowRunRow(input.run))
        .returningAll()
        .executeTakeFirstOrThrow();

      if (input.steps.length > 0) {
        await transaction.insertInto('workflow_steps').values(input.steps.map(toWorkflowStepRow)).execute();
      }

      if (input.dependencies.length > 0) {
        await transaction
          .insertInto('workflow_step_dependencies')
          .values(input.dependencies.map(toWorkflowStepDependencyRow))
          .execute();
      }

      for (const event of input.events) {
        await transaction.insertInto('runtime_events').values(toRuntimeEventRow(event)).execute();
      }

      for (const outbox of input.outbox) {
        await transaction.insertInto('runtime_outbox').values(toRuntimeOutboxRow(outbox)).execute();
      }

      return toWorkflowRunRecord(row);
    });
  }
}

function parseWorkflowGraph(graph: Record<string, unknown>): ParsedWorkflowGraph {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes = rawNodes.flatMap((node): ParsedWorkflowNode[] => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return [];
    }

    const record = node as Record<string, unknown>;
    const stepId = typeof record.id === 'string' ? record.id : null;
    const type = typeof record.type === 'string' ? record.type : 'job';

    if (stepId === null || !isWorkflowStepType(type)) {
      return [];
    }

    return [{ id: stepId, type }];
  });
  const edges = rawEdges.flatMap((edge): ParsedWorkflowEdge[] => {
    if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) {
      return [];
    }

    const record = edge as Record<string, unknown>;

    return typeof record.from === 'string' && typeof record.to === 'string'
      ? [{ from: record.from, to: record.to }]
      : [];
  });

  return { nodes, edges };
}

function isWorkflowStepType(value: string): value is WorkflowStepType {
  return ['job', 'wait_signal', 'approval', 'timer', 'pause', 'join', 'completion'].includes(value);
}

function findInitialReadyJobStepIds(graph: ParsedWorkflowGraph): ReadonlySet<string> {
  const blockedStepIds = new Set(graph.edges.map((edge) => edge.to));
  return new Set(
    graph.nodes
      .filter((node) => node.type === 'job' && !blockedStepIds.has(node.id))
      .map((node) => node.id),
  );
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

function cloneStep(step: WorkflowStepRecord): WorkflowStepRecord {
  return { ...step, metadata: cloneJsonObject(step.metadata) };
}

function cloneStepDependency(dependency: WorkflowStepDependencyRecord): WorkflowStepDependencyRecord {
  return { ...dependency };
}

function cloneRuntimeEvent(event: RuntimeEventRecord): RuntimeEventRecord {
  return { ...event, payload: cloneJsonObject(event.payload) };
}

function cloneRuntimeOutbox(outbox: RuntimeOutboxRecord): RuntimeOutboxRecord {
  return { ...outbox };
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

function toWorkflowStepRecord(row: Selectable<HelixDatabase['workflow_steps']>): WorkflowStepRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    workflowId: row.workflow_id,
    workflowVersionId: row.workflow_version_id,
    runId: row.run_id,
    stepId: row.step_id,
    type: row.type,
    state: row.state,
    jobId: row.job_id,
    metadata: row.metadata_json,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toWorkflowStepDependencyRecord(
  row: Selectable<HelixDatabase['workflow_step_dependencies']>,
): WorkflowStepDependencyRecord {
  return {
    tenantId: row.tenant_id,
    projectId: row.project_id,
    workflowId: row.workflow_id,
    workflowVersionId: row.workflow_version_id,
    runId: row.run_id,
    fromStepId: row.from_step_id,
    toStepId: row.to_step_id,
    createdAt: toIsoString(row.created_at),
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

function toWorkflowStepRow(step: WorkflowStepRecord) {
  return {
    id: step.id,
    tenant_id: step.tenantId,
    project_id: step.projectId,
    workflow_id: step.workflowId,
    workflow_version_id: step.workflowVersionId,
    run_id: step.runId,
    step_id: step.stepId,
    type: step.type,
    state: step.state,
    job_id: step.jobId,
    metadata_json: step.metadata,
    created_at: step.createdAt,
    updated_at: step.updatedAt,
  };
}

function toWorkflowStepDependencyRow(dependency: WorkflowStepDependencyRecord) {
  return {
    tenant_id: dependency.tenantId,
    project_id: dependency.projectId,
    workflow_id: dependency.workflowId,
    workflow_version_id: dependency.workflowVersionId,
    run_id: dependency.runId,
    from_step_id: dependency.fromStepId,
    to_step_id: dependency.toStepId,
    created_at: dependency.createdAt,
  };
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
