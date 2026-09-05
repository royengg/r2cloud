# GitHub product sign-in

Better Auth 1.7.2 runs inside Express, using the Prisma adapter and Postgres sessions. GitHub is the only enabled sign-in provider. Email/password sign-in and automatic account linking are disabled. Product sign-in requests only `read:user` and `user:email`; client requests for repository scopes are rejected.

## Local setup

Create a dedicated GitHub OAuth app when ready to enable live sign-in. Set its homepage to the exact frontend origin and callback to `<origin>/api/auth/callback/github`. Put `BETTER_AUTH_URL`, a dedicated random `BETTER_AUTH_SECRET` of at least 32 characters, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the ignored project `.env`. See [the configuration example](../.env.example). Run migrations and restart `bun run dev`. For the existing Vite setup, the origin is `http://127.0.0.1:5173`; an approved tunnel needs the exact HTTPS URL in both `BETTER_AUTH_URL` and `R2_DEV_ORIGIN`. A changing Quick Tunnel URL requires updating the OAuth app callback too.

Partial credentials fail startup. With no credentials, the product displays an unavailable GitHub sign-in screen and rejects legacy fixture sessions. Fixture authentication is only available to explicitly configured test servers; the product has no participant-picker screen. No real OAuth credentials have been configured or tested.

## Identity and permissions

A verified GitHub identity maps by stable identity ID to one human product user, never by matching a fixture user's email. A session grants no existing organisation, repository or AI access. New users can create a workspace and first project; its creator becomes owner and initial reviewer. Creation is atomic and idempotent. The project initially has no repository or provider connection, so starting code work is blocked.

Existing checked domain services remain the authority for membership and contributor/reviewer/merge permissions. Better Auth's organisation plugin is deliberately not enabled, avoiding a second membership authority. Project invitations, recipient acceptance and versioned permission administration use that same authority; see [team and repository setup](TEAM-AND-REPOSITORY-SETUP.md). Publication and merge still require separate checked approval actions.

A GitHub OAuth sign-in app is separate from the repository GitHub App. Board membership does not share an AI account. OAuth tokens are encrypted at rest using the authentication secret; secret management and rotation require deployment configuration.

## Session boundary

Auth routes mount before Express's JSON parser. State-changing auth requests require the exact configured Origin. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS; database sessions last eight hours. Cookie caching is disabled, so server-side revocation applies to subsequent requests. Socket.IO rechecks session validity and project access. Signing out does not release task ownership.

Rate limits are stored in Postgres. The API overwrites its internal client-address header with the actual socket address, ignoring spoofed forwarding headers. Requests through a local proxy currently share that proxy's rate bucket. Before production, configure a specific trusted proxy policy and test it; do not enable unrestricted trust of forwarded IP headers.

## Verification and remaining work

HTTP/Postgres tests exercise the actual Better Auth implementation with mocked GitHub token/profile/email endpoints: callback state, verified identity, scope restrictions, encrypted token storage, session revocation, socket revocation, rate limits and isolated workspace creation. These tests never contact GitHub. The browser script intercepts the external authorization page and is also a fixture, not a live OAuth test.

The browser journey now passes after reducing concurrent development processes, with eight axe accessibility audits, including mobile team settings, repository selection and invitation acceptance. GitHub exchanges are mocked; product sessions, workspace/project creation, task creation and sign-out use the real application. Live GitHub callback/cookie behavior, approved deployment proxy settings, live repository connections and production hardening remain unverified.

## References

Implementation checked against official [Express integration](https://better-auth.com/docs/integrations/express), [Prisma adapter](https://better-auth.com/docs/adapters/prisma), [GitHub authentication](https://better-auth.com/docs/authentication/github), [session management](https://better-auth.com/docs/concepts/session-management) and [database models](https://better-auth.com/docs/concepts/database) on 2026-09-05.
