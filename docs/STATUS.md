# Implementation status

The product is under development. No live agent execution, repository publication or deployment has been validated.

## Implemented

- Bun workspaces with React/Vite, Express, Prisma/Postgres and Socket.IO.
- GitHub-only Better Auth, empty-workspace onboarding, projects, invitations and separate contributor/reviewer/merge permissions.
- Collaborative boards, exclusive task claims, version/generation checks, durable jobs/events and approval-bound internal workflows.
- Repository GitHub App discovery and verified attachment, plus versioned execution setup and run-limit enforcement.
- Codex app-server and device-login adapter methods; Vercel allocation/command/snapshot/stop journaling.
- Light design system, workspace picker, task review panels and expanded project conversations.

Product GitHub OAuth is configured locally. Repository App discovery, Codex and Vercel adapter checks use mocked external protocols. Connecting a subscription and running code in the cloud are not available yet.

## Next implementation steps

1. Durable personal Codex login coordinator, encrypted credential custody, revocation and Connections UI.
2. Complete Vercel supervisor with read-only repository import, Codex transport, limits and worker wiring.
3. Private artifact storage and authenticated preview gateway with immutable review evidence.
4. Real GitHub publisher, required-check enforcement, reconciliation and verified merge facts.
5. Confirmed-stop handoff/recovery UI and production isolation, session/proxy and operational hardening.

Pilot policy: one tester on their own repositories, free-only Vercel usage ($0 paid authorization), Paris (`cdg1`), with account eligibility checked before creating resources. Region selection and limits are detailed in [execution setup](EXECUTION-CONNECTIONS.md).

## Verification

Latest backend increment: 55 local tests passed (264 assertions), Prisma migration/generation and TypeScript/Vite build passed. The last full authentication browser journey passed eight axe audits; the fixture task-to-merge journey passed seven. Later UI changes had focused component checks, not a repeated full browser audit. No real cloud/Codex/GitHub publication end-to-end check has run.

Tests, scripts, screenshots and historical research/verification documents are local-only. The archive is in `.local/docs-archive/20260905`. Historical test results are evidence of those revisions, not claims that later changes were retested.
