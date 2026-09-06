# Decisions and remaining choices

Confirmed by the user on 5 September 2026. This record supersedes the preliminary questions in the recovered proposal.

| Area             | Confirmed decision                                                                                                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience         | Product teams and nontechnical founders/product managers.                                                                                                                                                                                                                                             |
| Execution        | Vercel Sandbox for managed cloud execution at launch. A connected runner is a future extension.                                                                                                                                                                                                       |
| Product sign-in  | GitHub only for now, through Better Auth. Repository GitHub App access and AI credentials remain separate.                                                                                                                                                                                            |
| Agent            | Codex first, with a provider adapter boundary.                                                                                                                                                                                                                                                        |
| Permissions      | Contributors start work. Designated project reviewers approve publication. Merge requires separate authorisation. Agents cannot approve either action.                                                                                                                                                |
| Autonomy         | Individually started tasks and explicitly authorised bounded batches; no unrestricted continuous picking.                                                                                                                                                                                             |
| Repository scope | Websites and web applications.                                                                                                                                                                                                                                                                        |
| Completion       | Coding tasks complete only after actual PR merge is verified. Production deployment is separate and out of scope.                                                                                                                                                                                     |
| Experience       | Fresh light interface with soft blue/apricot/sage surfaces, rounded shapes, collapsible org/project sidebar, Hugeicons and Plus Jakarta Sans. Three board columns, scoped composer and progressively disclosed review details. Neumorphic buttons and restrained motion follow the latest references. |
| Workspace        | `/home/paseo-agent/workspace/r2cloud`. Both session and VPS instructions explicitly permit this path.                                                                                                                                                                                                 |

Reversible engineering choices: React/TypeScript/Vite, Express/TypeScript, Postgres, separate API/workflow/publisher processes, durable database jobs and events, immutable review manifests, authenticated preview grants, versioned run-pinned skills. The user subsequently selected Prisma for Neon Postgres, Socket.IO for realtime, and Bun workspaces/package manager/runtime. No Neon resource has been provisioned.

One unresolved change per repository is a configurable pilot policy (`repositories.max_changes`), not a permanent data-model restriction or separately confirmed product requirement. Organisation concurrency and per-run time/budget grants are independent limits.

Codex app-server device-code login is the proposed subscription connection path; API-key billing must not be enabled as an automatic fallback. Managed cloud and Codex do not establish permission to share personal accounts, hosted-subscription entitlement, or a final billing arrangement. Product identity, repository installation, and provider delegation remain separate.

Pilot: one tester on their own repositories, free-only sandbox usage ($0 paid), Paris (`cdg1`) as the closest currently supported Sandbox region to Kolkata. Production budget, scale, residency, hosting and stack compatibility remain open.

## Development workflow

Keep code minimal, readable and formatted with Prettier. Add comments only when necessary to explain non-obvious behavior. Commit locally as Rudraksh Roy (`royengg`); push only when authorized. Tests and scripts remain local-only. Preserve required third-party license notices.

External fixtures are confined to local testing. See [implementation status](STATUS.md) for actual integration readiness. Earlier architecture research and progress reports are archived locally.

## Unified agent conversation

Confirmed on 6 September 2026: one persistent thread and one native agent harness handle conversation, planning, questions and implementation. Do not introduce a separate chat path or require every message to create/claim a task. The agent uses project-scoped Kanban tools; the backend grants implementation authority through the existing checked claim service. Stream real provider events and show questions/plan decisions inline. See [source review and implementation design](HARNESS.md).
