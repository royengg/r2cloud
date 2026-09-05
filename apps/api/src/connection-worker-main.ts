import { GitHubDiscovery } from '@r2cloud/adapters/github-discovery';
import { discoverOne } from '@r2cloud/core/repository-connections';
// This process owns App OAuth exchange credentials. The API and runner do not receive them.
const backend = new GitHubDiscovery({
  clientId: process.env.R2_GITHUB_APP_CLIENT_ID ?? '',
  clientSecret: process.env.R2_GITHUB_APP_CLIENT_SECRET ?? '',
  callbackURL: (process.env.BETTER_AUTH_URL ?? '') + '/api/repository-callback',
});
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
console.log('Repository connection broker ready');
while (!stopping) {
  try {
    if (!(await discoverOne(backend))) await new Promise((r) => setTimeout(r, 1000));
  } catch {
    console.error('Repository discovery deferred.');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
process.exit(0);
