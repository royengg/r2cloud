# Implementation status

The project-scoped Vercel/Codex pilot worker is implemented and running locally. A real subscription-backed connection-check turn completed in Vercel. A real Luna run against `royengg/roy` completed checkout, dependency installation, a small edit, the configured build, private artifact export and confirmed stop. The candidate remains in product review; acceptance is unverified. Nothing has been published or deployed through the product.

## Implemented

- Bun workspaces with React/Vite, Express, Prisma/Postgres and Socket.IO.
- GitHub sign-in, workspace onboarding, projects, invitations and separate contribution, publication-review and merge permissions.
- GitHub App repository discovery and attachment; the pilot project is connected to `royengg/roy`.
- Personal Codex device login, encrypted credentials and project-scoped disconnect.
- Exclusive task claims, version/generation checks, durable jobs, worker leases and request reconciliation.
- Vercel allocation, restricted repository import, integrity-checked Bun 1.4.2 setup, Codex app-server transport, command checks and confirmed stop. Repository import and frozen dependency installation have been validated against `royengg/roy`.
- Model credentials injected by Vercel’s network layer; real tokens never enter sandbox files or command environments. No GitHub write credentials enter the sandbox.
- Immutable Git bundle export to private local artifact storage; correction runs restore the previous candidate. Unknown product acceptance stays explicit and requires human review.
- Project and task conversations support named threads, per-thread models and instructions, notes, archiving and explicit run actions. A project thread creates and claims a visible task atomically when the contributor starts work. Finished agent replies return to the originating thread before checks and export; subsequent failures do not discard them.
- The Codex harness discovers account models, revalidates selection in the sandbox and pins bounded thread history with each run. Threads cannot bypass ownership or run limits.
- Execution readiness reflects a live worker heartbeat and saved repository settings.

## Pilot limits

One configured project, public repositories, an active Vercel Hobby team, Paris (`cdg1`), two CPUs, ten minutes maximum and no paid allowance. No region failover, automatic resource extension or API-key fallback. Saved credentials expire; renewable worker authentication is unfinished. Artifact export is limited to 64 MiB and requires 21 GiB of free local disk space.

Open **Threads**, or a task’s **Conversation** tab. New threads open directly into a composer with a model picker; the first sent message names the thread. Use **Start work** or **Create task & start work**. **Save note** only records a message. Each later turn uses the retained candidate and a pinned copy of that thread’s history in a fresh isolated Codex session. Native provider-session restoration and live turn steering are not implemented. History is bounded to 40 messages / 64,000 characters per run; create another thread when that limit is reached.

The current run flow is an implementation prototype, not the desired unified agent experience. The [harness source review](HARNESS.md) records the required session, streaming and board-tool changes. Those changes are not implemented yet.

## Still unfinished

1. Validate substantive task outcomes and recovery of partial work. The first live coding/build path passed; explicit retry requires confirmed stop and retains exclusive ownership.
2. Authenticated browser previews, downloadable diff/artifact review and production object storage. The pilot currently marks previews unavailable.
3. GitHub installation credential custody for private repositories, publisher, required checks, reconciliation and verified merge integration.
4. Renewable Codex/Vercel credentials, skills mounting, batch UI and production service isolation.
5. Repository revocation/refresh, retention and pagination. Board snapshots still include all project tasks/comments.

## Validation

Local tests cover Postgres/HTTP/Socket.IO invariants and mocked Vercel/Codex execution. Live checks cover Vercel create/stop/remove, the installed Codex 0.147.0 protocol, credential-brokered model access and one subscription-backed connection-check turn without repository edits. Probe sandboxes were removed.

The TypeScript/Vite build and 76 local tests pass. The authentication browser journey passes twelve axe audits. Browser checks required pausing the dev processes to stay within shared-VPS thread resources.

Tests, scripts, screenshots, CLI authentication and environment files remain local-only. No deployment or GitHub publication has been validated.
