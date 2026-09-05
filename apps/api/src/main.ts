import { createHttpServer } from './app';
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
  ? (await import('./auth')).createIdentity({
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
const { server } = createHttpServer({ fixture, identity });
server.listen(4310, '127.0.0.1', () =>
  console.log(`R2Cloud API · ${fixture ? 'test fixtures' : 'product'} · http://127.0.0.1:4310`),
);
