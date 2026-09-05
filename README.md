# R2Cloud

A shared product board where people describe outcomes, start coding work, review evidence, and approve changes. A Bun workspace monorepo: React/Vite, Express, Socket.IO, Prisma, and Neon-compatible Postgres.

**Development slice, not a deployed service.** The local app uses visibly labelled fixtures for cloud execution, preview content, and GitHub operations. It does not call a model, clone repositories, push code, or merge real PRs. Managed integrations fail closed until configured.

## Local development

Workspace: `/home/paseo-agent/workspace/r2cloud`.

```bash
source scripts/env.sh  # this VPS: load its private ARM64 toolchain and project-local Bun
bun install --frozen-lockfile
bun run db:start
R2_MODE=fixture bun run db:setup
bun run dev
```

Open `http://127.0.0.1:5173`. Select a fixture participant: Maya can contribute/review/authorise merge, Alex can contribute, and Sam can view. This local participant selector is development authentication, not production sign-in.

Postgres uses existing ARM64 binaries with project-private storage and a Unix socket only. No existing database service is used. API and previews bind loopback ports 4310 and 4311. Stop the app with Ctrl+C and the database with `bun run db:stop`.

```bash
bun run typecheck
bun test
bun run build
bun run test:browser
```

Tests require the private database to be running and create/drop only their own randomly named schema. Browser checks use `R2_BROWSER_PATH` or this VPS’s existing ARM64 Chromium. On this VPS, run `python3 scripts/prepare-browser.py` once to prepare a project-private copy with compatible existing libraries; no browser download or system modification is needed.

## Structure

```text
apps/web             React + Vite
apps/api             Express + Socket.IO; API/worker/publisher entry points
packages/core        Checked task commands and durable workflow
packages/database    Prisma schema, SQL migrations and client
packages/adapters    Codex and managed-provider seams; labelled fixtures
packages/contracts   Shared domain schemas and integration contracts
tests                Postgres invariants and adapter contracts
```

Bun 1.4.2 is the runtime and package manager; `bun.lock` is the only project lockfile. There is no Turborepo. Prisma is pinned to stable 7.10.0 across CLI/client/adapter. Use the pooled Neon `DATABASE_URL` for application connections and `DIRECT_URL` for Prisma migrations. No Neon database has been provisioned or connected. Never use `prisma db push` to replace the checked SQL migrations: they preserve ownership constraints and the immutable-candidate trigger.

## Documents

- [Architecture](docs/ARCHITECTURE.md)
- [Confirmed decisions](docs/DECISIONS.md)
- [Inherited source review](docs/RESEARCH.md)
- [Implementation and validation](docs/IMPLEMENTATION.md)

The recovered architecture is a target design, not a claim that every boundary has shipped. Publication requires approval for an exact immutable candidate; merge is a separate action. A finished agent turn or an open PR never completes a task.
