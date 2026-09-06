# R2Cloud

A shared product board where people describe outcomes, start coding work, review evidence, and approve changes. A Bun workspace monorepo: React/Vite, Express, Socket.IO, Prisma, and Neon-compatible Postgres.

**Development slice, not a deployed service.** External cloud execution and publication are currently tested with local fixtures; the product does not run simulated agents. It does not call a model, clone repositories, push code, or merge real PRs. Managed integrations fail closed until configured.

## Local development

Install Bun 1.4.2 (the pinned lockfile requires a compatible Bun version), then:

```bash
bun install --frozen-lockfile
bun run db:generate
```

For a running app, configure `DATABASE_URL` (and optionally `DIRECT_URL` for migrations) in an ignored `.env`, using [.env.example](.env.example). Supply an existing Postgres database, then run `bun run db:migrate`. The Unix-socket fallback is for the original private development environment; this checkout does not include a database launcher.

Start `bun run api` and `bun run web` in separate terminals. Open `http://127.0.0.1:5173`. Configure GitHub OAuth using [authentication setup](docs/SETUP.md); without it, sign-in is visibly unavailable and legacy demo cookies are rejected. New accounts create their workspace and first project, then land on an empty board. No seed data or simulated worker starts automatically.

The API binds loopback port 4310. The fixture preview entry point uses 4311. Stop each process with Ctrl+C.

```bash
bun run typecheck
bun run build
bun run design:lint
```

Tests and development scripts are local-only at the user’s request. In the original workspace, `bun run test` runs the private Postgres and mocked-provider suites. A fresh clone does not include those files; verification results and limits are recorded in [status](docs/STATUS.md).

For an explicitly authorised temporary UI tunnel, set `R2_DEV_ORIGIN` to its exact HTTPS origin and `R2_PREVIEW_ORIGIN` to a different HTTPS tunnel forwarding the fixture preview on port 4311. The app origin forwards Vite on port 5173. No wildcard tunnel origins are accepted. The tunnel shows the product sign-in screen. Live OAuth requires matching the callback and trusted origin to that exact URL. Vite blocks project-private toolchain/data directories. Stop the tunnel processes when review ends.

## Structure

```text
apps/web             React + Vite
apps/api             Express + Socket.IO; API/worker/publisher entry points
packages/core        Checked task commands and durable workflow
packages/database    Prisma schema, SQL migrations and client
packages/adapters    Codex and managed-provider seams; labelled fixtures
packages/contracts   Shared domain schemas and integration contracts
```

Bun 1.4.2 is the runtime and package manager; `bun.lock` is the only project lockfile. There is no Turborepo. Prisma is pinned to stable 7.10.0 across CLI/client/adapter. Use the pooled Neon `DATABASE_URL` for application connections and `DIRECT_URL` for Prisma migrations. No Neon database has been provisioned or connected. Never use `prisma db push` to replace the checked SQL migrations: they preserve ownership constraints and the immutable-candidate trigger.

## Documents

- [Implementation status and remaining work](docs/STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Product decisions](docs/DECISIONS.md)
- [Account and repository setup](docs/SETUP.md)
- [Execution and sandbox integration](docs/EXECUTION-CONNECTIONS.md)
- [Design system](DESIGN.md) and [asset sources](docs/DESIGN-SOURCES.md)
