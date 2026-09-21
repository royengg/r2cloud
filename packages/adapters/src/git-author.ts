import { SetupRequired } from '@r2cloud/contracts/adapters';

export async function githubCommitAuthor(userId: string | undefined, http: typeof fetch = fetch) {
  if (!userId || !/^[1-9]\d*$/.test(userId))
    throw new SetupRequired('Start a new task run to use your connected GitHub commit identity.');
  const response = await http(`https://api.github.com/user/${userId}`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new SetupRequired('GitHub commit identity could not be verified. Retry later.');
  const profile = await response.json();
  if (
    String(profile.id) !== userId ||
    profile.type !== 'User' ||
    typeof profile.login !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(profile.login)
  )
    throw new SetupRequired('GitHub returned an invalid commit identity.');
  return { name: profile.login, email: `${userId}+${profile.login}@users.noreply.github.com` };
}
