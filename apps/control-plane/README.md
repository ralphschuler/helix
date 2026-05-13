# @helix/control-plane

SaaS API, control-plane application, and v1 `/admin` UI shell.

## Implemented shell

- Hono app factory with `GET /health`.
- Server-protected `/admin` route rendered by React streaming SSR.
- Browser auth provider boundary with deterministic mock sessions and Stytch adapter seam.
- Strict browser origin defaults plus double-submit CSRF checks for browser-authenticated mutations.
- TanStack Router route for `/admin`.
- React Query route data prefetch plus dehydrated state for client hydration.
- Vite client and SSR entry points.
- Repo-owned SQL migration runner plus tenant/org/project/audit/retention base schema.
- Runtime transactional outbox writer seam for committing durable state changes and scoped outbox events together.

## Commands

```sh
yarn workspace @helix/control-plane dev
yarn workspace @helix/control-plane build
yarn workspace @helix/control-plane db:migrate
yarn workspace @helix/control-plane test
# focused runtime outbox checks:
yarn workspace @helix/control-plane test -- outbox
yarn workspace @helix/control-plane check
yarn workspace @helix/control-plane lint
```

`dev` runs the Vite asset server. The Hono Node entry is `src/server/node.ts`; production bundling/wiring can mount the same `createApp()` factory.

For tests/local integration, the default mock browser session accepts `x-helix-mock-session: dev-session`. Real Stytch validation is isolated behind the auth provider seam, so CI does not need Stytch secrets or network calls.
