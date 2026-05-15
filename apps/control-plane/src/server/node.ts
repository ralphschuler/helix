import { serve } from '@hono/node-server';

import { createHelixDatabase } from '../db/client.js';
import {
  AgentAuthService,
  KyselyAgentRepository,
} from '../features/agents/agent-auth.js';
import {
  KyselyProjectApiKeyRepository,
  ProjectApiKeyService,
} from '../features/iam/project-api-keys.js';
import type { SecurityAuditSink } from '../features/iam/security-audit.js';
import { KyselyJobRepository, JobService } from '../features/jobs/job-service.js';
import {
  createApiAuthProvider,
  createApp,
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
  const auditSink = new NoopSecurityAuditSink();
  const projectApiKeyService = new ProjectApiKeyService({
    auditSink,
    repository: new KyselyProjectApiKeyRepository(db),
  });
  const agentAuthService = new AgentAuthService({
    auditSink,
    repository: new KyselyAgentRepository(db),
  });

  return {
    apiAuthProvider: createApiAuthProvider({
      projectApiKeyAuthenticator: projectApiKeyService,
      agentTokenAuthenticator: agentAuthService,
    }),
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
