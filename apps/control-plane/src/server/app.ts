import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { renderAdminDocumentStream } from '../entry-server.js';
import { UnmappedStripeCustomerError } from '../features/billing/billing-service.js';
import {
  StripeWebhookPayloadError,
  StripeWebhookSignatureError,
} from '../features/billing/stripe-adapter.js';
import type { BillingWebhookHandler } from '../features/billing/stripe-webhook.js';
import {
  createDefaultBrowserAuthProvider,
  hasValidCsrfToken,
  type BrowserAuthContext,
  type BrowserAuthProvider,
} from '../features/auth/browser-auth.js';

type AppEnvironment = {
  Variables: {
    browserAuth: BrowserAuthContext;
  };
};

export interface CreateAppOptions {
  readonly browserAuthProvider?: BrowserAuthProvider;
  readonly allowedBrowserOrigins?: readonly string[];
  readonly stripeBillingWebhookHandler?: BillingWebhookHandler;
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const adminReadPermission = 'admin:read';

export function createApp(options: CreateAppOptions = {}): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();
  const browserAuthProvider =
    options.browserAuthProvider ?? createDefaultBrowserAuthProvider(process.env);
  const browserSecurity = createBrowserSecurityMiddleware({
    allowedOrigins: options.allowedBrowserOrigins ?? [],
    browserAuthProvider,
  });

  app.get('/health', (context) =>
    context.json({
      service: '@helix/control-plane',
      status: 'ok',
    }),
  );

  app.post('/webhooks/stripe', async (context) => {
    if (options.stripeBillingWebhookHandler === undefined) {
      return context.json({ error: 'stripe_webhook_not_configured' }, 503);
    }

    try {
      const result = await options.stripeBillingWebhookHandler.handle({
        rawBody: await context.req.text(),
        signatureHeader: context.req.header('stripe-signature') ?? null,
      });

      return context.json({ received: true, duplicate: result.duplicate });
    } catch (error) {
      if (
        error instanceof StripeWebhookSignatureError ||
        error instanceof StripeWebhookPayloadError
      ) {
        return context.json({ error: 'invalid_stripe_webhook' }, 400);
      }

      if (error instanceof UnmappedStripeCustomerError) {
        return context.json({ error: 'unmapped_stripe_customer' }, 422);
      }

      throw error;
    }
  });

  app.use('/admin', browserSecurity);
  app.use('/admin/*', browserSecurity);
  app.use('/admin', requireBrowserPermission(adminReadPermission));
  app.use('/admin/*', requireBrowserPermission(adminReadPermission));

  app.get('/admin/api/v1/session', (context) =>
    context.json(toSessionResponse(context.get('browserAuth'))),
  );

  app.get('/admin', renderAdminRoute);
  app.get('/admin/*', renderAdminRoute);

  return app;
}

function requireBrowserPermission(
  permission: string,
): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const browserAuth = context.get('browserAuth');

    if (!browserAuth.permissions.includes(permission)) {
      return context.json({ error: 'missing_admin_read_permission' }, 403);
    }

    await next();
  };
}

async function renderAdminRoute(context: Context<AppEnvironment>): Promise<Response> {
  const stream = await renderAdminDocumentStream(
    new URL(context.req.url).pathname,
  );

  return new Response(stream, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

function createBrowserSecurityMiddleware(input: {
  readonly allowedOrigins: readonly string[];
  readonly browserAuthProvider: BrowserAuthProvider;
}): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const originDecision = getBrowserOriginDecision(
      context.req.raw,
      input.allowedOrigins,
    );

    if (!originDecision.allowed) {
      return context.json(
        {
          error: 'browser_origin_not_allowed',
        },
        403,
      );
    }

    if (context.req.method === 'OPTIONS') {
      return createPreflightResponse(originDecision);
    }

    const browserAuth = await input.browserAuthProvider.authenticate({
      headers: context.req.raw.headers,
      method: context.req.method,
      url: new URL(context.req.url),
    });

    if (browserAuth === null) {
      return context.json(
        {
          error: 'unauthenticated_browser_session',
        },
        401,
        {
          'www-authenticate': 'HelixBrowserSession realm="admin"',
        },
      );
    }

    if (
      unsafeMethods.has(context.req.method) &&
      !hasValidCsrfToken(context.req.raw.headers)
    ) {
      return context.json(
        {
          error: 'invalid_csrf_token',
        },
        403,
      );
    }

    context.set('browserAuth', browserAuth);
    await next();
    applyCorsHeaders(context, originDecision);
  };
}

function toSessionResponse(authContext: BrowserAuthContext) {
  return {
    tenantId: authContext.tenantId,
    projectId: authContext.projectId,
    organizationId: authContext.organizationId,
    memberId: authContext.memberId,
    principal: authContext.principal,
    permissions: authContext.permissions,
  };
}

function getBrowserOriginDecision(
  request: Request,
  allowedOrigins: readonly string[],
):
  | { readonly allowed: true; readonly origin: string | null }
  | { readonly allowed: false } {
  const origin = request.headers.get('origin');

  if (origin === null) {
    return { allowed: true, origin: null };
  }

  const requestOrigin = new URL(request.url).origin;

  if (origin === requestOrigin || allowedOrigins.includes(origin)) {
    return { allowed: true, origin };
  }

  return { allowed: false };
}

function createPreflightResponse(
  originDecision: { readonly allowed: true; readonly origin: string | null },
): Response {
  const headers = new Headers({
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      'content-type,x-csrf-token,x-helix-mock-session',
    vary: 'Origin',
  });

  if (originDecision.origin !== null) {
    headers.set('access-control-allow-origin', originDecision.origin);
  }

  return new Response(null, {
    headers,
    status: 204,
  });
}

function applyCorsHeaders(
  context: Context<AppEnvironment>,
  originDecision: { readonly allowed: true; readonly origin: string | null },
): void {
  if (originDecision.origin === null) {
    return;
  }

  context.res.headers.set('access-control-allow-origin', originDecision.origin);
  context.res.headers.append('vary', 'Origin');
}
