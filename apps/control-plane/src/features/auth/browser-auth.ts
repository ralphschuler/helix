export const mockBrowserSessionHeader = 'x-helix-mock-session';
export const csrfHeaderName = 'x-csrf-token';
export const csrfCookieName = 'helix_csrf';

const defaultMockSessionId = 'dev-session';

export interface BrowserAuthPrincipal {
  readonly type: 'user';
  readonly id: string;
}

export interface BrowserAuthContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly memberId: string;
  readonly sessionId: string;
  readonly principal: BrowserAuthPrincipal;
  readonly permissions: readonly string[];
}

export interface BrowserAuthRequest {
  readonly headers: Headers;
  readonly method: string;
  readonly url: URL;
}

export interface BrowserAuthProvider {
  authenticate(request: BrowserAuthRequest): Promise<BrowserAuthContext | null>;
}

export interface MockBrowserAuthProviderOptions {
  readonly sessions?: Readonly<Record<string, BrowserAuthContext>>;
}

export type BrowserAuthEnvironment = Readonly<Record<string, string | undefined>>;

export function createDefaultBrowserAuthProvider(
  environment: BrowserAuthEnvironment,
): BrowserAuthProvider {
  if (environment.NODE_ENV === 'production') {
    throw new BrowserAuthConfigurationError(
      'A production browserAuthProvider must be configured explicitly.',
    );
  }

  return createMockBrowserAuthProvider();
}

export function createMockBrowserAuthProvider(
  options: MockBrowserAuthProviderOptions = {},
): BrowserAuthProvider {
  const sessions = new Map(
    Object.entries(options.sessions ?? { [defaultMockSessionId]: defaultMockAuthContext }),
  );

  return {
    async authenticate(request) {
      const sessionId = request.headers.get(mockBrowserSessionHeader);

      if (sessionId === null) {
        return null;
      }

      return sessions.get(sessionId) ?? null;
    },
  };
}

export const defaultMockAuthContext: BrowserAuthContext = {
  tenantId: '01890f42-98c4-7cc3-aa5e-0c567f1d3a79',
  projectId: '01890f42-98c4-7cc3-aa5e-0c567f1d3a7a',
  organizationId: 'stytch-org-dev',
  memberId: 'stytch-member-dev',
  sessionId: defaultMockSessionId,
  principal: {
    type: 'user',
    id: 'stytch-member-dev',
  },
  permissions: ['admin:read'],
};

export interface StytchSessionIdentity {
  readonly tenantId: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly memberId: string;
  readonly sessionId: string;
  readonly permissions: readonly string[];
}

export interface StytchSessionVerifierInput {
  readonly sessionToken: string;
  readonly headers: Headers;
}

export type StytchSessionVerifier = (
  input: StytchSessionVerifierInput,
) => Promise<StytchSessionIdentity | null>;

export interface StytchBrowserAuthProviderOptions {
  readonly projectId: string;
  readonly secret: string;
  readonly sessionCookieName?: string;
  readonly verifySession?: StytchSessionVerifier;
}

export class BrowserAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserAuthConfigurationError';
  }
}

export function createStytchBrowserAuthProvider(
  options: StytchBrowserAuthProviderOptions,
): BrowserAuthProvider {
  assertNonBlank(options.projectId, 'Stytch project ID');
  assertNonBlank(options.secret, 'Stytch secret');

  const sessionCookieName = options.sessionCookieName ?? 'stytch_session';

  return {
    async authenticate(request) {
      const sessionToken = getCookieValue(request.headers, sessionCookieName);

      if (sessionToken === null) {
        return null;
      }

      if (options.verifySession === undefined) {
        throw new BrowserAuthConfigurationError(
          'Stytch session verifier is not configured.',
        );
      }

      const identity = await options.verifySession({
        headers: request.headers,
        sessionToken,
      });

      if (identity === null) {
        return null;
      }

      return {
        tenantId: identity.tenantId,
        projectId: identity.projectId,
        organizationId: identity.organizationId,
        memberId: identity.memberId,
        sessionId: identity.sessionId,
        principal: {
          type: 'user',
          id: identity.memberId,
        },
        permissions: identity.permissions,
      };
    },
  };
}

export function hasValidCsrfToken(headers: Headers): boolean {
  const headerToken = headers.get(csrfHeaderName)?.trim();
  const cookieToken = getCookieValue(headers, csrfCookieName)?.trim();

  return (
    headerToken !== undefined &&
    cookieToken !== undefined &&
    headerToken.length > 0 &&
    headerToken === cookieToken
  );
}

export function getCookieValue(headers: Headers, name: string): string | null {
  const cookieHeader = headers.get('cookie');

  if (cookieHeader === null) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.split('=');

    if (rawName?.trim() === name) {
      return rawValue.join('=').trim();
    }
  }

  return null;
}

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new BrowserAuthConfigurationError(`${label} is required.`);
  }
}
