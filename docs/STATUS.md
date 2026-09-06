# Implementation status

The project-scoped Vercel/Codex pilot worker is implemented and running locally. A real subscription-backed connection-check turn completed in Vercel. The selected repository’s complete checkout/edit/build journey has not yet been validated. Nothing has been published or deployed through the product.

## Implemented

- Bun workspaces with React/Vite, Express, Prisma/Postgres and Socket.IO.
- GitHub sign-in, workspace onboarding, projects, invitations and separate contribution, publication-review and merge permissions.
- GitHub App repository discovery and attachment; the pilot project is connected to `royengg/roy`.
- Personal Codex device login, encrypted credentials and project-scoped disconnect.
- Exclusive task claims, version/generation checks, durable jobs, worker leases and request reconciliation.
- Vercel allocation, restricted repository import, dependency setup, Codex app-server transport, command checks and confirmed stop.
- Model credentials injected by Vercel’s network layer; real tokens never enter sandbox files or command environments. No GitHub write credentials enter the sandbox.
- Immutable Git bundle export to private local artifact storage; correction runs restore the previous candidate. Unknown product acceptance stays explicit and requires human review.
- Task conversation instructions can start a Todo atomically. Agent summaries appear as Codex messages without granting that author project permissions.
- Execution readiness reflects a live worker heartbeat and saved repository settings.

## Pilot limits

One configured project, public repositories, an active Vercel Hobby team, Paris (`cdg1`), two CPUs, ten minutes maximum and no paid allowance. No region failover, automatic resource extension or API-key fallback. Saved credentials expire; renewable worker authentication is unfinished. Artifact export is limited to 64 MiB and requires 21 GiB of free local disk space.

A project conversation remains shared feedback. Open a Todo’s Conversation tab and use **Start work with this message**, or use its existing **Start work** action. During a run, additional messages are saved for subsequent work; live turn steering is not implemented.

## Still unfinished

1. Validate the complete selected-repository coding/build journey and recovery of partial work. Explicit retry now requires confirmed stop and retains exclusive ownership.
2. Authenticated browser previews, downloadable diff/artifact review and production object storage. The pilot currently marks previews unavailable.
3. GitHub installation credential custody for private repositories, publisher, required checks, reconciliation and verified merge integration.
4. Renewable Codex/Vercel credentials, skills mounting, batch UI and production service isolation.
5. Repository revocation/refresh, retention and pagination. Board snapshots still include all project tasks/comments.

## Validation

Local tests cover Postgres/HTTP/Socket.IO invariants and mocked Vercel/Codex execution. Live checks cover Vercel create/stop/remove, the installed Codex 0.147.0 protocol, credential-brokered model access and one subscription-backed connection-check turn without repository edits. Probe sandboxes were removed.

The TypeScript/Vite build and 71 local tests pass. The authentication browser journey passes ten axe audits. Browser checks required pausing the dev processes to stay within shared-VPS thread resources.

Tests, scripts, screenshots, CLI authentication and environment files remain local-only. No deployment or GitHub publication has been validated.
