# Product decisions

These are product constraints, not a list of completed features. See [status](STATUS.md) for implementation readiness.

- Serve both product teams and nontechnical founders/product managers.
- Use shared organisations, projects and tasks. Boards are views; each task has one identity and implementation owner.
- Keep Todo, Ongoing and Completed as the main columns. Show review and blockers within Ongoing.
- Use one persistent thread and native Codex harness for conversation, planning, questions and implementation. Messages do not automatically create or claim tasks.
- Launch with managed Vercel sandboxes and Codex. A connected local/server runner and additional providers are future extensions.
- Keep GitHub-only product sign-in through Better Auth separate from the repository GitHub App and personal Codex connection.
- Contributors may start work. Designated human reviewers approve publication of an exact candidate. Merge needs separate authorisation. Agents cannot approve either action.
- Support individual work and explicitly authorised, bounded batches. Do not default to unrestricted autonomous task picking.
- Target websites and web applications. Coding tasks complete only after verified PR merge. Production deployment is separate and outside the initial scope.
- Use React/Vite, Express, Prisma with Neon Postgres, Socket.IO, and Bun workspaces for packages and runtime.
- Keep the interface light, soft-coloured, rounded and visually focused, with a collapsible sidebar, Hugeicons, restrained motion and neumorphic buttons. [DESIGN.md](../DESIGN.md) defines the system.

## Pilot policy and open choices

The pilot uses existing Vercel Hobby capacity with no paid usage approval or API-key fallback. It currently supports one configured project and public repositories. Runtime limits are described in [setup](SETUP.md).

One unresolved coding change per repository is a configurable policy (`repositories.max_changes`), not a permanent data-model restriction. Organisation concurrency and execution limits remain separate.

Personal Codex device login is implemented; final hosted credential renewal, account entitlement and billing arrangements are not settled. Production budget, scale, residency, hosting and broader repository-stack compatibility remain open.

## Development rules

Keep code minimal, readable and formatted with Prettier. Add comments only when needed. Commit locally under the repository owner’s identity; push only with authorisation. Tests, helper scripts, credentials and scratch artifacts remain local-only. Preserve third-party license notices.
