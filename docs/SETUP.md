# Account and repository setup

## GitHub product sign-in

Better Auth 1.7.2 runs inside Express, using the Prisma adapter and Postgres sessions. GitHub is the only enabled sign-in provider. Email/password sign-in and automatic account linking are disabled. Product sign-in requests only `read:user` and `user:email`; client requests for repository scopes are rejected.

## Local setup

Create a dedicated GitHub OAuth app when ready to enable live sign-in. Set its homepage to the exact frontend origin and callback to `<origin>/api/auth/callback/github`. Put `BETTER_AUTH_URL`, a dedicated random `BETTER_AUTH_SECRET` of at least 32 characters, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the ignored project `.env`. See [the configuration example](../.env.example). Run migrations and restart `bun run dev`. For the existing Vite setup, the origin is `http://127.0.0.1:5173`; an approved tunnel needs the exact HTTPS URL in both `BETTER_AUTH_URL` and `R2_DEV_ORIGIN`. A changing Quick Tunnel URL requires updating the OAuth app callback too.

Partial credentials fail startup. With no credentials, the product displays an unavailable GitHub sign-in screen and rejects legacy fixture sessions. Fixture authentication is only available to explicitly configured test servers; the product has no participant-picker screen. Product OAuth credentials are configured in the local environment; the automated OAuth checks use mocked GitHub exchanges.

## Identity and permissions

A verified GitHub identity maps by stable identity ID to one human product user, never by matching a fixture user's email. A session grants no existing organisation, repository or AI access. New users can create a workspace and first project; its creator becomes owner and initial reviewer. Creation is atomic and idempotent. The project initially has no repository or provider connection, so starting code work is blocked.

Existing checked domain services remain the authority for membership and contributor/reviewer/merge permissions. Better Auth's organisation plugin is deliberately not enabled, avoiding a second membership authority. Project invitations, recipient acceptance and versioned permission administration use that same authority; see [team and repository setup](SETUP.md#team-and-repository-setup). Publication and merge still require separate checked approval actions.

A GitHub OAuth sign-in app is separate from the repository GitHub App. Board membership does not share an AI account. OAuth tokens are encrypted at rest using the authentication secret; secret management and rotation require deployment configuration.

## Session boundary

Auth routes mount before Express's JSON parser. State-changing auth requests require the exact configured Origin. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS; database sessions last eight hours. Cookie caching is disabled, so server-side revocation applies to subsequent requests. Socket.IO rechecks session validity and project access. Signing out does not release task ownership.

Rate limits are stored in Postgres. The API overwrites its internal client-address header with the actual socket address, ignoring spoofed forwarding headers. Requests through a local proxy currently share that proxy's rate bucket. Before production, configure a specific trusted proxy policy and test it; do not enable unrestricted trust of forwarded IP headers.

## Verification and remaining work

HTTP/Postgres tests exercise the actual Better Auth implementation with mocked GitHub token/profile/email endpoints: callback state, verified identity, scope restrictions, encrypted token storage, session revocation, socket revocation, rate limits and isolated workspace creation. These tests never contact GitHub. The browser script intercepts the external authorization page and is also a fixture, not a live OAuth test.

The last full browser journey passed with eight axe accessibility audits, including mobile team settings, repository selection and invitation acceptance. GitHub exchanges are mocked; product sessions, workspace/project creation, task creation and sign-out use the real application. Live GitHub callback/cookie behavior, approved deployment proxy settings, live repository connections and production hardening remain unverified.

## References

Implementation checked against official [Express integration](https://better-auth.com/docs/integrations/express), [Prisma adapter](https://better-auth.com/docs/adapters/prisma), [GitHub authentication](https://better-auth.com/docs/authentication/github), [session management](https://better-auth.com/docs/concepts/session-management) and [database models](https://better-auth.com/docs/concepts/database) on 2026-09-05.

## Team and repository setup

## Product flow

An owner opens the participant button to manage project access. They create an invitation for a GitHub sign-in email and choose contribution, publication review and merge-authorisation permissions independently. The recipient sees an invitation inbox after GitHub sign-in, reviews those permissions and explicitly joins. No email is sent: the sender asks the recipient to sign in. Invites expire after seven days and can be revoked. Dismissed invitations remain accessible from onboarding or the board.

Project access changes use expected versions. Removing access stops future checked commands but preserves outstanding ownership/execution records. The last human reviewer cannot be removed. Workspace administrator promotion and ownership transfer are separate remaining work.

In Connections, a project administrator authorizes the repository GitHub App, selects a verified repository and confirms attachment. If the App has no suitable installation, a link opens its installation settings; reconnecting refreshes choices. Empty repositories need an initial commit. The pilot offers at most 20 administered repositories and requires selected-repository installations when larger lists exceed its bounds.

## GitHub configuration

Product sign-in's OAuth app and the repository GitHub App are distinct registrations. Configure the repository App's callback as `<BETTER_AUTH_URL>/api/repository-callback`. Its client ID and slug belong in the normal project `.env` as `R2_GITHUB_APP_CLIENT_ID` and `R2_GITHUB_APP_SLUG`. Keep its client secret only in ignored `.env.broker`, using [the example](../.env.broker.example). Normal development starts the connection broker when this file exists. The App should have repository metadata and contents read access for discovery. Future publication permissions belong to the isolated publisher path.

The launcher disables child Bun automatic dotenv loading, strips the App secret from API/frontend environment variables, and loads `.env.broker` only for the connection broker. The standalone API fails startup if the App secret is present. Production deployment must assign separate credentials and least-privilege database roles per process; development shares a private database role and is not a claim of production process isolation.

Authorization uses a random state bound to the authenticated product actor and project, plus PKCE. The broker exchanges the code and verifies `/user` against the stable GitHub identity used for product sign-in. It then lists installations and repositories accessible to that GitHub App user token, restricting choices to repository administrators. Callback installation IDs and client-supplied repository names are never trusted.

Only verified repository metadata leaves the broker. Access and refresh tokens are not stored in the database or returned to the API/browser. Temporary codes/verifiers are wiped when claimed, and expired queued requests are cleaned by the broker. Uncertain code exchange is not retried: reconnecting creates new authorization. Verified choices expire after ten minutes; attachment checks current product administrator access and supports duplicate confirmation safely. Repository permissions and current refs must be revalidated again before live execution/publication.

## Verification and remaining gates

Tests use real Postgres, Better Auth and HTTP/Socket.IO with mocked GitHub endpoints. The browser journey covers repository selection and invitation acceptance. No live repository App authorization, discovery or attachment has been tested. Configure actual App credentials and a test installation to perform that validation. No GitHub write operations are performed by discovery.

Remaining integration work includes repository setup-command profiles, revocation webhooks and continuous repository permission refresh, the Codex credential broker and Vercel supervisor, private artifact/preview infrastructure, the isolated publisher, verified merge facts and handoff recovery.

Sources checked on 2026-09-05: [GitHub setup URL security](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url), [GitHub App user access-token flow and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app), and [installation/repository access endpoints](https://docs.github.com/en/rest/apps/installations).
