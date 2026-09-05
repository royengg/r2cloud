# Team and repository setup

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
