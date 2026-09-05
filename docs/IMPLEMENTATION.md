# Implementation status

Work is taking place in the authorised workspace. No services have been deployed and no paid resources have been provisioned.

## Current development foundation

Postgres migration includes organisations, project permissions, independently scoped provider connections, tasks, exclusive claims/executions, immutable candidates, approvals, durable jobs, events, receipts, and preview grants. Commands use short transactions and expected versions. Organisation rows coordinate policy checks; project rows order committed updates. This intentionally conservative locking can be narrowed when scale is measured.

Workflow and publisher run separately from the API. They reconcile stable external operation identities before retries. Uncertain outcomes retain claims and open executions. Expired approvals may be reconciled read-only; new writes require current human authorisation. The fixture external system stores results durably in Postgres for crash/timeout testing.

The Codex app-server adapter has a managed-supervisor transport contract and start/resume/input/interrupt/event methods. Its managed path explicitly forbids inherited host/provider configuration and GitHub write credentials. No sandbox vendor implementation exists yet; those are contract requirements, not tested cloud isolation claims.

The local fixture preview uses a distinct loopback origin, a five-minute grant in a URL fragment, and current project permission checks. It renders fixed application-owned code and labelled snapshot content. A production gateway needs a separate registrable site, scoped routing and live sandbox access. It must not reuse this fixture renderer for untrusted repository code.

## Not yet production-ready

Production identity onboarding/invitations and admin connection management, a chosen managed sandbox/provider credential broker, durable object storage, real GitHub App publisher/reconciliation, live browser evidence, preview gateway, explicit stopped-execution handoff/cancellation UI, and deployment hardening remain integration work. Managed startup fails closed. API/worker DB credentials are local development credentials; separate least-privilege database roles and tenant RLS remain a production gate. Batches and richer task dependency editing need UI/API implementation.

No real external end-to-end check has run. Fixture checks cannot establish cloud isolation, provider billing/entitlement, real PR creation, repository required-check enforcement, or real merge.

## Codex reference

Verified on 2026-09-05 against the official [app-server documentation](https://learn.chatgpt.com/docs/app-server) and [authentication documentation](https://learn.chatgpt.com/docs/auth). The adapter uses initialization, account health, thread and turn methods, streamed events, and interruption. Turn completion is distinct from process quiescence; only a trusted supervisor's stop evidence releases the execution slot. Pin and contract-test the deployed CLI/protocol version before connecting a vendor. Local available CLI: 0.153.2; no existing account was accessed.

## Validation

Validation is in progress; results will be recorded after execution.
