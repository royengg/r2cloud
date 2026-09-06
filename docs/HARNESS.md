# Unified agent harness

Research and implementation design, 6 September 2026. This document separates observed upstream behavior from the proposed r2cloud implementation. The unified harness is not implemented yet.

## Decision

Use one persistent thread and the native Codex agent loop for conversation, exploration, planning, questions and implementation. Do not add a separate conversational agent, chat endpoint, intent-classification model, or mandatory “chat versus code” choice.

The model decides how to respond and which tools to request. The backend decides whether each requested operation is permitted. A message is not automatically a coding task, an implementation claim, or a publication approval.

Multiple threads may reference the same task. Each retains its own conversation, while the task retains one implementation owner and one active execution.

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

## The r2cloud user flow

1. Open a project or task thread, choose the model in the composer and send a message.
2. Resume that thread's Codex session, or create it on first use. Supply the current project identity, selected task, enabled skills and scoped tools.
3. Codex can answer directly, fetch board facts, explain status, explore the repository, propose task decomposition, or ask a focused question. “Hello” produces a reply; “What is blocked?” reads the board. Neither starts implementation.
4. For “Implement this task,” Codex requests the checked task-execution tool. Explicit bounded implementation instructions can supply authorization; uncertain scope or an unapproved proposed plan produces an inline confirmation. Do not ask again when the same action is already authorized.
5. The backend checks the initiating person's permissions, exact task/version, dependencies, owner and limits. It records the claim and execution intent atomically before granting writable repository access.
6. Stream progress, tool activity, file changes and test results into the same thread. The task card displays the linked agent's actual state. Stop, clarification and plan responses remain in that thread.
7. Start the configured dev service when a preview is needed. Show “Try the preview” only after health and access checks. Keep agent browser state separate from human preview sessions.
8. A no-change answer returns the session to idle. Actual changes can produce immutable evidence and a candidate for review. A finished turn does not itself create a candidate or complete a task.
9. Review feedback continues in the same thread. Publication and merge remain separate, exact human authorizations; verified merge is the only coding-task completion signal.

There is one conversational surface and one harness. Session, task, execution and publication remain different domain records because they have different lifetimes and permissions.

## Runtime and permission design

Codex subscription execution needs a Codex process. Under managed-cloud execution, the proposed runtime therefore starts in a small Vercel sandbox on the first message, even for conversation. Repository checkout, dependency installation and browser services are lazy operations, not prerequisites for saying hello. Do not imply that conversation is free of model usage or sandbox time.

One active provider writer owns a thread. Persist the provider thread handle and supported session state before stopping its runtime. Restore only after the old writer is confirmed stopped or isolated. Session persistence must exclude credentials and must be tested against the pinned Codex version; importing chat text into a fresh thread is not native resume.

Before a task grant, repository access is absent or read-only. The checked execution operation must establish the writable environment and exact task generation. Change provider working-directory and sandbox permissions at a supported lifecycle boundary. Do not assume a tool response can silently change a running turn's sandbox policy. This transition requires a compatibility test on the pilot runtime.

Keep a session's conversation available when a sandbox expires. Preserve work and evidence independently. Resource limits still apply while a person is reviewing; waiting must not silently extend a paid run or start another writer.

Initial product tools:

| Tool responsibility                                                     | Policy                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Read project context, list/search tasks, read task details/dependencies | Derive project from execution identity; never trust a caller-supplied organisation ID. Return bounded, versioned results. |
| Propose or create tasks / revise acceptance criteria                    | Separate suggestion from mutation; apply contributor authorization and expected versions.                                 |
| Request task implementation                                             | Acquire the existing authoritative claim, persist durable intent and apply time/concurrency/budget limits.                |
| Report progress/blockers, attach evidence, request review               | Require current task execution identity and generation.                                                                   |
| Start/inspect preview                                                   | Restrict to the granted execution, approved service and port.                                                             |
| Request publication                                                     | Create a review request only. No push/merge credentials or approval authority go to the agent.                            |

Use one checked service behind native dynamic tools or MCP. Choose the transport supported by the pinned runtime after protocol verification. Do not implement a second set of permissions inside MCP handlers.

A board snapshot can seed context, but tools must refresh facts. Board changes during a turn are not automatic authorization to act on those changes. Other threads' conversations are not shared implicitly.

## Streaming and recovery contract

Persist a timeline with stable thread, turn and item IDs plus ordered sequence numbers. Normalize assistant text, exposed reasoning summaries, progress plans, tool start/result, questions, approvals, errors and turn settlement. Render Markdown, compact tool summaries and inline decision cards, with technical details expandable.

The bridge must forward bidirectional RPC requests and every supported event category. Persist bounded/coalesced increments, flush completion, then broadcast through project-authorized Socket.IO subscriptions. Consumers catch up from their last applied cursor or reload a snapshot. Do not write every token as a separate database transaction, and do not overwrite all progress with the latest delta.

Persist pending questions/approvals and bind responses to request IDs, actor scope and current execution. A disconnect is not approval, cancellation or completion. Steer an active turn only if the provider supports it; otherwise queue input explicitly. An ambiguous turn-start result must be reconciled, not blindly retried.

## Current code gaps

| Existing implementation                                                                                                            | Required change                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `core/threads.ts` turns “run” into task creation/claim before Codex sees the message.                                              | Submit a native agent turn first; task tools request implementation only when needed.                             |
| `vercel-execution.ts` installs dependencies before any response, calls `thread/start` per run and always checks/exports afterward. | Session runtime with lazy repository setup; native reuse/resume; candidate lifecycle triggered by actual changes. |
| `vercel-codex-transport.ts` overwrites progress/message files, reads a final reply and rejects inbound server requests.            | Ordered event transport with question, approval and tool-call round trips.                                        |
| Harness capabilities advertise streaming, but the managed path does not deliver live deltas to the UI.                             | Capability reporting backed by end-to-end behavior and version probes.                                            |
| `ThreadPanel.tsx` polls every two seconds and renders final comment paragraphs.                                                    | A typed live timeline with Markdown, inline questions/plans, stop and reconnect support.                          |
| Thread history is copied into each fresh execution with a hard context cap.                                                        | Durable native provider handle plus supported compaction and separately paginated UI history.                     |
| No agent-facing board context/tools in the managed runtime.                                                                        | Project-scoped read and checked mutation tools.                                                                   |
| Preview is explicitly unavailable.                                                                                                 | Lazy dev service, authenticated separate-origin gateway, isolated browser and immutable evidence.                 |

The existing claim constraints, policy checks, receipts, jobs, sandbox identity, credential boundary and approval-bound publication model remain useful. Replace the orchestration around them rather than rebuilding the entire backend.

## Implementation order and acceptance

1. **Session and timeline foundation.** Persist native session/turn/item identities independently of tasks. Replace lossy bridge output with sequenced events and a real request-response path. Verify a streaming greeting creates no task, claim, checkout, checks or candidate.
2. **Single composer and live timeline.** One Send action, per-thread model, Markdown and tool status, inline questions/plan approval, stop and queue/steer. Verify reconnect during streaming has no duplicated or missing messages.
3. **Board tools and task grants.** Verify “What is blocked?” reads only this project; explicit implementation obtains exactly one claim; stale task versions and competing threads fail truthfully; plan rejection starts no work.
4. **Persistent isolated execution.** Verify the same thread continues after clarification and correction. Test sandbox expiry, interrupted startup, credential revocation and stop ambiguity before allowing replacement. No-change turns produce no candidate.
5. **Preview, evidence and publication.** Verify service health, scoped preview access and independent browser state. Bind review evidence to immutable changes and preserve separate publication/merge authorization.

Do not postpone invariant tests until the UI appears complete. Keep tests and source-review scratch files local under the existing repository policy.

## Compatibility limits

Upstream HEAD is not the pilot's installed protocol. r2cloud currently pins Codex 0.147.0 in Vercel; its local account broker has used a newer version. Native session restore, dynamic tools, plan/question events, model switching and turn steering must be probed on the actual execution version. Do not copy new APIs from HEAD and assume the pilot supports them.

The research above does not validate hosted entitlement, resource renewal, cross-sandbox session portability, production previews or GitHub publication. Those require separate implementation and real checks.

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
