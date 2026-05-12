import { describe, expect, it } from 'vitest';

import {
  createMockBrowserAuthProvider,
  csrfCookieName,
  csrfHeaderName,
  defaultMockAuthContext,
  mockBrowserSessionHeader,
} from './features/auth/browser-auth.js';
import { createApp } from './server/app.js';

function roleAdminHeaders(sessionId = 'role-admin'): Record<string, string> {
  const csrfToken = 'csrf-token-1';

  return {
    'content-type': 'application/json',
    cookie: `${csrfCookieName}=${csrfToken}`,
    [csrfHeaderName]: csrfToken,
    [mockBrowserSessionHeader]: sessionId,
  };
}

describe('admin custom role API', () => {
  it('creates, lists, updates, and disables a custom role through the authenticated admin API', async () => {
    const app = createApp({
      browserAuthProvider: createMockBrowserAuthProvider({
        sessions: {
          'role-admin': {
            ...defaultMockAuthContext,
            sessionId: 'role-admin',
            permissions: [
              'admin:read',
              'iam:roles:read',
              'iam:roles:write',
              'agents:register',
              'agents:claim',
            ],
          },
        },
      }),
    });

    const createResponse = await app.request('/admin/api/v1/iam/custom-roles', {
      body: JSON.stringify({
        slug: 'processor-operator',
        name: 'Processor operator',
        permissions: ['agents:register'],
      }),
      headers: roleAdminHeaders(),
      method: 'POST',
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created).toMatchObject({
      customRole: {
        tenantId: defaultMockAuthContext.tenantId,
        slug: 'processor-operator',
        name: 'Processor operator',
        permissions: ['agents:register'],
        disabledAt: null,
      },
    });
    expect(created.customRole.id).toEqual(expect.any(String));
    expect(created.customRole.createdAt).toEqual(expect.any(String));

    const listResponse = await app.request('/admin/api/v1/iam/custom-roles', {
      headers: {
        [mockBrowserSessionHeader]: 'role-admin',
      },
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      customRoles: [created.customRole],
    });

    const updateResponse = await app.request(
      `/admin/api/v1/iam/custom-roles/${created.customRole.id}`,
      {
        body: JSON.stringify({
          name: 'Processor operator v2',
          permissions: ['agents:register', 'agents:claim'],
        }),
        headers: roleAdminHeaders(),
        method: 'PATCH',
      },
    );

    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      customRole: {
        id: created.customRole.id,
        name: 'Processor operator v2',
        permissions: ['agents:register', 'agents:claim'],
        disabledAt: null,
      },
    });

    const disableResponse = await app.request(
      `/admin/api/v1/iam/custom-roles/${created.customRole.id}`,
      {
        headers: roleAdminHeaders(),
        method: 'DELETE',
      },
    );

    expect(disableResponse.status).toBe(200);
    const disabled = await disableResponse.json();
    expect(disabled).toMatchObject({
      customRole: {
        id: created.customRole.id,
        disabledAt: expect.any(String),
      },
    });
  });

  it('rejects unauthorized role mutations and privilege escalation attempts', async () => {
    const app = createApp({
      browserAuthProvider: createMockBrowserAuthProvider({
        sessions: {
          readOnly: {
            ...defaultMockAuthContext,
            sessionId: 'readOnly',
            permissions: ['admin:read', 'iam:roles:read'],
          },
          writerWithoutGrant: {
            ...defaultMockAuthContext,
            sessionId: 'writerWithoutGrant',
            permissions: ['admin:read', 'iam:roles:write'],
          },
        },
      }),
    });

    const readOnlyResponse = await app.request('/admin/api/v1/iam/custom-roles', {
      body: JSON.stringify({
        slug: 'read-only',
        name: 'Read only',
        permissions: ['iam:roles:read'],
      }),
      headers: roleAdminHeaders('readOnly'),
      method: 'POST',
    });

    expect(readOnlyResponse.status).toBe(403);
    await expect(readOnlyResponse.json()).resolves.toMatchObject({
      error: 'missing_permission',
    });

    const escalationResponse = await app.request('/admin/api/v1/iam/custom-roles', {
      body: JSON.stringify({
        slug: 'escalates',
        name: 'Escalates',
        permissions: ['agents:revoke'],
      }),
      headers: roleAdminHeaders('writerWithoutGrant'),
      method: 'POST',
    });

    expect(escalationResponse.status).toBe(403);
    await expect(escalationResponse.json()).resolves.toMatchObject({
      error: 'permission_privilege_escalation',
    });
  });
});
