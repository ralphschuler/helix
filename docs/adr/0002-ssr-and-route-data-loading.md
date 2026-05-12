# ADR 0002: SSR and Route Data Loading

## Status

Accepted.

## Context

The control-plane app needs an authenticated admin experience with predictable route data and minimal client/server drift. The PRD chooses React streaming SSR, Vite client/SSR entries, TanStack Router, TanStack Query, and Zustand only for local UI state.

## Decision

- Use React streaming SSR for the `/admin` browser experience.
- Use Vite client and SSR entries for bundling and local development.
- Use TanStack Router for route matching and route loaders.
- Use TanStack Query for server data prefetch, dehydration, client rehydration, and cache ownership.
- Use Zustand only for local UI state such as panels, filters, and ephemeral layout state.
- Durable state must be loaded through versioned server APIs/contracts, not from client-only stores.

## Rejected options

- SPA-only admin as the first topology, because protected SSR/data loading is part of the platform foundation.
- Direct database access from UI modules, because browser/admin features must use stable server interfaces.
- Storing durable workflow/job state in Zustand, because Postgres-backed server state is authoritative.

## Consequences

- SSR route loaders become an explicit public-ish integration boundary for admin features.
- Hydration behavior needs tests once the app scaffold exists.
- Feature folders should keep API/server/db/ui/test boundaries clear.

## Validation

- Future SSR smoke tests cover route matching, loader prefetch, React Query dehydrate/rehydrate, protected admin route handling, and hydration mismatch prevention.
- Code review rejects durable server truth stored in local UI state.
- Contract tests verify browser APIs return data through versioned schemas.

## Stop/rollback point

Stop if protected admin routes cannot render without leaking unauthenticated data, if hydration changes durable server state, or if route loaders bypass server authorization.
