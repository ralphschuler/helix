import { describe, expect, it } from 'vitest';

import type { AuthContext } from '@helix/contracts';

import { createApiAuthProvider, createApp } from './server/app.js';

describe('control-plane Hono server', () => {
  it('serves health status through the public HTTP interface', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: '@helix/control-plane',
      status: 'ok',
    });
  });

  it('authenticates bearer tokens against project keys and agent tokens for API routes', async () => {
    const projectAuth: AuthContext = {
      tenantId: '01890f42-98c4-7cc3-8a5e-0c567f1d3a77',
      projectId: '01890f42-98c4-7cc3-9a5e-0c567f1d3a78',
      principal: { type: 'api_key', id: 'project-key-1' },
      permissions: ['jobs:create'],
    };
    const agentAuth: AuthContext = {
      ...projectAuth,
      principal: { type: 'agent_token', id: '01890f42-98c4-7cc3-aa5e-0c567f1d3d01' },
      permissions: ['agents:claim'],
    };
    const provider = createApiAuthProvider({
      projectApiKeyAuthenticator: {
        async authenticateProjectApiKey(token) {
          return token === 'project-token' ? projectAuth : null;
        },
      },
      agentTokenAuthenticator: {
        async authenticateAgentToken(token) {
          return token === 'agent-token' ? agentAuth : null;
        },
      },
    });

    await expect(
      provider.authenticate({
        headers: new Headers({ authorization: 'Bearer project-token' }),
        method: 'GET',
        url: new URL('http://localhost/api/v1/jobs'),
      }),
    ).resolves.toEqual(projectAuth);
    await expect(
      provider.authenticate({
        headers: new Headers({ authorization: 'Bearer agent-token' }),
        method: 'POST',
        url: new URL('http://localhost/api/v1/jobs/claim'),
      }),
    ).resolves.toEqual(agentAuth);
    await expect(
      provider.authenticate({
        headers: new Headers({ authorization: 'Bearer unknown-token' }),
        method: 'GET',
        url: new URL('http://localhost/api/v1/jobs'),
      }),
    ).resolves.toBeNull();
  });
});
