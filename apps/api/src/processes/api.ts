if (process.env.R2_GITHUB_APP_CLIENT_SECRET || process.env.R2_CODEX_VAULT_KEY)
  throw new Error(
    'Keep GitHub App and Codex vault secrets in their broker environments, not the API environment.',
  );
import { createHttpServer } from '../server';
const fixture = process.env.R2_MODE === 'fixture';
if (process.env.R2_MODE && !['fixture', 'product'].includes(process.env.R2_MODE))
  throw new Error('Unknown R2_MODE.');
const configured = Boolean(
  process.env.GITHUB_CLIENT_ID &&
  process.env.GITHUB_CLIENT_SECRET &&
  process.env.BETTER_AUTH_SECRET &&
  process.env.BETTER_AUTH_URL,
);
const identity = configured
  ? (await import('../auth/identity')).createIdentity({
      baseURL: process.env.BETTER_AUTH_URL!,
      secret: process.env.BETTER_AUTH_SECRET!,
      githubClientId: process.env.GITHUB_CLIENT_ID!,
      githubClientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }).identity
  : undefined;
if (
  !configured &&
  [
    process.env.GITHUB_CLIENT_ID,
    process.env.GITHUB_CLIENT_SECRET,
    process.env.BETTER_AUTH_SECRET,
  ].some(Boolean)
)
  throw new Error('GitHub authentication configuration is incomplete.');
const repositoryConnection =
  identity && process.env.R2_GITHUB_APP_CLIENT_ID && process.env.R2_GITHUB_APP_SLUG
    ? {
        clientId: process.env.R2_GITHUB_APP_CLIENT_ID,
        appSlug: process.env.R2_GITHUB_APP_SLUG,
        callbackURL: identity.origin + '/api/repository-callback',
      }
    : undefined;
if (repositoryConnection && !/^[a-z0-9-]+$/.test(repositoryConnection.appSlug))
  throw new Error('Invalid GitHub App slug.');
const { server } = createHttpServer({
  fixture,
  identity,
  repositoryConnection,
  codexLogin: process.env.R2_CODEX_LOGIN_ENABLED === 'true',
});
server.listen(4310, '127.0.0.1', () =>
  console.log(`R2Cloud API · ${fixture ? 'test fixtures' : 'product'} · http://127.0.0.1:4310`),
);
