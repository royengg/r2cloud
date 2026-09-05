# Vercel Sandbox integration

Vercel is the selected managed execution provider. The official `@vercel/sandbox` SDK is pinned to **3.2.1**. The shared VPS remains an API/development host; it never runs checked-out repository code as a sandbox.

## Implemented control plane

`VercelSandboxes` accepts explicit team/project/token credentials and a Postgres journal. It creates isolated, nonpersistent environments from a digest-pinned image, with explicit region, CPU and time limits. Initial networking is deny-all, environment variables are empty, and no ports are exposed. No host environment, saved Vercel account, GitHub write token or personal Codex configuration is inherited.

Postgres records allocation intent before calling Vercel. One run has one allocation; task generation and active claim are checked for each operation. Reusing an operation with changed configuration is rejected. After a creation timeout, the adapter looks up the existing name without resuming it. An absent/uncertain remote response never authorises replacement creation.

Commands record their immutable payload before dispatch. A completed receipt is reused; an unresolved receipt blocks replay. Commands target `currentSession()` directly: the SDK's higher-level `runCommand()` can automatically resume stopped sessions. Command execution has a remote timeout as well as an HTTP timeout. Neither a command exit nor a provider turn is task completion.

Snapshot intent closes command intake. Snapshot identifiers and a separately confirmed stop proof are recorded. A Vercel filesystem snapshot is not a candidate digest, test evidence, or publication approval. Unknown snapshot/stop outcomes keep ownership reserved. Preview ports stay closed until an authenticated gateway is implemented.

## Not enabled for live coding yet

The control plane is implemented and tested with the official SDK replaced by a test double. It is **not yet a complete ManagedSandboxProvider/Codex supervisor** and is not wired into the product worker. No real Vercel resource has been created.

The next integration requires a reviewed, pinned image containing Bun/Codex/browser tools; repository import with read-only credentials; a scoped model credential broker and spending enforcement; a durable Codex transport; immutable artifact export; independent checks; private preview gateway; and worker wiring. The existing generic managed harness describes those interfaces but does not implement them on Vercel yet. The default product launcher deliberately does not start a simulated worker in their place.

Credential configuration will use dedicated `R2_VERCEL_TOKEN`, `R2_VERCEL_TEAM_ID` and `R2_VERCEL_PROJECT_ID` in the worker environment. They are constructor inputs to the control plane, not auto-discovered operator credentials. Region and spending limits remain deployment decisions. A Vercel account, approval for its resource costs and live tests are still required.

## Verified sources

- [Vercel SDK reference](https://vercel.com/docs/sandbox/sdk-reference), checked 2026-09-05 and compared with installed 3.2.1 declarations and implementation. In particular, `resume: false`, `currentSession()`, snapshot-induced stop and explicit credentials affect recovery correctness.
- [Codex non-interactive automation](https://learn.chatgpt.com/docs/non-interactive-mode), checked 2026-09-05: untrusted setup/test processes must not receive model credentials. Keep the broker outside repository-controlled processes.
