# From sign-in to a verified merge

Vercel Sandbox is the selected execution provider. The product uses GitHub-only Better Auth, Bun workspaces, React/Vite, Express, Prisma/Postgres and Socket.IO. Local commits remain local until approved for push.

## Delivery order

1. **Real entry and account flow.** GitHub sign-in with loading, retry and configuration states; no participant picker. Create the first workspace/project, reach an empty board, use the bottom-left account menu to sign out. Default development starts only the product API and frontend. Seed data and simulated workers stay in explicit test tooling.
2. **Workspace and project setup.** Create additional projects within an authorised workspace. Show actual connection readiness. Add team invitations and membership administration without granting repository or AI credentials through board membership.
3. **Repository connection.** GitHub App installation callback, installation ownership validation, selected-repository listing and checked project attachment. Resolve exact base commits and collect setup/dev/test commands. Product OAuth tokens must never become write credentials.
4. **Vercel Sandbox execution.** Pin the official SDK, use explicit project/team credentials, immutable environment configuration, unique durable allocation intents, restricted networking, isolated commands and confirmed stop. Never retry ambiguous allocation/commands as if absent. Add the Codex supervisor transport, scoped provider credential broker, immutable artifacts and resource/accounting enforcement before enabling Start work.
5. **Review journey.** Private preview gateway on a separate origin, independent browser/test evidence tied to immutable changes, correction requests and preserved ownership. A running preview alone cannot approve a changing candidate.
6. **Publication and merge.** Isolated GitHub App publisher, exact-candidate approval, uncertain-outcome reconciliation, separate merge approval, required-check verification and verified webhook/poll facts. Only verified merge moves a coding task to Completed.
7. **Release validation.** Real GitHub OAuth and App, Vercel/Codex run, private preview, correction, publication and verified merge. Validate cancellation/handoff, account revocation, expired access, retry and reconnect across the complete journey.

## Already implemented

Authoritative claims, task versions/generations, durable jobs/events, bounded batches, approval binding, reconciliation contracts, GitHub-only identity and atomic first-workspace creation. Existing tests use real private Postgres and mocked external services. They do not establish live sandbox execution or publication.

## External configuration gates

GitHub OAuth app credentials; GitHub App installation/private key/webhook secret; Vercel team/project and scoped sandbox credentials; approved run spending limits; scoped Codex credentials; private artifact storage and separate preview origin. Secrets belong in deployment configuration, never chat or committed files. Selecting Vercel does not provision a paid resource.

Remaining choices include deployment region, spending cap, initial concurrency and provider billing arrangement. Code should fail closed while these are missing and still support sign-in, project organisation and task planning.

## This increment

Implemented: product-only default entry, removed participant-picker UI, first/additional project flow, three-dot account menu and sign-out, conditional evidence/preview states, Vercel SDK control plane, durable allocation/command/snapshot intents and confirmed stop. Default development launches two processes and never seeds data.

Not complete: phases 3–7, invitations/admin membership UI in phase 2, and the live Codex supervisor portion of phase 4. See [Vercel integration boundaries](VERCEL-SANDBOX.md). These are remaining implementation tasks, not merely missing credentials. OAuth credentials also remain necessary to sign into the running product.
