# Helix

Helix is a SaaS-first durable distributed execution platform: brokered execution, external processor fabric, static DAG workflows, persistent leases, replayable events, scheduling, signals, typed SDKs, and operations tooling.

See [PRD.md](./PRD.md) for product requirements and phased delivery.

## Architecture docs

- [Architecture Decision Records](./docs/adr/README.md)
- [Domain glossary](./docs/glossary.md)
- [Architecture checklist](./docs/architecture-checklist.md)

## Workspace

Yarn workspace layout:

- `apps/control-plane` — SaaS API/control plane shell; owns the v1 `/admin` UI.
- `services/broker` — job, lease, attempt, and routing runtime shell.
- `services/scheduler` — schedules, timers, and wake-up runtime shell.
- `packages/contracts` — shared API/event contract shell.
- `packages/producer-sdk` — TypeScript producer SDK shell.
- `packages/processor-sdk` — TypeScript processor SDK shell.
- `packages/workflow-sdk` — TypeScript workflow SDK shell.

## Local infrastructure

Helix uses Postgres as authoritative state and Redpanda as the Kafka-compatible derived event bus for local/CI smoke checks.

```sh
cp .env.example .env
docker compose up -d
yarn infra:smoke
yarn db:migrate
docker compose down
```

Use `docker compose down -v` only when you intentionally want to delete local Postgres and Redpanda volumes.

## Commands

```sh
yarn install --immutable
yarn docs:check
yarn tooling:check
yarn infra:smoke
yarn db:migrate
yarn check
yarn test
yarn lint
yarn validate
```
