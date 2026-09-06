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
- Project/task threads have one Send action, a model picker, streamed Markdown replies, expandable activity, inline questions/approvals and Stop. Active task threads appear on the board without implying implementation ownership.
- Each thread retains its native Codex identity and rollout state across bounded Vercel sandboxes. Ordinary messages queue durable agent turns without creating tasks, claims, implementation runs or execution jobs.
- Project-scoped tools read the board and public repository files, ask questions, propose tasks and request implementation. The existing checked service acquires the claim before repository checkout/install. The agent gets no publication tool or GitHub write credential.
- Ordered provider events are persisted and deduplicated. Socket.IO invalidations refresh authoritative thread snapshots; reconnects recover the current timeline. Only the initiating person can answer or stop a turn. Ambiguous runtime failure requires confirmed stop before replacement.
- Candidate export runs only for a granted implementation with changes. Provider turns do not complete tasks. Native state is checkpointed, repository processes are stopped before export, and interrupted changes are preserved when the remaining runtime permits it.
- Execution readiness reflects a live worker heartbeat and saved repository settings.

## Pilot limits

One configured project, public repositories, an active Vercel Hobby team, Paris (`cdg1`), two CPUs, ten minutes maximum and no paid allowance. No region failover, automatic resource extension or API-key fallback. Saved credentials expire; renewable worker authentication is unfinished. Artifact export is limited to 64 MiB and requires 21 GiB of free local disk space.

Open **Threads**, or a task’s **Conversation** tab, and send a message. A greeting or question does not acquire a task claim. Approve an inline implementation request to grant the named task’s isolated checkout. The pilot starts a lightweight sandbox per turn and restores the native session; it does not keep idle sandboxes running. Each turn has a ten-minute limit, including time spent waiting for human input. Stop acknowledgement must precede another turn.

The [harness implementation plan](HARNESS.md) tracks the completed native-session, streaming and checked-tool work. Live previews and publication remain separate unfinished integrations; no preview URL is fabricated. Session storage is bounded to 4 MiB; timeline snapshots contain up to 1,000 items from the latest 30 turns. Native state is private backend data. A failed turn whose native state could not be recovered requires a new thread instead of silently continuing with missing history.

## Still unfinished

1. Validate substantive task outcomes and recovery of partial work. The first live coding/build path passed; explicit retry requires confirmed stop and retains exclusive ownership.
2. Authenticated browser previews, downloadable diff/artifact review and production object storage. The pilot currently marks previews unavailable.
3. GitHub installation credential custody for private repositories, publisher, required checks, reconciliation and verified merge integration.
4. Renewable Codex/Vercel credentials, skills mounting, batch UI and production service isolation.
5. Repository revocation/refresh, retention and pagination. Board snapshots still include all project tasks/comments.

## Validation

Local tests cover Postgres/HTTP/Socket.IO invariants and mocked Vercel/Codex execution. Live checks cover Vercel create/stop/remove, the installed Codex 0.147.0 protocol, credential-brokered model access and one subscription-backed connection-check turn without repository edits. A real two-turn check used the project-context tool, restored the same native Codex thread in a second Vercel sandbox and recalled the first message without creating a task. Both sessions were stopped. The new checked-tool implementation path has database and mocked-provider coverage; a new live coding/approval/correction journey has not yet been run.

The TypeScript/Vite build and 80 local tests pass. New tests cover message-only turns, duplicate sends, ordered streaming, inline responses, checked implementation claims and native session teardown. The authentication browser journey passes thirteen axe audits, including inline agent questions. Browser checks required pausing the dev processes to stay within shared-VPS thread resources.

Tests, scripts, screenshots, CLI authentication and environment files remain local-only. No deployment or GitHub publication has been validated.
