# r2cloud

A collaborative agent development environment for product managers, combining Kanban boards, cloud agents, and shared workspaces.

Describe a task, organise it on your board, and work with an agent in a conversation. Keep your team’s tasks, feedback, and review decisions together.

**Early preview.** Shared boards, GitHub sign-in, repository connections, and Codex conversations are available. The configured coding pilot supports live previews, screenshots and saved-change review. Pull request publication has been verified; live merging still needs verification.

## How it works

1. **Create a workspace.** Start a project or join your team’s invitation after signing in with GitHub.
2. **Create tasks.** Add tasks with priorities and acceptance criteria to a simple Todo, Ongoing, and Completed board.
3. **Connect your tools.** Choose a GitHub repository and link your personal Codex account separately.
4. **Work in a thread.** Ask questions, explore the codebase, or plan changes. Follow streamed replies and activity, choose a model, and answer questions inline.
5. **Start and review work.** Approve implementation of a specific task, then inspect the preview, saved diffs and validation results. Questions alone do not start code changes.
6. **Publish for code review.** The assignee or a publication reviewer with GitHub write access can approve opening a pull request. Merging requires separate project merge permission and GitHub write access. Tasks complete only after GitHub confirms the approved commit was merged.

Each task has one implementation owner. Agents work in isolated cloud sandboxes and cannot push or merge your code. Publication and merging require separate human approval; a finished agent reply does not make a task Completed.

## Project skills

Type `/` in the project chat box or a thread to choose a skill, or write `/better-ui review this screen` directly. Six built-in skills cover UI polish, accessibility, debugging, code review, testing and planning.

Open **Skills** under a project in the sidebar to manage reusable instructions:

- **Create or import:** workspace owners and admins can choose **New skill** or import a `SKILL.md`, review its contents, and save it.
- **Edit and control availability:** update custom instructions, disable a skill to remove it from suggestions, or delete it. Built-in skills are read-only.
- **Use across the project:** project members can view skills and use enabled skills in conversations they can send messages to. Each queued message retains the instructions it was submitted with, even if the skill later changes.

A `SKILL.md` contains a command name and description in YAML frontmatter, followed by Markdown instructions:

```markdown
---
name: brand-voice
description: Write clear, consistent product copy.
---

Use short sentences and familiar words.
Make button labels describe the action.
```

Save it, then use `/brand-voice improve these button labels` in a conversation. Custom skills are scoped to their project. Imports include instructions only, without supporting scripts or other files. Skills do not grant permission to edit or publish code.

## Current limits

The coding pilot supports one configured project and public repositories. It uses your connected Codex subscription and Vercel Hobby sandbox capacity. Sandboxes stay available for quick follow-ups, stop after two minutes idle, and have a ten-minute total limit.

Private repository execution and hosted production deployment are not available yet. The complete review-to-merge journey remains unverified against GitHub. See [current capabilities and remaining work](docs/STATUS.md).

## Run it yourself

r2cloud currently requires your own development setup, GitHub app registrations, Postgres database, and provider connections. Follow the [setup guide](docs/SETUP.md) to run the app and configure the coding pilot.

Built with React, Vite, Express, Prisma, Neon Postgres, Socket.IO, and Bun workspaces.

[Architecture](docs/ARCHITECTURE.md) · [Design system](DESIGN.md) · [Design sources and attribution](docs/DESIGN-SOURCES.md)
