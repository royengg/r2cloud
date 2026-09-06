# Current status

Last reviewed: 6 September 2026. r2cloud is an early development preview. The configured cloud coding pilot works; the complete preview-to-publication-to-merge journey does not yet work end to end.

## Available

- GitHub sign-in, workspace/project creation, invitations and separate contribution, publication-review and merge permissions.
- Shared Kanban boards, task outcomes and acceptance criteria, search/filters, review state and task-linked agent activity.
- GitHub App repository discovery and attachment, repository execution settings, and personal Codex device login.
- Project/task threads with model selection, streamed Markdown replies, activity, inline questions/implementation decisions and Stop.
- One native Codex session per thread, project-aware tools, and no implementation claim for ordinary conversation.
- Authoritative task claims, version/generation checks, bounded execution and durable operation intent.
- Vercel sandbox reuse with two-minute idle expiry and a ten-minute total limit. Account changes and ambiguous failures require confirmed retirement before replacement.
- Public repository checkout, pinned dependency setup, configured checks and immutable Git bundle export. Coding handoff quiesces processes and seals the retained checkout read-only.
- Neon Postgres through Prisma, with explicit pooled application and direct migration connections.
- Direct WebSocket updates, reconnect recovery and fallback HTTP refreshes. Styled selection controls and inset keyboard-focus strokes.

## Still unfinished

1. Validate the unified harness’s live implementation/approval/correction journey, substantive acceptance criteria and interrupted work recovery. Unsaved edits can be lost if a sandbox disappears before export.
2. Authenticated live previews, isolated browser inspection, immutable screenshots, downloadable diff/artifact review and production object storage.
3. Private repository credential custody, the live GitHub publisher, required checks, uncertain-response reconciliation and verified merge updates.
4. Renewable Codex/Vercel credentials, enabled/versioned skills mounting, batch UI and production process/database isolation.
5. Repository revocation/refresh, retention, pagination and shared realtime event fan-out. Board snapshots remain broad and the realtime server polls per subscription.

Publication and merge policy exist internally and have fixture coverage. They must not be presented as working live GitHub integrations. No code has been published or deployed through the product.

## Pilot boundaries

One configured project, public repositories and Vercel Hobby capacity. No paid-plan upgrade, automatic runtime extension, region failover or API-key fallback. Provider credentials can expire and require reconnection. Preview settings do not imply a running preview.

Native conversation checkpoints are private backend data, capped at 4 MiB. Timeline snapshots include up to 1,000 items from the latest 30 turns. Artifact export is capped at 64 MiB and requires 21 GiB free in the current local storage implementation. Production storage and retention remain separate work.

## Verification

- **Local tests:** 87 Postgres/HTTP/Socket.IO and mocked-provider tests passed. They cover ownership, access, approvals, generation checks, streaming, runtime reuse and failure recovery.
- **Browser:** the authentication/product journey passed 13 axe audits. The shared picker passed three additional audits plus keyboard, mobile, modal, reduced-motion and forced-colors checks. Streaming tests cover strict-origin WebSockets, idle request suppression, reconnects, transient HTTP errors and scroll stability. Screen-reader testing was not available.
- **Build:** TypeScript, Vite and design-system validation passed.
- **Real integrations:** repository attachment; subscription-backed Vercel turns; a public-repository checkout/edit/build/export run; native history restoration across sandboxes; two conversation turns sharing a warm sandbox; and confirmed idle cleanup. Warm coding/correction handoff has local and mocked-provider coverage, not a completed live journey.
- **Database:** the Neon cutover preserved the existing data and migration history, verified per-table checksums, and exercised pooled Prisma board reads and interactive transactions.

Tests, scripts, credentials, backups and screenshots remain local-only. Historical proposals are archived locally and in Git history. [Setup](SETUP.md) contains operational instructions; [architecture](ARCHITECTURE.md) describes the current boundaries.
