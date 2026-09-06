# Repository, sandbox and Codex execution setup

## Connection flow

1. Sign in to r2cloud with the GitHub OAuth app.
2. An administrator authorizes the separate repository GitHub App and selects a repository verified by the discovery broker. Product sign-in credentials cannot authorize repository writes.
3. Save repository install/dev/test commands, working directory, preview port, health path and maximum run time/budget. Saving settings does not execute commands or provision Vercel resources.
4. Connect a personal Codex subscription using the Codex app-server device-code flow, with explicit project scope. The separate login broker persists the attempt, supplies the code and stores completed credentials encrypted. The configured pilot worker enables eligible personal connections while its heartbeat is current; an explicit task start is still required.
5. Start an individually authorized task. The transaction pins the profile version and digest into the run, checks the requested limits and retains exclusive task ownership. The managed adapter validates that immutable profile before asking a supervisor for a sandbox.

## Implemented API

- `GET /api/projects/:projectId/execution-setup`: project-authorized settings and truthful integration readiness; provider metadata is scoped to the signed-in person. No secret references are returned.
- `POST /api/projects/:projectId/execution-setup`: administrator-only, `Idempotency-Key` required, body `{version, config}`. Version zero creates the profile; updates require the last observed version. Reusing a key with a different payload is rejected.

The schema lives in `packages/contracts/src/execution.ts`. Commands use executable/argument arrays, not an interpolated host shell. Their contents remain untrusted repository instructions and must execute only inside the managed sandbox. The profile cannot choose credentials, images, arbitrary network policies or publication authority. Runtime image, region and secret/network policies belong to the trusted supervisor configuration.

Profile changes affect future runs; existing runs retain their immutable setup. Every managed run, including an authorized batch, must satisfy the same limits. A dollar cap in the profile is an authorization limit, not a claim that Vercel or Codex supports exact dollar enforcement. Live startup must remain disabled until metering and termination enforcement exist.

## Subscription authentication decision

Use the Codex executable in `app-server` mode for execution and structured events. Its `account/login/start` request with `type: chatgptDeviceCode` supplies a verification URL and one-time code. Codex owns OAuth/token refresh; r2cloud should not implement a substitute OAuth exchange or reuse GitHub OAuth credentials. The adapter allowlists the official device verification destination and returns only ceremony fields.

The trusted broker must run a dedicated per-person login context, match completion to the pending attempt, then verify account health and applicable plan access. Login completion alone cannot enable arbitrary project runs. The durable coordinator checks membership throughout login, rejects expired leases and cancelled attempts, and stores credentials in an AES-256-GCM vault. Disconnect disables the project credential reference; it does not release task ownership. Broker cleanup removes disconnected credentials. The pilot worker checks contribution access and enables connections only in its configured project. Task dispatch also requires its fresh heartbeat. Never expose token/auth files through API responses, project events, logs, repository checkouts or review snapshots. A subscription is not implicitly shared with collaborators. External-token login is experimental and not the proposed default.

The current local Codex executable reports 0.153.2. The native binary passed initialization and unauthenticated account-read checks. Login completion has been tested with a protocol fixture, not a real subscription. OpenAI recommends API keys by default for automation; subscription availability and workspace restrictions must be checked for each intended account/use case.

## Running the login broker

Set `R2_CODEX_LOGIN_ENABLED=true` in the API environment only when the broker is running. Keep `R2_CODEX_BINARY` (the pinned native Linux executable) and a random 32-byte hexadecimal `R2_CODEX_VAULT_KEY` in a separate ignored `.env.codex-broker` file with mode 0600. The API refuses to start if it inherits the vault key. Supply the broker’s database URL separately when needed.

Run from the repository root with the private Bun toolchain:

```sh
bun --no-env-file --env-file=.env.codex-broker apps/api/src/processes/codex-login.ts
```

The broker launches an authentication-only Codex process in a fresh private home with a minimal environment. It never opens a repository or starts a coding thread. Temporary auth files are removed after confirmed process termination; startup also removes homes belonging to stopped processes. Encrypted vault files remain outside repository checkouts. Production needs separate service identities, key rotation and backup/retention policy.

The protected API exposes `GET` and `POST /api/projects/:projectId/codex`, and `POST /api/projects/:projectId/codex/:connectionId/disconnect`. Starting requires an idempotency key and human contributor access. A collaborator cannot inspect or disconnect another person’s account. Pending attempts expire after ten minutes and are never automatically resumed after a lost broker lease.

## Remaining live gates

GitHub product OAuth is configured. The separate repository App client configuration/installations are not yet configured here. Vercel CLI login and a live Hobby sandbox smoke check are complete. The pilot supervisor and Codex 0.147.0 execution transport are now implemented. Renewable worker credentials, private previews, production object storage and broker isolation remain outstanding. The status endpoint checks the worker heartbeat, repository profile and personal connection; the account-link button is available only when the separate login broker is configured. No paid resources or live Codex login were initiated by this increment.

Sources checked on 2026-09-05: [Codex authentication](https://learn.chatgpt.com/docs/auth), [app-server authentication](https://learn.chatgpt.com/docs/app-server), [Vercel Sandbox lifecycle](https://vercel.com/docs/sandbox/working-with-sandbox).

## Verification

On 2026-09-05, all 55 tests passed (264 assertions), including real private Postgres/HTTP policy tests and mocked Codex/Vercel protocol tests. Prisma generation/migration deployment and the TypeScript/Vite build passed. New checks cover administrator/version/idempotency enforcement, path traversal rejection, run-limit rollback with no claim/run left behind, pinned-profile tampering and device-login destination/response filtering. No real external execution or subscription sign-in was tested.

## Vercel Sandbox integration

Vercel is the selected managed execution provider. The official `@vercel/sandbox` SDK is pinned to **3.2.1**. The shared VPS remains an API/development host; it never runs checked-out repository code as a sandbox.

## Implemented control plane

`VercelSandboxes` accepts explicit team/project/token credentials and a Postgres journal. It creates isolated, nonpersistent environments from a digest-pinned image, with explicit region, CPU and time limits. Initial networking is deny-all, environment variables are empty, and no ports are exposed. No host environment, saved Vercel account, GitHub write token or personal Codex configuration is inherited.

Postgres records allocation intent before calling Vercel. One run has one allocation; task generation and active claim are checked for each operation. Reusing an operation with changed configuration is rejected. After a creation timeout, the adapter looks up the existing name without resuming it. An absent/uncertain remote response never authorises replacement creation.

Commands record their immutable payload before dispatch. A completed receipt is reused; an unresolved receipt blocks replay. Commands target `currentSession()` directly: the SDK's higher-level `runCommand()` can automatically resume stopped sessions. Command execution has a remote timeout as well as an HTTP timeout. Neither a command exit nor a provider turn is task completion.

Snapshot intent closes command intake. Snapshot identifiers and a separately confirmed stop proof are recorded. A Vercel filesystem snapshot is not a candidate digest, test evidence, or publication approval. Unknown snapshot/stop outcomes keep ownership reserved. Preview ports stay closed until an authenticated gateway is implemented.

## Project-scoped coding pilot

The control plane is implemented and tested with the official SDK replaced by a test double. The project-scoped pilot worker uses `VercelCodexExecution` for public repository import, Codex turns, configured checks, immutable bundle export and confirmed stop. A complete selected-repository task has not yet been validated.

The worker uses the pinned image below and verifies its Codex 0.147.0 executable before starting the app-server. A temporary JSONL bridge uses Vercel session file/command APIs; no app-server port is exposed. Request intent and response receipts prevent an ambiguous request from being dispatched twice. Lost execution outcomes retain ownership.

Repository fetches use the pinned commit and allow only Git read endpoints for that repository. Dependencies run before model access is enabled. The trusted worker decrypts the project-authorized account credential and configures a Vercel request-header transform restricted to the Codex backend. The sandbox gets an inert placeholder token, not a usable subscription credential. External-token mode was verified with the installed binary and a real connection-check turn; it remains an experimental Codex protocol feature. Expired credentials require reconnection rather than an unimplemented refresh or API fallback.

The pilot checks Hobby eligibility before allocation, disables failover and uses a ten-minute ceiling. Agent time reserves a final checking/export window. Configured commands execute in the sandbox; their successful exit does not prove natural-language acceptance criteria. Those stay `unknown` for human review. The worker removes model network access before checks and export. It stores an immutable Git bundle privately, confirms stop and then returns a candidate. Corrections restore that candidate into a new execution generation.

Run `bun --no-env-file --env-file=.env.managed apps/api/src/processes/managed-workflow.ts` with an ignored, mode-0600 environment file containing `R2_EXECUTION_PROJECT_ID`, the three Vercel credential variables, `R2_VERCEL_IMAGE` and `R2_CODEX_VAULT_KEY`. The current development launcher starts this process only when that local file exists. Do not load its secrets into the API.

Private previews, remote artifact storage, private-repository installation tokens and publication remain unfinished. The worker does not expose an unauthenticated application port as a substitute preview.

Credential configuration will use dedicated `R2_VERCEL_TOKEN`, `R2_VERCEL_TEAM_ID` and `R2_VERCEL_PROJECT_ID` in the worker environment. They are constructor inputs to the control plane, not auto-discovered operator credentials. Pilot region and spending policy are recorded below. The local CLI session uses a verified active Hobby team. Its short-lived access token is saved in ignored `.env.sandbox` alongside the team/project IDs, region and observed image digest; it must be refreshed before expiry. This file is not loaded into the API; the project-scoped worker has its own `.env.managed` configuration. Renewable worker credential handling and the selected repository’s full task execution test are still required.

## Live setup verification — 2026-09-06

The official Sandbox CLI 4.2.1 is installed in ignored `.local/vercel-cli`, with authentication stored separately under `.local/vercel-auth` (private directory and file permissions). The signed-in team is on an active Hobby plan. Vercel’s CLI selected its default sandbox project; no application was deployed or connected for automatic Git deployment.

The smoke test created a nonpersistent sandbox in `cdg1`, with two vCPUs, a two-minute deadline, no failover, no public ports and deny-all networking. CLI command execution returned x86_64, Node 24.19.0, Bun 1.3.14, Codex 0.147.0 and Git 2.53.0. SDK inspection confirmed the running state and resolved image `vercel/sandbox/universal@sha256:0e3e3617e824397f170fc7c43ccaa565dd7ac36518e83ead3d41e077cd9f6ec7`.

The CLI reported 39.246 seconds of session duration and 4.438 seconds of active CPU. Stop was independently confirmed through an SDK read with `resume: false`, followed by removal. No repository, model credentials or product secrets entered the sandbox. Codex 0.147.0 in that image differs from the login broker’s 0.153.2. Subsequent isolated checks verified the execution protocol, external credential mode and a real subscription-backed connection-check turn. The full repository edit/build path is still unvalidated.

## Verified sources

- [Vercel SDK reference](https://vercel.com/docs/sandbox/sdk-reference), checked 2026-09-05 and compared with installed 3.2.1 declarations and implementation. In particular, `resume: false`, `currentSession()`, snapshot-induced stop and explicit credentials affect recovery correctness.
- [Codex non-interactive automation](https://learn.chatgpt.com/docs/non-interactive-mode), checked 2026-09-05: untrusted setup/test processes must not receive model credentials. Keep the broker outside repository-controlled processes.

## Personal pilot policy — 2026-09-05

The user is testing alone from Kolkata, India, on their own repositories, using free limits only. Paid usage authorization is **$0**. Do not upgrade plans, enable paid overages or switch to API billing automatically.

Use Paris (`cdg1`) as the pilot region: it is geographically closest to Kolkata among the currently documented Sandbox regions (`iad1`, `sfo1`, `cle1`, `cdg1`). This is a geographic choice, not a measured latency result. There is no documented India or Singapore Sandbox region. Reconsider once data/storage locations and measured latency are known.

Conservative implementation defaults: one concurrent run, 2 vCPUs, 10-minute session timeout, no automatic timeout extension or region failover. These are proposed operational limits within the user’s free-only testing constraint, not additional confirmed product requirements. Stop idle execution and keep snapshot retention bounded. Account plan and remaining quotas must be verified before launching; unknown eligibility blocks creation. A nonpersistent two-minute smoke sandbox was created under this policy and stopped after approximately 39 seconds.

Vercel currently documents Hobby allowances of 5 active CPU hours/month, 420 GB-hours of provisioned memory/month, 5,000 creations/month, 20 GB transfer/month and 15 GB lifetime snapshot storage. Hobby pauses creation at quota exhaustion instead of charging overages. Pro uses credits and then paid usage, so it cannot be treated as equivalent to Hobby free testing. These allowances cover sandbox infrastructure, not OpenAI model usage; use the explicitly connected subscription without API-key fallback for this pilot.

Sources: [Sandbox regions](https://vercel.com/docs/sandbox/concepts/regions), [pricing and quotas](https://vercel.com/docs/sandbox/pricing), checked 2026-09-05.
