# r2cloud

A shared workspace for turning product ideas into working software with Codex.

Describe an outcome, organise it on your board, and work with an agent in a conversation. Keep your team’s tasks, feedback, and review decisions together.

**Early preview.** Shared boards, GitHub sign-in, repository connections, and Codex conversations are available. Managed coding runs work in the configured pilot. Live browser previews, publishing pull requests, and verified merge updates are still being built.

## How it works

1. **Create a workspace.** Start a project or join your team’s invitation after signing in with GitHub.
2. **Describe the outcome.** Add tasks with priorities and acceptance criteria to a simple Todo, Ongoing, and Completed board.
3. **Connect your tools.** Choose a GitHub repository and link your personal Codex account separately.
4. **Work in a thread.** Ask questions, explore the codebase, or plan changes. Follow streamed replies and activity, choose a model, and answer questions inline.
5. **Start and review work.** Approve implementation of a specific task, then inspect the reported changes and test evidence. Questions alone do not start code changes.

Each task has one implementation owner. Agents work in isolated cloud sandboxes and cannot push or merge your code. Publication and merging require separate human approval; a finished agent reply does not make a task Completed.

## Current limits

The coding pilot supports one configured project and public repositories. It uses your connected Codex subscription and Vercel Hobby sandbox capacity. Sandboxes stay available for quick follow-ups, stop after two minutes idle, and have a ten-minute total limit.

Private repository execution, live previews, and the complete review-to-merge journey are not available yet. See [current capabilities and remaining work](docs/STATUS.md).

## Run it yourself

r2cloud currently requires your own development setup, GitHub app registrations, Postgres database, and provider connections. Follow the [setup guide](docs/SETUP.md) to run the app and configure the coding pilot.

Built with React, Vite, Express, Prisma, Neon Postgres, Socket.IO, and Bun workspaces.

[Architecture](docs/ARCHITECTURE.md) · [Design system](DESIGN.md) · [Design sources and attribution](docs/DESIGN-SOURCES.md)
