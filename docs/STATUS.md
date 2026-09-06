# Implementation status

The product is under development. No live agent execution, repository publication or deployment has been validated.

## Implemented

- Bun workspaces with React/Vite, Express, Prisma/Postgres and Socket.IO.
- GitHub-only Better Auth, empty-workspace onboarding, projects, invitations and separate contributor/reviewer/merge permissions.
- Collaborative boards, exclusive task claims, version/generation checks, durable jobs/events and approval-bound internal workflows.
- Repository GitHub App discovery and verified attachment, plus versioned execution setup and run-limit enforcement.
- Personal Codex device-login broker, encrypted credential storage, project-scoped connect/disconnect UI and native app-server handshake. Vercel allocation/command/snapshot/stop journaling.
- Repository execution settings UI and 10-minute, zero-paid task-start defaults; managed runs reject paid allowances.
- Light design system, workspace picker, task review panels and expanded project conversations.

Product GitHub OAuth is configured locally. Repository App discovery and Codex completion checks use mocked external protocols. A real Vercel Hobby sandbox passed creation, tool inspection, confirmed stop and removal; application-worker execution remains unvalidated. The personal subscription connection flow is implemented but has not been validated with a real account. Cloud coding remains disabled.

## Next implementation steps

1. Validate personal Codex sign-in with the tester’s account and deploy the broker with separate credential custody.
2. Complete Vercel supervisor with read-only repository import, Codex transport, free-quota enforcement and worker wiring.
3. Private artifact storage and authenticated preview gateway with immutable review evidence.
4. Real GitHub publisher, required-check enforcement, reconciliation and verified merge facts.
5. Confirmed-stop handoff/recovery, skill-management UI, and explicit batch controls.
6. Production isolation, trusted proxy policy, repository revocation/refresh and cross-organisation coordination, retention and pagination. Board snapshots currently include all project tasks/comments; Socket.IO polls per connection.

Pilot policy: one tester on their own repositories, free-only Vercel usage ($0 paid authorization), Paris (`cdg1`), with account eligibility checked before creating resources. Region selection and limits are detailed in [execution setup](EXECUTION-CONNECTIONS.md).

## Verification

The account-linking increment passed 65 local tests (310 assertions), the TypeScript/Vite build and ten browser axe audits. Tests include real private-Postgres policy checks and mocked login journeys, including cancellation, stale leases, revoked access, encrypted storage and zero-paid allowances. The native Codex 0.153.2 initialization/account-read handshake passed without signing in or making a model request. Real account login, cloud execution and publication remain unvalidated.

Audit of `8f7d1ff` (2026-09-06): Prisma model queries, interactive transactions and the isolated SQL locking helper were retained. The board now selects current execution generations without an in-memory distinct over run history. SQL migrations still enforce exclusive claims/executions and candidate immutability. No applied migration was changed.

57 local tests passed (269 assertions) using private Postgres, HTTP/Socket.IO and mocked external providers. An additional client regression checks that a pending snapshot cannot restore a board after access revocation. Prisma validation and the TypeScript/Vite build passed. The authentication browser journey passed eight axe audits using single-page legacy mode after Chromium crashed in axe’s extra-page mode. GitHub OAuth exchanges in that journey are mocked. No real cloud/Codex/GitHub publication end-to-end check has run.

The cleanup removed unused styles/icons, corrected stale setup claims, restored local-only test exclusions and kept local test helpers out of the product typecheck. Shared repository types live in contracts, so the frontend does not import a server adapter.

Tests, scripts, screenshots and historical research remain local-only. The archive is in `.local/docs-archive/20260905`. Existing docs cover architecture, decisions, setup, integration readiness and required design/license provenance; no additional audit document is needed.
