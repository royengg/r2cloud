# Implementation status

Work is taking place in the authorised workspace. No services have been deployed and no paid resources have been provisioned.

## Current development foundation

The Bun workspace monorepo uses Prisma 7.10.0 with its Postgres driver adapter and Socket.IO over WebSockets. The Prisma migration includes organisations, project permissions, independently scoped provider connections, tasks, exclusive claims/executions, immutable candidates, approvals, durable jobs, events, receipts, and preview grants. Commands use short transactions and expected versions. Organisation rows coordinate policy checks; project rows order committed updates. This intentionally conservative locking can be narrowed when scale is measured.

Workflow and publisher run separately from the API. They reconcile stable external operation identities before retries. Uncertain outcomes retain claims and open executions. Automatic retries stop after five attempts; stale worker failures cannot mutate a newer task generation. Expired approvals may be reconciled read-only; new writes require current human authorisation. The fixture external system stores results durably in Postgres for crash/timeout testing.

The Codex app-server adapter has a managed-supervisor transport contract and start/resume/input/interrupt/event methods. Its managed path explicitly forbids inherited host/provider configuration and GitHub write credentials. A Vercel Sandbox control plane now exists, with durable allocation/command/snapshot intent and confirmed stop. The complete Codex supervisor and live worker wiring remain pending; these are not tested cloud isolation claims.

The local fixture preview uses a distinct loopback origin, a five-minute grant in a URL fragment, and current project permission checks. It renders fixed application-owned code and labelled snapshot content. A production gateway needs a separate registrable site, scoped routing and live sandbox access. It must not reuse this fixture renderer for untrusted repository code.

## Fresh frontend

The previous dark frontend was replaced in full. Shared components cover organisation/project navigation, the three-column board, scoped composer, task forms and review. The light system uses self-hosted Plus Jakarta Sans, Hugeicons Stroke Rounded, semantic tokens, soft column colors and raised neumorphic buttons. Dialogs/sidebar enter over 180ms, pointer presses sink, and hover lifts are subtle; reduced motion removes movement. Native dialogs provide focus containment and restoration. The public Figma file blocked automated access; only the user-supplied button screenshot informed that treatment.

See [DESIGN.md](../DESIGN.md), [source provenance](DESIGN-SOURCES.md) and [UI verification](UI-VERIFICATION.md).

## Not yet production-ready

Live OAuth configuration, invitations and admin connection management, the Vercel Codex supervisor/provider credential broker, durable object storage, real GitHub App publisher/reconciliation, live browser evidence, preview gateway, explicit stopped-execution handoff/cancellation UI, and deployment hardening remain integration work. Managed startup fails closed. API/worker DB credentials are local development credentials; separate least-privilege database roles and tenant RLS remain a production gate. The batch API supports explicitly named tasks, expected versions, per-task time/budget and a total cap, atomically constrained by concurrency policy. Batch selection and richer dependency editing still need UI implementation.

No real external end-to-end check has run. Fixture checks cannot establish cloud isolation, provider billing/entitlement, real PR creation, repository required-check enforcement, or real merge.

## Codex reference

Verified on 2026-09-05 against the official [app-server documentation](https://learn.chatgpt.com/docs/app-server) and [authentication documentation](https://learn.chatgpt.com/docs/auth). The adapter uses initialization, account health, thread and turn methods, streamed events, and interruption. Turn completion is distinct from process quiescence; only a trusted supervisor's stop evidence releases the execution slot. Pin and contract-test the deployed CLI/protocol version before connecting a vendor. Local available CLI: 0.153.2; no existing account was accessed.

## Validation — executed on 2026-09-05

- `bun test`: 30 passing tests. Real private Postgres schemas, Prisma transactions, database constraints, HTTP routes, Socket.IO reconnect, preview permissions, recovery and fixture journey; three Codex/managed-supervisor contract tests use mocked protocol messages.
- `bun run build`: TypeScript checks and React/Vite production build passed under Bun.
- `bun run test:browser`: passed in Chromium 151 against the built application. Sign-in, start, private separate-origin fixture preview, correction, exact publication approval, separate merge, task creation and feedback. Rebuilt light UI exercised at 1440px, 720px (200% desktop-equivalent reflow), 390px and 320px; no page exceptions or document overflow. Keyboard focus restoration, reduced-motion behavior, a 44px touch action and in-dialog conflict recovery passed. Seven axe WCAG A/AA audits reported no violations in the inspected states. Native browser zoom and screen-reader operation were not independently tested.
- `bun run design:lint`: Google DESIGN.md 0.4.0 reports zero errors and warnings.
- Browser assets are prepared from the existing ARM64 installation into project-private files; no browser download or system modification.

These are local application tests. External execution, application test evidence and repository operations are explicitly fixtures. No real cloud/Codex/GitHub/Neon end-to-end validation has occurred.


## Temporary UI tunnel check

An explicitly requested Cloudflare Quick Tunnel serves the local dev UI, with an exact HTTPS origin allowlist and a separate preview tunnel. The fixture preview process repeatedly hit a Bun 1.4.2 ARM64 native abort behind the tunnel; changing its HTTP renderer did not resolve the crash. The launcher now keeps the board running if this optional fixture preview exits. Remote fixture preview reliability remains unresolved. No runtime crash report or credentials were uploaded. Tunnel-related commits were subsequently pushed under explicit approval. The current authentication increment remains local.


## GitHub identity increment

Better Auth and its Prisma adapter now support GitHub-only product sign-in, database sessions, encrypted provider tokens, verified identity mapping, revocation over HTTP/Socket.IO, and atomic first-workspace creation. New projects start with no repository or AI access. Existing task/review permissions remain authoritative. See [authentication setup and boundaries](AUTHENTICATION.md).

`bun test` passes all 38 tests (151 assertions), including eight new identity/onboarding tests with mocked GitHub endpoints and real Postgres/HTTP/Socket.IO. TypeScript and the production build pass. The new browser journey remains unverified because Chromium hit VPS thread-resource exhaustion; prior fixture browser results above predate this increment. The private Bun environment now disables its runtime transpiler cache after native aborts during test subprocess startup. This is a local workaround, not proof that all ARM64 runtime or preview crashes are resolved.


## Product flow and Vercel increment

The product no longer has a demo participant picker. Normal `bun run dev` starts only API and Vite, seeds nothing, and uses GitHub authentication. Without configured OAuth credentials, the sign-in screen reports that sign-in is unavailable; existing fixture cookies cannot enter the product. Fixtures remain isolated in explicit test servers and private test schemas.

The bottom-left three-dot menu supports Connections and Sign out, outside-click dismissal, Escape/focus restoration and arrow-key navigation. Workspace owners/admins can create additional empty projects, with checked authorisation and idempotency. Review panels no longer display a fabricated website illustration; preview availability and fixture evidence derive from candidate data.

Vercel SDK 3.2.1 handles restricted allocation, non-resuming commands, snapshot/stop and uncertain outcomes through a Postgres journal. This is the cloud control plane, **not yet the complete live coding integration**. See [remaining plan](IMPLEMENTATION-PLAN.md) and [Vercel boundaries](VERCEL-SANDBOX.md).

Verification: 43 tests pass (188 assertions), including real Postgres journal and HTTP policy checks with mocked Vercel/GitHub responses. The real-auth browser journey passes with four axe audits; the fixture task-to-verified-merge browser journey passes with seven axe audits. TypeScript and the React/Vite production build pass. Browser checks succeeded after stopping excess project development processes; no service limits were changed. All external GitHub/Vercel/Codex actions in these checks are simulated. Live sign-in, execution, publication and merge remain unverified.
