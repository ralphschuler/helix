# @helix/control-plane

SaaS API, control-plane application, and v1 `/admin` UI shell.

## Implemented shell

- Hono app factory with `GET /health`.
- Protected-ready `/admin` route rendered by React streaming SSR.
- TanStack Router route for `/admin`.
- React Query route data prefetch plus dehydrated state for client hydration.
- Vite client and SSR entry points.
- Repo-owned SQL migration runner plus tenant/org/project/audit/retention base schema.

## Commands

```sh
yarn workspace @helix/control-plane dev
yarn workspace @helix/control-plane build
yarn workspace @helix/control-plane db:migrate
yarn workspace @helix/control-plane test
yarn workspace @helix/control-plane check
yarn workspace @helix/control-plane lint
```

`dev` runs the Vite asset server. The Hono Node entry is `src/server/node.ts`; production bundling/wiring can mount the same `createApp()` factory.
