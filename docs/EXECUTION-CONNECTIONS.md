# Repository, sandbox and Codex execution setup

## Connection flow

1. Sign in to r2cloud with the GitHub OAuth app.
2. An administrator authorizes the separate repository GitHub App and selects a repository verified by the discovery broker. Product sign-in credentials cannot authorize repository writes.
3. Save repository install/dev/test commands, working directory, preview port, health path and maximum run time/budget. Saving settings does not execute commands or provision Vercel resources.
4. Connect a personal Codex subscription using the Codex app-server device-code flow, with explicit project scope. This broker step is still pending implementation; the protocol adapter is implemented and tested with mocks.
5. Start an individually authorized task. The transaction pins the profile version and digest into the run, checks the requested limits and retains exclusive task ownership. The managed adapter validates that immutable profile before asking a supervisor for a sandbox.

## Implemented API

- `GET /api/projects/:projectId/execution-setup`: project-authorized settings and truthful integration readiness; provider metadata is scoped to the signed-in person. No secret references are returned.
- `POST /api/projects/:projectId/execution-setup`: administrator-only, `Idempotency-Key` required, body `{version, config}`. Version zero creates the profile; updates require the last observed version. Reusing a key with a different payload is rejected.

The schema lives in `packages/contracts/src/execution.ts`. Commands use executable/argument arrays, not an interpolated host shell. Their contents remain untrusted repository instructions and must execute only inside the managed sandbox. The profile cannot choose credentials, images, arbitrary network policies or publication authority. Runtime image, region and secret/network policies belong to the trusted supervisor configuration.

Profile changes affect future runs; existing runs retain their immutable setup. Every managed run, including an authorized batch, must satisfy the same limits. A dollar cap in the profile is an authorization limit, not a claim that Vercel or Codex supports exact dollar enforcement. Live startup must remain disabled until metering and termination enforcement exist.

## Subscription authentication decision

Use the Codex executable in `app-server` mode for execution and structured events. Its `account/login/start` request with `type: chatgptDeviceCode` supplies a verification URL and one-time code. Codex owns OAuth/token refresh; r2cloud should not implement a substitute OAuth exchange or reuse GitHub OAuth credentials. The adapter allowlists the official device verification destination and returns only ceremony fields.

The trusted broker must run a dedicated per-person login context, match completion to the pending attempt, then verify account health and applicable plan access. Login completion alone cannot enable arbitrary project runs. Cancellation/logout/rate-limit adapter methods exist; the durable login coordinator, encrypted credential custody, account locking, revocation and UI are still pending. Never expose token/auth files through API responses, project events, logs, repository checkouts or review snapshots. A subscription is not implicitly shared with collaborators. External-token login is experimental and not the proposed default.

The current local Codex executable reports 0.153.2. This protocol increment has mocked tests, not a live login validation against that binary. A supported pinned version must pass a live contract check before enabling the broker. OpenAI recommends API keys by default for automation; subscription availability and workspace restrictions must be checked for each intended account/use case.

## Remaining live gates

GitHub product OAuth is configured. The separate repository App client configuration/installations are not yet configured here. Vercel credentials, approved region/spend, trusted image, a complete supervisor transport, private preview/object storage and credential broker remain outstanding. The status endpoint deliberately returns `ready: false`; the device-code method is not advertised as a working account-link button. No paid resources or live Codex login were initiated by this increment.

Sources checked on 2026-09-05: [Codex authentication](https://learn.chatgpt.com/docs/auth), [app-server authentication](https://learn.chatgpt.com/docs/app-server), [Vercel Sandbox lifecycle](https://vercel.com/docs/sandbox/working-with-sandbox).

## Verification

On 2026-09-05, all 55 tests passed (264 assertions), including real private Postgres/HTTP policy tests and mocked Codex/Vercel protocol tests. Prisma generation/migration deployment and the TypeScript/Vite build passed. New checks cover administrator/version/idempotency enforcement, path traversal rejection, run-limit rollback with no claim/run left behind, pinned-profile tampering and device-login destination/response filtering. No real external execution or subscription sign-in was tested.
