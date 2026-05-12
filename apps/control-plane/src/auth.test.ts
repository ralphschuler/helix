import { describe, expect, it } from 'vitest';

import {
  BrowserAuthConfigurationError,
  createDefaultBrowserAuthProvider,
  createStytchBrowserAuthProvider,
  csrfCookieName,
  csrfHeaderName,
  defaultMockAuthContext,
  mockBrowserSessionHeader,
} from './features/auth/browser-auth.js';
import { createApp } from './server/app.js';

describe('browser auth guard', () => {
  it('rejects unauthenticated admin SSR requests through the public HTTP interface', async () => {
    const response = await createApp().request('/admin');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: 'unauthenticated_browser_session',
    });
  });

  it('loads tenant, organization, member, project, principal, and permission context from a mock browser session', async () => {
    const response = await createApp().request('/admin/api/v1/session', {
      headers: {
        [mockBrowserSessionHeader]: 'dev-session',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tenantId: defaultMockAuthContext.tenantId,
      projectId: defaultMockAuthContext.projectId,
      organizationId: defaultMockAuthContext.organizationId,
      memberId: defaultMockAuthContext.memberId,
      principal: defaultMockAuthContext.principal,
      permissions: defaultMockAuthContext.permissions,
    });
  });

  it('rejects unknown mock browser sessions', async () => {
    const response = await createApp().request('/admin', {
      headers: {
        [mockBrowserSessionHeader]: 'unknown-session',
      },
    });

    expect(response.status).toBe(401);
  });

  it('denies cross-origin browser requests by default', async () => {
    const response = await createApp().request('/admin', {
      headers: {
        origin: 'https://evil.example',
        [mockBrowserSessionHeader]: 'dev-session',
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      error: 'browser_origin_not_allowed',
    });
  });

  it('answers same-origin preflight without requiring a browser session', async () => {
    const response = await createApp().request('http://localhost/admin/api/v1/session', {
      headers: {
        'access-control-request-method': 'POST',
        origin: 'http://localhost',
      },
      method: 'OPTIONS',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost');
    expect(response.headers.get('access-control-allow-headers')).toContain(csrfHeaderName);
  });

  it('rejects browser-authenticated mutations without a matching CSRF token', async () => {
    const response = await createApp().request('/admin/api/v1/session', {
      headers: {
        [mockBrowserSessionHeader]: 'dev-session',
      },
      method: 'POST',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_csrf_token',
    });
  });

  it('lets browser-authenticated mutations reach routing when the CSRF header matches the CSRF cookie', async () => {
    const csrfToken = 'csrf-token-1';
    const response = await createApp().request('/admin/api/v1/session', {
      headers: {
        cookie: `${csrfCookieName}=${csrfToken}`,
        [csrfHeaderName]: csrfToken,
        [mockBrowserSessionHeader]: 'dev-session',
      },
      method: 'POST',
    });

    expect(response.status).toBe(404);
  });

  it('does not default to insecure mock browser auth in production', () => {
    expect(() =>
      createDefaultBrowserAuthProvider({ NODE_ENV: 'production' }),
    ).toThrow(BrowserAuthConfigurationError);
  });

  it('maps a verified Stytch session to the same browser auth provider boundary without network calls', async () => {
    const provider = createStytchBrowserAuthProvider({
      projectId: 'project-test',
      secret: 'secret-test',
      async verifySession(input) {
        expect(input.sessionToken).toBe('stytch-token-1');

        return {
          tenantId: defaultMockAuthContext.tenantId,
          projectId: defaultMockAuthContext.projectId,
          organizationId: 'stytch-org-live',
          memberId: 'stytch-member-live',
          sessionId: 'stytch-session-live',
          permissions: ['admin:read'],
        };
      },
    });

    await expect(
      provider.authenticate({
        headers: new Headers({ cookie: 'stytch_session=stytch-token-1' }),
        method: 'GET',
        url: new URL('http://localhost/admin'),
      }),
    ).resolves.toEqual({
      tenantId: defaultMockAuthContext.tenantId,
      projectId: defaultMockAuthContext.projectId,
      organizationId: 'stytch-org-live',
      memberId: 'stytch-member-live',
      sessionId: 'stytch-session-live',
      principal: {
        type: 'user',
        id: 'stytch-member-live',
      },
      permissions: ['admin:read'],
    });
  });
});
