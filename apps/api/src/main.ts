import { createHttpServer } from './app';
if (process.env.R2_MODE !== 'fixture')
  throw new Error(
    'Managed mode requires product sign-in, sandbox, preview, storage and GitHub adapters. Fixture login is never enabled implicitly.',
  );
if (process.env.R2_AUTH_MODE && !['fixture', 'better-auth'].includes(process.env.R2_AUTH_MODE))
  throw new Error('Unknown R2_AUTH_MODE; choose fixture or better-auth explicitly.');
const identity =
  process.env.R2_AUTH_MODE === 'better-auth'
    ? (await import('./auth')).createIdentity({
        baseURL: process.env.BETTER_AUTH_URL ?? '',
        secret: process.env.BETTER_AUTH_SECRET ?? '',
        githubClientId: process.env.GITHUB_CLIENT_ID ?? '',
        githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
      }).identity
    : undefined;
const { server } = createHttpServer({ fixture: true, identity });
server.listen(4310, '127.0.0.1', () =>
  console.log('R2Cloud API · local fixture mode · http://127.0.0.1:4310'),
);
