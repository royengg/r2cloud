# Remaining delivery plan

## Flow and implementation boundaries

| Increment | User journey | Code boundary | Acceptance gate |
| --- | --- | --- | --- |
| Team access | Invite a teammate → sign in → inspect permissions → accept → enter project | Checked team service, versioned access, invitation inbox | Wrong recipient, stale invite, revoked inviter and cross-tenant requests rejected; no shared AI credentials |
| Repository setup | Connections → install GitHub App → select repository → confirm setup commands | Installation broker and checked repository service, independent of login OAuth | Signed callback/webhook facts, selected-repository checks and exact base commit; no write key in API/runner |
| Execution setup | Connect Codex → choose bounded run limits → Start work | Credential broker + Vercel supervisor behind existing execution interface | Immutable grant, single current session, budget/time enforcement and no inherited credentials |
| Review | Try private preview → inspect evidence → request changes or approve candidate | Preview gateway and private immutable artifact store | Access expires/revokes, separate origin, evidence bound to candidate digest |
| Publication | Approve exact candidate → PR created → separately authorise merge | Isolated publisher and GitHub reconciliation | No duplicate PR after timeout, required checks evaluated, verified merge fact before Completed |
| Recovery | Reconnect or inspect blocked run → stop confirmed → preserve work → hand off | Coordinator and supervisor state transitions | Old generation cannot mutate; missed heartbeat cannot release ownership |

Each increment includes its API, UI, migration, negative-path tests and local commit. Components own presentation; hooks own request/loading state; checked services own policy and transactions; adapters own external protocols. Avoid a second membership authority inside the auth library and avoid external calls inside database transactions.

## Team-access choices

Invitations are addressed to the recipient's verified GitHub email and displayed after sign-in. The recipient sees the project and proposed permissions before accepting. No email is sent, and a guessed email address never grants immediate membership. Invitations expire after seven days, can be revoked and must still have a currently authorised inviter at acceptance time. Acceptance adds only project access and ordinary workspace membership. Existing project permissions are not silently upgraded through a duplicate invitation.

Project permission updates use expected versions. Removing project access retains task ownership and execution records; it never implies a stopped agent. A project must retain a human reviewer. Invitations and access changes are audited without putting recipient addresses in general project activity.

## External gates

GitHub product OAuth is configured. Repository App credentials, scoped Codex credentials, Vercel project/team access, approved spending/region, object storage and a separate preview domain remain absent. Test doubles are restricted to test tooling. Provider selection alone does not enable live resource creation. Missing integrations must leave truthful setup/blocked states, with planning still usable.

## Implemented in this increment

Team invitations/inbox, permission editing and revocation, last-reviewer protection and ownership preservation are implemented. Repository App authorization uses PKCE and a separate discovery broker; verified selection and project attachment are implemented. Both flows are wired into the product UI. Discovery performs reads only; it is not the publisher.

Live Codex credential scope is awaiting the user's choice (project keys, organization key, or investigation of hosted subscription auth). This affects the next account-connection and broker increment. No credential entitlement or paid sandbox use is assumed. See [setup details](TEAM-AND-REPOSITORY-SETUP.md).

## Execution setup increment

Versioned repository execution profiles, checked read/write APIs, immutable per-run profile pinning and Codex device-login protocol methods are implemented. [Execution connection details](EXECUTION-CONNECTIONS.md) distinguish these from the pending live credential broker and Vercel supervisor. No live subscription link or sandbox run has been completed.
