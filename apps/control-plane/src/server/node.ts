import { serve } from '@hono/node-server';

import { createHelixDatabase } from '../db/client.js';
import {
  KyselyProjectApiKeyRepository,
  ProjectApiKeyService,
} from '../features/iam/project-api-keys.js';
import type { SecurityAuditSink } from '../features/iam/security-audit.js';
import { KyselyJobRepository, JobService } from '../features/jobs/job-service.js';
import {
  createApp,
  createProjectApiKeyApiAuthProvider,
  type CreateAppOptions,
} from './app.js';

export interface StartServerInput {
  readonly port?: number;
  readonly appOptions?: CreateAppOptions;
}

export function startServer(input: StartServerInput = {}) {
  const port = input.port ?? Number.parseInt(process.env.PORT ?? '3000', 10);

  return serve({
    fetch: createApp(input.appOptions ?? createDefaultAppOptions()).fetch,
    port,
  });
}

function createDefaultAppOptions(): CreateAppOptions {
  const db = createHelixDatabase();
  const projectApiKeyService = new ProjectApiKeyService({
    auditSink: new NoopSecurityAuditSink(),
    repository: new KyselyProjectApiKeyRepository(db),
  });

  return {
    apiAuthProvider: createProjectApiKeyApiAuthProvider(projectApiKeyService),
    jobService: new JobService({ repository: new KyselyJobRepository(db) }),
  };
}

class NoopSecurityAuditSink implements SecurityAuditSink {
  async record(): Promise<void> {
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
