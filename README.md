# r2cloud

A shared workspace for turning product ideas into working software with Codex.

Describe a task, organise it on your board, and work with an agent in a conversation. Keep your team’s tasks, feedback, and review decisions together.

**Early preview.** Shared boards, GitHub sign-in, repository connections, and Codex conversations are available. The configured coding pilot supports live previews, screenshots and saved-change review. Pull request publication has been verified; live merging still needs verification.

## How it works

1. **Create a workspace.** Start a project or join your team’s invitation after signing in with GitHub.
2. **Create tasks.** Add tasks with priorities and acceptance criteria to a simple Todo, Ongoing, and Completed board.
3. **Connect your tools.** Choose a GitHub repository and link your personal Codex account separately.
4. **Work in a thread.** Ask questions, explore the codebase, or plan changes. Follow streamed replies and activity, choose a model, and answer questions inline.
5. **Start and review work.** Approve implementation of a specific task, then inspect the preview, saved diffs and validation results. Questions alone do not start code changes.

Each task has one implementation owner. Agents work in isolated cloud sandboxes and cannot push or merge your code. Publication and merging require separate human approval; a finished agent reply does not make a task Completed.

Type `/` in either chat box to choose a skill, or write a name directly—for example, `/better-ui review this screen`. The starter skills cover UI polish, accessibility, debugging, code review, testing and planning. Skills guide the same conversation; they do not grant permission to edit or publish code.

## Current limits

The coding pilot supports one configured project and public repositories. It uses your connected Codex subscription and Vercel Hobby sandbox capacity. Sandboxes stay available for quick follow-ups, stop after two minutes idle, and have a ten-minute total limit.

Private repository execution and hosted production deployment are not available yet. The complete review-to-merge journey remains unverified against GitHub. See [current capabilities and remaining work](docs/STATUS.md).

## Run it yourself

r2cloud currently requires your own development setup, GitHub app registrations, Postgres database, and provider connections. Follow the [setup guide](docs/SETUP.md) to run the app and configure the coding pilot.

Built with React, Vite, Express, Prisma, Neon Postgres, Socket.IO, and Bun workspaces.

[Architecture](docs/ARCHITECTURE.md) · [Design system](DESIGN.md) · [Design sources and attribution](docs/DESIGN-SOURCES.md)
