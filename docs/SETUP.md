# Setup

The app runs locally; hosted production deployment is not included. The managed coding pilot additionally requires configured GitHub, Codex and Vercel connections. See [status](STATUS.md) for current limits.

## App and database

Use Bun 1.4.2, the runtime and package manager pinned by the repository. Copy `.env.example` to an ignored `.env` and configure:

- `DATABASE_URL`: the application’s Postgres connection; use Neon’s pooled URL.
- `DIRECT_URL`: the non-pooled connection for migrations.
- `BETTER_AUTH_URL`: the exact frontend origin, initially `http://127.0.0.1:5173`.
- `BETTER_AUTH_SECRET`: a dedicated random secret of at least 32 characters.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`: the product sign-in OAuth app.

```sh
bun install --frozen-lockfile
bun run db:generate
bun run db:migrate
```

Start these in separate terminals:

```sh
bun run api
bun run web
```

Open `http://127.0.0.1:5173`. Express listens on loopback port 4310. Stop processes with Ctrl+C. Missing database configuration fails startup; there is no local Postgres fallback. Use the checked migrations rather than `prisma db push`.

```sh
bun run typecheck
bun run build
bun run design:lint
```

Tests and helper scripts are local-only at the repository owner’s request. A fresh clone does not contain the test suite or private dev launcher. Local tests explicitly select a disposable database schema and must never run against the product database.

## GitHub sign-in

Create a GitHub OAuth app with the frontend origin as its homepage and `<origin>/api/auth/callback/github` as its callback. This registration provides sign-in only; it does not connect repositories.

For a temporary HTTPS tunnel, forward Vite’s loopback port 5173. Set both `BETTER_AUTH_URL` and `R2_DEV_ORIGIN` to that exact HTTPS origin, update the OAuth callback, then restart the app. Wildcard tunnel origins are not accepted. A replacement tunnel URL requires updating these values again.

The API requests profile/email access, uses database sessions and enforces exact origins. New users create a workspace and project or accept an invitation after sign-in. Invitations are visible in the product; the app does not send invitation emails. Project administrators grant contribution, publication-review and merge permissions separately.

Production still needs an explicitly trusted proxy policy, independent process credentials, database-role separation, secret rotation and deployment hardening.

## Repository connection

Register a separate GitHub App. Configure its callback as `<BETTER_AUTH_URL>/api/repository-callback`. Discovery needs repository metadata and contents read access. Future GitHub writes belong to the isolated publisher integration.

Add `R2_GITHUB_APP_CLIENT_ID` and `R2_GITHUB_APP_SLUG` to `.env`. Put `R2_GITHUB_APP_CLIENT_SECRET` only in a separate ignored `.env.broker`, restricted to its process. Start the discovery broker:

```sh
bun --env-file=.env --env-file=.env.broker apps/api/src/processes/connections.ts
```

The API refuses to start if it inherits this App secret. Do not put it in the shared `.env`.

In **Connections**, a project administrator authorises the App, selects a verified repository and confirms attachment. The broker checks the signed-in GitHub identity and repository access; client-supplied repository names or installation IDs do not establish access. Empty repositories need an initial commit. The current discovery list is bounded; selected-repository installations keep it within the pilot limit.

Save repository execution settings in the same panel: directory, install/dev/test commands, port, health path and limits. Saving settings does not start a sandbox. The managed coding pilot currently imports public repositories only. Preview settings are stored, but live previews are not yet served.

## Personal Codex connection

Set `R2_CODEX_LOGIN_ENABLED=true` in `.env` only while the login broker is available. Put these in a separate ignored `.env.codex-broker` with file permissions 0600:

- `R2_CODEX_BINARY`: absolute path to the native Linux Codex 0.153.2 executable.
- `R2_CODEX_VAULT_KEY`: a random 32-byte hexadecimal encryption key.
- `R2_CODEX_BROKER_DIR`: optional private storage path; defaults to `.local/codex-broker`.

```sh
bun --env-file=.env --env-file=.env.codex-broker apps/api/src/processes/codex-login.ts
```

The API refuses to inherit the vault key. In **Connections**, use the Codex account button and complete the displayed device-code sign-in. Account access is personal and project-scoped. It is not shared through board membership. The broker runs an authentication-only process and stores credentials encrypted; it never opens a repository.

Expired credentials require reconnection. Renewable worker authentication and final hosted account/billing arrangements remain unfinished. API-key billing is not an automatic fallback.

## Managed execution worker

Configure an existing Vercel Hobby account/project and a compatible digest-pinned sandbox image. The worker verifies Codex 0.147.0 inside that image. It does not provision paid resources or extend sandbox lifetimes.

Keep these in an ignored `.env.managed`, restricted to the worker:

- `R2_EXECUTION_PROJECT_ID`: the product project this worker may execute for.
- `R2_VERCEL_TOKEN`, `R2_VERCEL_TEAM_ID`, `R2_VERCEL_PROJECT_ID`: scoped Vercel access.
- `R2_VERCEL_IMAGE`: the compatible digest-pinned image.
- `R2_CODEX_VAULT_KEY` and, if customised, `R2_CODEX_BROKER_DIR`: the same vault configuration used by the login broker.

```sh
bun --env-file=.env --env-file=.env.managed apps/api/src/processes/managed-workflow.ts
```

The configured pilot uses Paris (`cdg1`), two vCPUs, a two-minute idle timeout and a ten-minute total sandbox limit. It requires Hobby eligibility and has no paid-plan, region-failover or API-key fallback. Database hosting is independent of the sandbox region.

Open a project or task thread and send a message. Conversation starts a lightweight runtime; repository checkout and dependency installation wait for a checked implementation grant. Approve the named task inline to begin code work. Follow-up messages reuse the warm runtime where permitted. Stop and uncertain outcomes retain ownership until execution is confirmed quiescent or stopped.

Do not start the fixture workflow/publisher as if it were the live integration. Authenticated previews, private-repository credential custody, live publication and verified merge reconciliation remain unfinished. [Architecture](ARCHITECTURE.md) explains the boundaries; [status](STATUS.md) records what has actually been validated.
