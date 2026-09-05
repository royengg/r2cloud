import { SetupRequired } from '@r2cloud/contracts/adapters';
export type DiscoveredRepository = {
  id: number;
  installationId: number;
  fullName: string;
  defaultBranch: string;
  baseSha: string;
};
export interface RepositoryDiscovery {
  discover(input: {
    code: string;
    verifier: string;
    githubUserId: string;
  }): Promise<DiscoveredRepository[]>;
}
/** Only the connection broker process receives this GitHub App client secret. */
export class GitHubDiscovery implements RepositoryDiscovery {
  constructor(
    private config: { clientId: string; clientSecret: string; callbackURL: string },
    private http: typeof fetch = fetch,
  ) {
    if (!config.clientId || !config.clientSecret || !config.callbackURL)
      throw new SetupRequired('GitHub App authorization is not configured.');
  }
  async discover(input: { code: string; verifier: string; githubUserId: string }) {
    const tokenResponse = await this.http('https://github.com/login/oauth/access_token', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.callbackURL,
        code: input.code,
        code_verifier: input.verifier,
      }),
    });
    const token = (await tokenResponse.json()) as any;
    if (!tokenResponse.ok || typeof token.access_token !== 'string' || token.error)
      throw new SetupRequired('GitHub authorization could not be verified. Reconnect GitHub.');
    const get = async (path: string) => {
      const response = await this.http('https://api.github.com' + path, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token.access_token}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
      if (!response.ok)
        throw new SetupRequired(
          'GitHub repository access could not be verified. Reconnect GitHub.',
        );
      return response.json() as Promise<any>;
    };
    const user = await get('/user');
    if (String(user.id) !== input.githubUserId)
      throw new SetupRequired('Connect the same GitHub account you use to sign in.');
    const installations = await get('/user/installations?per_page=100');
    if (!Array.isArray(installations.installations) || installations.total_count > 100)
      throw new SetupRequired(
        'Too many installations for this connection. Contact the workspace administrator.',
      );
    const repositories: DiscoveredRepository[] = [];
    for (const installation of installations.installations) {
      if (installation.suspended_at) continue;
      if (!Number.isSafeInteger(installation.id)) throw new Error('Invalid installation identity.');
      const page = await get(`/user/installations/${installation.id}/repositories?per_page=100`);
      if (!Array.isArray(page.repositories) || page.total_count > 100)
        throw new SetupRequired(
          'Limit this GitHub App installation to selected repositories before connecting.',
        );
      for (const repository of page.repositories) {
        // Only repository administrators may introduce a repository to a product workspace.
        if (!repository.permissions?.admin || repository.archived || repository.disabled) continue;
        if (repositories.length >= 20)
          throw new SetupRequired('Select at most 20 repositories for this pilot installation.');
        if (
          !Number.isSafeInteger(repository.id) ||
          !/^[-\w.]+\/[-\w.]+$/.test(repository.full_name) ||
          typeof repository.default_branch !== 'string'
        )
          throw new Error('Invalid repository identity.');
        const branch = await get(
          `/repos/${repository.full_name}/branches/${encodeURIComponent(repository.default_branch)}`,
        );
        if (!/^[a-f0-9]{40}$/.test(branch.commit?.sha))
          throw new SetupRequired(
            'The repository needs an initial commit before it can be connected.',
          );
        repositories.push({
          id: repository.id,
          installationId: installation.id,
          fullName: repository.full_name,
          defaultBranch: repository.default_branch,
          baseSha: branch.commit.sha,
        });
      }
    }
    // Neither access nor refresh tokens leave this broker call or enter database results/logs.
    return repositories;
  }
}
