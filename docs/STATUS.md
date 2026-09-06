# Implementation status

The project-scoped Vercel/Codex pilot worker is implemented and running locally. A real subscription-backed connection-check turn completed in Vercel. A real Luna run against `royengg/roy` completed checkout, dependency installation, a small edit, the configured build, private artifact export and confirmed stop. The candidate remains in product review; acceptance is unverified. Nothing has been published or deployed through the product.

## Implemented

- Bun workspaces with React/Vite, Express, Prisma/Postgres and Socket.IO.
- Neon Postgres 17.11 in AWS Oregon (`us-west-2`), using a pooled application URL and direct migration URL. Database configuration is explicit; production code has no local Postgres fallback.
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
- Ordered provider events are persisted and deduplicated. Socket.IO uses direct WebSocket connections with exact-origin checks. Invalidations refresh authoritative thread snapshots; reconnects recover the current timeline. Timed thread refreshes run only while disconnected or retrying a failed HTTP read. Only the initiating person can answer or stop a turn. Ambiguous runtime failure requires confirmed stop before replacement.
- Candidate export runs only for a granted implementation with changes. Provider turns do not complete tasks. Native state is checkpointed, repository processes are stopped before export, and interrupted changes are preserved when the remaining runtime permits it.
- Execution readiness reflects a live worker heartbeat and saved repository settings.

## Pilot limits

One configured project, public repositories, an active Vercel Hobby team, Paris (`cdg1`), two CPUs, ten minutes maximum and no paid allowance. No region failover, automatic resource extension or API-key fallback. Saved credentials expire; renewable worker authentication is unfinished. Artifact export is limited to 64 MiB and requires 21 GiB of free local disk space.

Open **Threads**, or a task’s **Conversation** tab, and send a message. A greeting or question does not acquire a task claim. Approve an inline implementation request to grant the named task’s isolated checkout. The pilot reuses a thread’s sandbox and native Codex process for consecutive messages from the same connected account. An idle sandbox is retired after two minutes; the total lifespan remains ten minutes from allocation, including idle time and human decisions. These limits are never extended. After expiry, the next message restores the native conversation in a new sandbox. Stop acknowledgement must precede replacement.

Implementation turns stop agent processes, export the immutable candidate, stop any processes left by checks, and seal the retained checkout read-only before entering review. Follow-up conversation can restart Codex within that sandbox. A new checked task grant verifies the candidate before restoring checkout write access. Idle sandboxes count toward concurrency limits. Account changes, archived threads and disconnected workers trigger confirmed retirement before reuse or replacement.

The [harness implementation plan](HARNESS.md) tracks the completed native-session, streaming and checked-tool work. Live previews and publication remain separate unfinished integrations; no preview URL is fabricated. Session storage is bounded to 4 MiB; timeline snapshots contain up to 1,000 items from the latest 30 turns. Native state is private backend data. A failed turn whose native state could not be recovered requires a new thread instead of silently continuing with missing history.

## Still unfinished

1. Validate substantive task outcomes and recovery of partial work. The first live coding/build path passed; explicit retry requires confirmed stop and retains exclusive ownership.
2. Authenticated browser previews, downloadable diff/artifact review and production object storage. The pilot currently marks previews unavailable.
3. GitHub installation credential custody for private repositories, publisher, required checks, reconciliation and verified merge integration.
4. Renewable Codex/Vercel credentials, skills mounting, batch UI and production service isolation.
5. Repository revocation/refresh, retention and pagination. Board snapshots still include all project tasks/comments.

## Validation

Local tests cover Postgres/HTTP/Socket.IO invariants and mocked Vercel/Codex execution. Live checks cover Vercel create/stop/remove, the installed Codex 0.147.0 protocol, credential-brokered model access and one subscription-backed connection-check turn without repository edits. An earlier real two-turn check verified native conversation restoration across separate sandboxes. The warm-session check then used the project-context tool and recalled the first message in the same sandbox and native process, without creating a task. The follow-up completed in approximately eight seconds; the cold first turn with a tool call took approximately forty-four seconds, so this is a functional check rather than a controlled latency benchmark. Forced idle expiry confirmed the sandbox stopped. The new checked-tool implementation path has database and mocked-provider coverage; a new live coding/approval/correction journey has not yet been run.

The TypeScript/Vite build and 87 local tests pass. Coverage includes message-only turns, duplicate sends, ordered streaming, inline responses, checked implementation claims, warm session reuse, idle resource accounting, account changes, stale-worker fencing, ambiguous stop recovery, the crash between cloud stop and turn completion, and retained checkout verification. Coding handoff and native process restart within a warm sandbox have mocked-provider coverage. The authentication browser journey passes thirteen axe audits, including inline agent questions. Browser checks required pausing the dev processes to stay within shared-VPS thread resources.

The Neon cutover preserved all 42 public tables and 458 rows, with matching per-table data checksums and 76 indexes. The direct connection validates migration history; the pooled connection serves Prisma board reads and interactive transactions. A private local backup is retained. Local Postgres is used only by isolated test helpers and is not an application fallback.

Tests, scripts, screenshots, CLI authentication and environment files remain local-only. No deployment or GitHub publication has been validated.
