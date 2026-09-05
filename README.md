# R2Cloud

A shared product board where people describe outcomes, start coding work, review evidence, and approve changes. A Bun workspace monorepo: React/Vite, Express, Socket.IO, Prisma, and Neon-compatible Postgres.

**Development slice, not a deployed service.** The local app uses visibly labelled fixtures for cloud execution, preview content, and GitHub operations. It does not call a model, clone repositories, push code, or merge real PRs. Managed integrations fail closed until configured.

## Local development

Workspace: `/home/paseo-agent/workspace/r2cloud`.

```bash
source scripts/env.sh  # this VPS: load its private ARM64 toolchain and project-local Bun
bun install --frozen-lockfile
bun run db:start
bun run db:setup
bun run dev
```

Open `http://127.0.0.1:5173`. The product opens with GitHub sign-in. Configure this project's OAuth app using [authentication setup](docs/AUTHENTICATION.md); without configuration, sign-in is visibly unavailable and legacy demo cookies are rejected. New accounts create their workspace and first project, then land on an empty board. No seed data or simulated worker is started by normal development.

Postgres uses existing ARM64 binaries with project-private storage and a Unix socket only. No existing database service is used. The API binds loopback port 4310; the fixture-only preview test uses 4311. Stop the app with Ctrl+C and the database with `bun run db:stop`.

```bash
bun run typecheck
bun test
bun run build
bun run design:lint
bun run test:browser
```

Tests require the private database to be running and create/drop only their own randomly named schema. Browser checks use `R2_BROWSER_PATH` or this VPS’s existing ARM64 Chromium. On this VPS, run `python3 scripts/prepare-browser.py` once to prepare a project-private copy with compatible existing libraries; no browser download or system modification is needed.

For an explicitly authorised temporary UI tunnel, set `R2_DEV_ORIGIN` to its exact HTTPS origin and `R2_PREVIEW_ORIGIN` to a different HTTPS tunnel forwarding the fixture preview on port 4311. The app origin forwards Vite on port 5173. No wildcard tunnel origins are accepted. The tunnel shows the product sign-in screen. Live OAuth requires matching the callback and trusted origin to that exact URL. Vite blocks project-private toolchain/data directories. Stop the tunnel processes when review ends.

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

- [Remaining delivery plan](docs/DELIVERY-PLAN.md)
- [Team and repository setup](docs/TEAM-AND-REPOSITORY-SETUP.md)
- [Vercel Sandbox](docs/VERCEL-SANDBOX.md)
- [GitHub authentication](docs/AUTHENTICATION.md)
- [Design system](DESIGN.md)
- [UI verification](docs/UI-VERIFICATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Confirmed decisions](docs/DECISIONS.md)
- [Inherited source review](docs/RESEARCH.md)
- [Implementation and validation](docs/IMPLEMENTATION.md)

The recovered architecture is a target design, not a claim that every boundary has shipped. Publication requires approval for an exact immutable candidate; merge is a separate action. A finished agent turn or an open PR never completes a task.
