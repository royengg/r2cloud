# R2Cloud

A shared product board where people describe outcomes, start coding work, review evidence, and approve changes. React/TypeScript, Express, and Postgres.

**Development slice, not a deployed service.** The local app uses visibly labelled fixtures for cloud execution, preview content, and GitHub operations. It does not call a model, clone repositories, push code, or merge real PRs. Managed integrations fail closed until configured.

## Local development

Workspace: `/home/paseo-agent/workspace/r2cloud`.

```bash
source /home/paseo-agent/remote-ai/env.sh
npm ci
npm run db:start
R2_MODE=fixture npm run db:setup
npm run dev
```

Open `http://127.0.0.1:5173`. Select a fixture participant: Maya can contribute/review/authorise merge, Alex can contribute, and Sam can view. This local participant selector is development authentication, not production sign-in.

Postgres uses existing ARM64 binaries with project-private storage and a Unix socket only. No existing database service is used. API and previews bind loopback ports 4310 and 4311. Stop the app with Ctrl+C and the database with `npm run db:stop`.

```bash
npm run typecheck
npm test
npm run build
```

Tests require the private database to be running and create/drop only their own randomly named schema. Browser checks use the existing system Chromium executable; no browser download is required.

## Documents

- [Architecture](docs/ARCHITECTURE.md)
- [Confirmed decisions](docs/DECISIONS.md)
- [Inherited source review](docs/RESEARCH.md)
- [Implementation and validation](docs/IMPLEMENTATION.md)

The recovered architecture is a target design, not a claim that every boundary has shipped. Publication requires approval for an exact immutable candidate; merge is a separate action. A finished agent turn or an open PR never completes a task.
