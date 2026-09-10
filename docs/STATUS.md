# Current status

Last reviewed: 10 September 2026. r2cloud is an early development preview. The configured cloud coding pilot works; the complete preview-to-publication-to-merge journey does not yet work end to end.

## Available

- GitHub sign-in, workspace/project creation, invitations and separate contribution, publication-review and merge permissions.
- Shared Kanban boards, task outcomes and acceptance criteria, search/filters, review state and task-linked agent activity.
- GitHub App repository discovery and attachment, automatic setup for common JavaScript web apps, explicit repository setup overrides, and personal Codex device login. Agents can detect or propose setup in the thread; custom commands require inline approval.
- Personal conversation workspaces within projects, with scoped thread tabs, model/thinking selection, streamed replies, inline decisions and Stop. Thread removal preserves task/execution history.
- One native Codex session per thread, project-aware tools, and no implementation claim for ordinary conversation.
- Slash-skill suggestions in both composers, six bundled instruction files and enabled project instruction skills. Queued turns pin skill versions and contents; the worker mounts them for native Codex selection. Importing custom skill bundles and managing skills through the UI are not implemented.
- Authoritative task claims, version/generation checks, bounded execution and durable operation intent. Independent tasks use isolated checkouts and share live organisation resource limits; blocked/review candidates retain ownership without reserving repository capacity. Implementation admission is checked before and after approval. Owners can return blocked tasks without candidates to Todo once execution is confirmed stopped and pending operations are resolved.
- Authenticated worker-to-Codex streaming, batched timeline persistence and optional credential-free prepared snapshots.
- Vercel sandbox reuse with two-minute idle expiry and a ten-minute total limit. Account changes and ambiguous failures require confirmed retirement before replacement.
- Public repository checkout, pinned dependency setup, configured checks and immutable Git bundle export. Periodic recovery snapshots preserve edits independently of final export; interrupted work returns as a blocked candidate. Coding handoff quiesces processes and seals the retained checkout read-only.
- Saved-change review from threads, task details and the project header: unified file diffs, commit navigation, revision-specific feedback drafts and recorded PR links. Review uses durable artifacts without starting a sandbox; live working-tree diffs and live PR creation/status sync remain unfinished.
- Neon Postgres through Prisma, with explicit pooled application and direct migration connections.
- Direct WebSocket updates, reconnect recovery and fallback HTTP refreshes. Styled selection controls and inset keyboard-focus strokes.

## Still unfinished

1. Broaden live harness validation across repository stacks and substantive acceptance criteria. Recovery preserves the latest completed checkpoint; edits after it can still be lost on abrupt sandbox failure.
2. Deploy and validate the implemented preview gateway, isolated browser inspection and immutable screenshots end to end. Artifact downloads and production object storage remain unimplemented.
3. Private repository credential custody, the live GitHub publisher, required checks, uncertain-response reconciliation and verified merge updates.
4. Renewable Codex/Vercel credentials, skills for the legacy batch executor, batch UI and production process/database isolation.
5. Repository revocation/refresh, retention and pagination beyond agent timelines. Board snapshots remain broad; realtime event polling is shared per project within each API process.

Publication and merge policy exist internally and have fixture coverage. They must not be presented as working live GitHub integrations. No code has been published or deployed through the product.

## Pilot boundaries

One configured project, public repositories and Vercel Hobby capacity. No paid-plan upgrade, automatic runtime extension, region failover or API-key fallback. Provider credentials can expire and require reconnection. Preview settings do not imply a running preview.

Native conversation checkpoints are private backend data, capped at 4 MiB. Timelines load 100 recent items, paginate older history and retrieve updates by committed event cursor. Artifact export is capped at 64 MiB and requires 21 GiB free in the current local storage implementation. Recovery runs approximately every 30 seconds and before tool decisions, with 90 seconds reserved for shutdown before hard expiry. It excludes ignored files and cannot guarantee an atomic snapshot of concurrent writes. Production shared storage, host-loss protection and retention remain separate work.

## Verification

- **Local tests:** 136 Postgres/HTTP/Socket.IO, real local Git and mocked-provider tests passed. They cover ownership, access, approvals, generation checks, streaming, runtime reuse, concurrent waiting threads, shutdown, preview grants and proxy transport, screenshot access, skill parsing/pinning, interrupted snapshots, shallow Git restoration, failed downloads, worker replacement and preservation of earlier candidates after failed corrections. Review tests cover thin bundles, binary/deleted files, unusual paths, commit boundaries and thread access. Setup tests cover manifest detection, pinned package managers, workspace selection, revision caching, concurrent manual overrides and inline configuration approval.
- **Browser:** the authentication/product journey passed 13 axe audits. The shared picker passed three additional audits plus keyboard, mobile, modal, reduced-motion and forced-colors checks. Streaming tests cover strict-origin WebSockets, idle request suppression, reconnects, transient HTTP errors and scroll stability. Screen-reader testing was not available.
- **Build:** TypeScript, Vite and design-system validation passed.
- **Real integrations:** repository attachment; subscription-backed Vercel turns; a public-repository checkout/edit/build/export run; native history restoration across sandboxes; two conversation turns sharing a warm sandbox; and confirmed idle cleanup. A real three-turn journey verified edit → preview → interrupted final export → cold recovery/correction → warm correction. Both corrections passed the repository build, reached Review and rendered the requested headings, with one native conversation across two sandboxes. The test also verified denied writes and rename attempts against the sealed checkout; nothing was published.
- **Git review:** desktop/mobile screenshots, two axe audits, feedback drafts, cache reuse and commit/PR navigation passed. A valid recovery bundle imported in 3.5 seconds and reopened from cache in under 1 ms. Two older persisted bundles were unreadable by Git; review reports that error without altering them.
- **Database:** the Neon cutover preserved the existing data and migration history, verified per-table checksums, and exercised pooled Prisma board reads and interactive transactions.
- **Skills:** both composers passed keyboard and draft-preservation checks, with desktop/mobile screenshots reviewed. Real subscription-backed Codex turns verified native skill injection, switching skills in one warm sandbox and restoring skill instructions plus an isolated board fixture’s context in a fresh sandbox. Test sandboxes were stopped.
- **Preview integration:** real Vercel tests verified private dev-server access, retained preview handoff, isolated Chromium screenshots and blocked access to another sandbox port. The preview control passed rendered checks at mobile and desktop widths. Native Codex restoration and image tool responses passed with a simulated provider. A real Chromium test through a temporary HTTPS tunnel verified Vite HMR without reloading, anonymous-access denial and revocation. A standalone preview of the connected public repository also rendered successfully in Vercel, with a screenshot and verified denial of Codex write access to its checkout. Native Codex browser inspection and retained previews were verified through the recovery/correction journey on the connected Next.js repository. Automatic setup also started the connected repository without a saved profile or task claim, respected its pinned Bun version and passed native browser inspection. Repeated setup reads made no GitHub requests; an intentionally failing dev command returned diagnostics and the preview restarted successfully. Hosted deployment and broader repository-stack coverage remain unfinished.

Tests, scripts, credentials, backups and screenshots remain local-only. Historical proposals are archived locally and in Git history. [Setup](SETUP.md) contains operational instructions; [architecture](ARCHITECTURE.md) describes the current boundaries.
