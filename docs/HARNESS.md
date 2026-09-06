# Harness source research

Historical source review from 6 September 2026. This explains the upstream patterns behind the implemented harness; it is not an outstanding implementation plan. See [architecture](ARCHITECTURE.md) for the current design and [status](STATUS.md) for validation and remaining work.

## Research scope

Reviewed source at these revisions, including provider adapters, native turn handling, event normalization, session lifecycle, permissions, persistence/reconnect and preview integrations:

| Repository          | Revision                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| openai/codex        | [ac192cd7937b](https://github.com/openai/codex/tree/ac192cd7937b0d73edc6dffe009940ae53782dd4)        |
| pingdotgg/t3code    | [223ff4490f76](https://github.com/pingdotgg/t3code/tree/223ff4490f764a74ff911589e97b9bbcd595fee8)    |
| getpaseo/paseo      | [38c22139bb19](https://github.com/getpaseo/paseo/tree/38c22139bb191f0ad27b11c16776e93504ddd4fd)      |
| BloopAI/vibe-kanban | [4deb7eca8f38](https://github.com/BloopAI/vibe-kanban/tree/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053) |

This is a targeted architecture/source review, not an audit of every file or a runtime certification of those applications. Upstream tests were inspected where relevant, not executed. Codex findings concern its open-source CLI, core and app-server; they are not a claim that its entire desktop application is open source. Paseo's deployed documentation index returned HTTP 403, so its checked-in documentation and implementation were used.

## What the four implementations do

### Codex: the agent loop

The core turn loop submits context to the model, processes returned items and tool work, and continues when tool results or pending user input require another step. An ordinary answer can finish the turn without making any file changes. This is a native agent loop, not an outer classification request followed by a different coding agent. [Turn implementation][codex-loop]

App-server exposes threads, turns and typed items over bidirectional JSON-RPC. Start/resume identifies the durable provider conversation; turn start submits input to it. Notifications represent text, plans, tool activity, output and completion. User-input and approval requests need protocol-correct responses. Dynamic tool responses return to the same conversation so the model can continue. [Protocol][codex-protocol], [dynamic tool response handler][codex-tools]

Plan mode is a collaboration setting: explore and clarify, then propose a plan without implementing it. It is distinct from the progress-checklist tool. Default mode favors acting on clear requests within the granted permissions; it does not require a confirmation ritual before every action. [Plan instructions][codex-plan], [default instructions][codex-default]

**Adopt:** native sessions and the model/tool loop. Expose product operations as tools. Render the provider's available commentary, reasoning summaries, plans and tool events; do not fabricate a hidden thought transcript.

### T3 Code: provider control and durable orchestration

T3's provider contract separates starting a session, sending a turn, interruption, answering approvals, answering questions and optional capabilities such as compaction. The Codex runtime starts or resumes the provider thread and supplies turn-specific model, collaboration and sandbox settings. Its adapter maps Codex events into a common domain vocabulary, including assistant deltas, reasoning summaries, plan proposals and command/file activity. [Contract][t3-contract], [runtime][t3-session], [event adapter][t3-adapter]

The orchestration engine records events, projections and command receipts in a transaction, then publishes committed events. Reconnect belongs to a shared connection owner; transport reconnection does not blindly replay mutations. Cached thread data and replay position must advance together. [Engine][t3-engine], [connection runtime][t3-reconnect]

Permissions are configurable per thread, including supervised behavior. The documented default is Full access, which is unsuitable as r2cloud's cross-organisation execution policy. Preview automation is exposed through tools bound to an invocation context and preview broker. [Permissions][t3-permissions], [preview tools][t3-preview]

**Adopt:** provider normalization, durable commands, post-commit fanout and session capability reporting. Keep Bun/Express/Prisma/Socket.IO; copying T3's full Effect stack is unnecessary.

### Paseo: session lifecycle and a structured timeline

Paseo's Codex adapter holds a provider thread ID, builds turn input with model and workflow settings, resumes sessions, supports steering, maps plans and reasoning/text events, and handles user-input requests. AgentManager owns the surrounding agent lifecycle and stream consumption. [Codex adapter][paseo-adapter], [manager][paseo-manager]

A closed provider runtime is not a deleted conversation. Its durable identity and persistence handle survive, and the manager resumes it when needed. Replacement waits for acknowledged closure; uncertain interruption blocks replacement. This distinction is especially relevant when r2cloud sandboxes expire. [Lifecycle][paseo-lifecycle]

Timeline rows have ordered sequence numbers and an epoch. Stale or missing cursors trigger reset/catch-up rather than silently losing history. Streaming is coalesced with an immediate first flush and a bounded trailing window; the implementation uses 60 ms. The frontend separately paces the visible reveal and snaps completed content to its final text. [Timeline store][paseo-timeline], [coalescer][paseo-stream], [rendering pipeline][paseo-stream-doc]

Agent tools use a transport-neutral catalog. Workspace scripts/services have lifecycle and proxy metadata, and MCP tools can start/stop configured services. Workspaces are stable containers for sessions and can use either local directories or worktrees. [Tools][paseo-tools], [service proxy][paseo-preview], [workspace model][paseo-workspace]

**Adopt:** durable session identity, typed timeline, cancellation acknowledgement and smooth real streaming. Do not import daemon-wide permissions as organisation-scoped authorization; Paseo documents that distinction itself. [Permission model][paseo-permissions]

### Vibe Kanban: issue-aware tools and workspace sessions

A session is a conversation inside a workspace. Follow-up handling finds the previous provider session and builds either a follow-up or initial executor action. Multiple sessions keep independent histories but share workspace files and Git state. That is not r2cloud's exclusive-writer guarantee. [Session route][vk-followup], [session documentation][vk-sessions]

Its Codex client handles command/file approvals, user questions and plan approval. When a plan is approved, it starts a subsequent turn in the same thread with implementation instructions and Default collaboration mode. Rejected plans can feed back into another Plan turn. Its normalizer represents native output as messages, reasoning, plans and tool actions. [Client][vk-client], [normalization][vk-normalize]

It already has Kanban-aware agent tools: current context, issue listing/reading/creation/update, and workspace creation linked to an issue. This is direct evidence for a tool-based board integration, rather than copying the board into a prompt and hoping the model obeys it. [Context][vk-context], [issue tools][vk-issues], [workspace tool][vk-workspace]

Previews are a separate HTTP/WebSocket proxy to a running application; a conversational reply itself does not create a healthy preview. [Preview route][vk-preview]

**Adopt:** scoped board tools, inline question/plan interactions and preview lifecycle. Preserve our stricter ownership and publication boundaries.

## How this informs r2cloud

Use one persistent native agent session with project-scoped tools, structured streamed events and inline decisions. The model chooses how to respond; checked backend services grant task implementation authority. Shared writable environments and broad local permissions do not satisfy r2cloud’s ownership and publication boundaries.

The pilot execution image pins Codex 0.147.0, independently of the upstream revisions reviewed here. Protocol changes require verification against the installed version. The research itself does not establish account entitlement or validate previews and publication.

[codex-loop]: https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/core/src/session/turn.rs
[codex-protocol]: https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/app-server/README.md
[codex-tools]: https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/app-server/src/dynamic_tools.rs
[codex-plan]: https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/collaboration-mode-templates/templates/plan.md
[codex-default]: https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/collaboration-mode-templates/templates/default.md
[t3-adapter]: https://github.com/pingdotgg/t3code/blob/223ff4490f764a74ff911589e97b9bbcd595fee8/apps/server/src/provider/Layers/CodexAdapter.ts
[t3-session]: https://github.com/pingdotgg/t3code/blob/223ff4490f764a74ff911589e97b9bbcd595fee8/apps/server/src/provider/Layers/CodexSessionRuntime.ts
[t3-engine]: https://github.com/pingdotgg/t3code/blob/223ff4490f764a74ff911589e97b9bbcd595fee8/apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[t3-contract]: https://github.com/pingdotgg/t3code/blob/223ff4490f764a74ff911589e97b9bbcd595fee8/apps/server/src/provider/Services/ProviderAdapter.ts
[t3-reconnect]: https://github.com/pingdotgg/t3code/blob/223ff4490f764a74ff911589e97b9bbcd595fee8/docs/internals/connection-runtime.md
[t3-permissions]: https://github.com/pingdotgg/t3code/blob/223ff4490f764a74ff911589e97b9bbcd595fee8/docs/user/permission-modes.md
[t3-preview]: https://github.com/pingdotgg/t3code/blob/223ff4490f764a74ff911589e97b9bbcd595fee8/apps/server/src/mcp/toolkits/preview/tools.ts
[paseo-adapter]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/packages/server/src/server/agent/providers/codex-app-server-agent.ts
[paseo-manager]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/packages/server/src/server/agent/agent-manager.ts
[paseo-lifecycle]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/docs/agent-lifecycle.md
[paseo-timeline]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/packages/server/src/server/agent/agent-timeline-store.ts
[paseo-stream]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/packages/server/src/server/agent/agent-stream-coalescer.ts
[paseo-stream-doc]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/docs/agent-stream-performance.md
[paseo-tools]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/packages/server/src/server/agent/tools/paseo-tools.ts
[paseo-preview]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/docs/service-proxy.md
[paseo-workspace]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/public-docs/workspaces.md
[paseo-permissions]: https://github.com/getpaseo/paseo/blob/38c22139bb191f0ad27b11c16776e93504ddd4fd/docs/permissions.md
[vk-client]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/executors/src/executors/codex/client.rs
[vk-normalize]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/executors/src/executors/codex/normalize_logs.rs
[vk-followup]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/server/src/routes/sessions/mod.rs
[vk-sessions]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/docs/workspaces/sessions.mdx
[vk-context]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/mcp/src/task_server/tools/context.rs
[vk-issues]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/mcp/src/task_server/tools/remote_issues.rs
[vk-workspace]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/mcp/src/task_server/tools/task_attempts.rs
[vk-preview]: https://github.com/BloopAI/vibe-kanban/blob/4deb7eca8f381f7cbc1f9d15515a9ab8f8009053/crates/server/src/routes/preview.rs
