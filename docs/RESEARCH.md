# Reference review

Reviewed on 2026-09-05. Scope: repository READMEs, architecture documentation where available, repository trees, and selected implementation paths. This is an architecture-oriented source review, not a complete code audit. None of these projects was installed or run. No third-party implementation code was incorporated into this proposal.

GitHub branch heads were resolved through the public tree API. Code observations below use those pinned revisions. Some README/architecture pages were initially read from live `main`; those documentation observations are date-bound rather than a guarantee that every viewed page was from the exact pinned commit. Official provider/platform documentation is likewise a point-in-time reference.

## T3 Code

Revision: `761d4bac1c238ea7af4dd36b56719ad5e30771c3`.

The [README](https://github.com/pingdotgg/t3code) presents a control surface for existing agent harnesses. The [architecture overview](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md) puts files, Git and provider processes on the execution server and describes durable orchestration intent.

In the inspected [OrchestrationEngine transaction](https://github.com/pingdotgg/t3code/blob/761d4bac1c238ea7af4dd36b56719ad5e30771c3/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L232), event persistence, projection and command receipt are grouped before subscriber publication. This supports borrowing the principle of committing authoritative state before notifying clients. The proposed product uses relational domain state plus an outbox; full event sourcing is not required to preserve that principle.

Useful patterns: provider adapters, client/execution separation, command deduplication, and explicit distinction between accepted intent and completed side effects. A local serial command engine alone does not establish organisation-wide exclusive ownership across multiple service instances.

## Vibe Kanban

Revision: `4deb7eca8f381f7cbc1f9d15515a9ab8f8009053`.

The [README](https://github.com/BloopAI/vibe-kanban) connects board planning to coding workspaces, review and browser previews. It also currently announces that Vibe Kanban is sunsetting; that makes it useful as a design reference without assuming ongoing upstream maintenance.

The inspected [worktree manager](https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/worktree-manager/src/worktree_manager.rs#L15) uses process-local locks keyed by worktree path and shares those locks between creation and cleanup. This is concrete local lifecycle coordination; it is not evidence of a distributed task-claim guarantee.

The [executor definitions](https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/executors/src/executors/mod.rs) expose provider distinctions and capability/configuration handling, including MCP configuration differences. Borrow the task → workspace → review flow and explicit executor capabilities. Enforce claims and approvals in the new product's shared authority.

## Agent Orchestrator

Revision: `d06b2162d0a84887d67105cae392184255032e21`.

The [README](https://github.com/Untrivial-ai/agent-orchestrator) distinguishes project-level planning from focused worker execution. Its [architecture document](https://github.com/Untrivial-ai/agent-orchestrator/blob/main/docs/architecture.md) describes durable observed facts, derived UI status, lifecycle coordination and recovery. It explicitly distinguishes a failed observation from proof that a process is gone.

The current repository also contains cloud code. The inspected [sandbox provider interface](https://github.com/Untrivial-ai/agent-orchestrator/blob/d06b2162d0a84887d67105cae392184255032e21/cloud/internal/sandbox/provider.go) includes provider-neutral lifecycle operations, session lookup and explicit unknown/not-found behaviour. Therefore it would be inaccurate to characterise the entire repository as only a desktop implementation based on its README positioning.

Borrow project planning versus task execution, explicit lifecycle transitions, and reconciliation against external facts. The proposal keeps product task completion separate from agent/PR status so a PM can distinguish a technical event from an accepted outcome. The presence of cloud abstractions does not prove their production isolation or fitness for this proposed service.

## Paseo

Revision: `78b285059f6ebd0b257c98bd191df4626721270a`.

The [architecture document](https://github.com/getpaseo/paseo/blob/78b285059f6ebd0b257c98bd191df4626721270a/docs/architecture.md) describes a daemon/client boundary, provider adapters, reconnectable state, a transport-neutral tool catalogue and orchestration-skill management. Selected [agent manager definitions](https://github.com/getpaseo/paseo/blob/78b285059f6ebd0b257c98bd191df4626721270a/packages/server/src/server/agent/agent-manager.ts) show lifecycle, capability, permission and cancellation interfaces.

Borrow the runner/daemon concept, provider capability boundary, reusable tool service and continuity across client reconnects. A browser-based product can use a paired runner without requiring a full desktop UI.

The document's desktop-browser section describes a shared persistent browser profile. That suits a different trust model; the proposed organisation service instead isolates test/browser state per run and reviewer. Similarly, local file-backed agent state is not proposed as the authority for shared task claims.

## Independent platform checks

| Topic | Official source | Design implication |
| --- | --- | --- |
| Codex integration | [App server](https://learn.chatgpt.com/docs/app-server) | Use a structured local protocol behind a versioned adapter. |
| Codex credentials | [Authentication](https://learn.chatgpt.com/docs/auth) | Keep subscription and API-key connections explicit; do not conflate entitlement modes. |
| GitHub repository authority | [Installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) | Keep publication credentials scoped and outside agent execution. |
| GitHub integration permissions | [Choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) | Treat repository content, PRs and workflow changes as deliberate capabilities. |
| GitHub observations | [Webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) | Verify and deduplicate webhook deliveries; reconcile missed/uncertain observations. |
| Atomic acquisition | [Postgres SELECT](https://www.postgresql.org/docs/current/sql-select.html) | Use transactions, locks and constraints for authoritative claims. |
| Tenant boundaries | [Postgres row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | Add DB enforcement to application authorisation, with appropriate DB roles. |
| Browser test state | [Playwright isolation](https://playwright.dev/docs/browser-contexts) | Separate cookie/storage state; also isolate execution for tenant security. |
| Tool transport | [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) | Expose shared tool implementations through an adapter. |
| Execution isolation | [Firecracker](https://github.com/firecracker-microvm/firecracker) | MicroVM isolation is a feasible option; operating a fleet is a separate undertaking. |

The Neon pooling documentation endpoint could not be retrieved through the web reader because of its response content type. No Neon-specific pool feature or session-lock guarantee is asserted here; confirm provider configuration before implementation.

These sources inform the proposal. The organisation hierarchy, exclusive-claim design, publisher boundary, initial serial repository policy, and PM experience are recommendations for this project, not claims that all four reference projects already implement them. If source code is later reused, inspect the exact files and applicable licence/notice obligations at that time.
