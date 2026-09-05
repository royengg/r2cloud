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

Credential configuration will use dedicated `R2_VERCEL_TOKEN`, `R2_VERCEL_TEAM_ID` and `R2_VERCEL_PROJECT_ID` in the worker environment. They are constructor inputs to the control plane, not auto-discovered operator credentials. Pilot region and spending policy are recorded below. A Vercel account with verified Hobby eligibility and remaining quota, dedicated credentials and live tests are still required.

## Verified sources

- [Vercel SDK reference](https://vercel.com/docs/sandbox/sdk-reference), checked 2026-09-05 and compared with installed 3.2.1 declarations and implementation. In particular, `resume: false`, `currentSession()`, snapshot-induced stop and explicit credentials affect recovery correctness.
- [Codex non-interactive automation](https://learn.chatgpt.com/docs/non-interactive-mode), checked 2026-09-05: untrusted setup/test processes must not receive model credentials. Keep the broker outside repository-controlled processes.


## Personal pilot policy — 2026-09-05

The user is testing alone from Kolkata, India, on their own repositories, using free limits only. Paid usage authorization is **$0**. Do not upgrade plans, enable paid overages or switch to API billing automatically.

Use Paris (`cdg1`) as the pilot region: it is geographically closest to Kolkata among the currently documented Sandbox regions (`iad1`, `sfo1`, `cle1`, `cdg1`). This is a geographic choice, not a measured latency result. There is no documented India or Singapore Sandbox region. Reconsider once data/storage locations and measured latency are known.

Conservative implementation defaults: one concurrent run, 2 vCPUs, 10-minute session timeout, no automatic timeout extension or region failover. These are proposed operational limits within the user’s free-only testing constraint, not additional confirmed product requirements. Stop idle execution and keep snapshot retention bounded. Account plan and remaining quotas must be verified before launching; unknown eligibility blocks creation. No real sandbox has been provisioned under this policy yet.

Vercel currently documents Hobby allowances of 5 active CPU hours/month, 420 GB-hours of provisioned memory/month, 5,000 creations/month, 20 GB transfer/month and 15 GB lifetime snapshot storage. Hobby pauses creation at quota exhaustion instead of charging overages. Pro uses credits and then paid usage, so it cannot be treated as equivalent to Hobby free testing. These allowances cover sandbox infrastructure, not OpenAI model usage; use the explicitly connected subscription without API-key fallback for this pilot.

Sources: [Sandbox regions](https://vercel.com/docs/sandbox/concepts/regions), [pricing and quotas](https://vercel.com/docs/sandbox/pricing), checked 2026-09-05.
