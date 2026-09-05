import { test, expect } from 'bun:test';
import { GitHubDiscovery } from '@r2cloud/adapters/github-discovery';
function mockDiscovery(userId = 123) {
  const calls: { url: string; init: RequestInit }[] = [];
  const http = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://github.com/login/oauth/access_token')
      return Response.json({ access_token: 'ghu_fixture', token_type: 'bearer', scope: '' });
    if (url === 'https://api.github.com/user') return Response.json({ id: userId });
    if (url.includes('/user/installations?'))
      return Response.json({ total_count: 1, installations: [{ id: 12, suspended_at: null }] });
    if (url.includes('/user/installations/12/repositories?'))
      return Response.json({
        total_count: 2,
        repositories: [
          {
            id: 34,
            full_name: 'team/website',
            default_branch: 'main',
            permissions: { admin: true },
          },
          {
            id: 35,
            full_name: 'team/private',
            default_branch: 'main',
            permissions: { admin: false },
          },
        ],
      });
    if (url === 'https://api.github.com/repos/team/website/branches/main')
      return Response.json({ commit: { sha: 'a'.repeat(40) } });
    throw new Error('Unexpected request');
  }) as typeof fetch;
  return { calls, http };
}
test('GitHub discovery verifies the signed-in identity and offers only administered repositories', async () => {
  const { calls, http } = mockDiscovery();
  const broker = new GitHubDiscovery(
    {
      clientId: 'app-client',
      clientSecret: 'test-secret',
      callbackURL: 'https://product.example/api/repository-callback',
    },
    http,
  );
  const repositories = await broker.discover({
    code: 'one-use-code',
    verifier: 'pkce-verifier',
    githubUserId: '123',
  });
  expect(repositories).toEqual([
    {
      id: 34,
      installationId: 12,
      fullName: 'team/website',
      defaultBranch: 'main',
      baseSha: 'a'.repeat(40),
    },
  ]);
  const body = JSON.parse(calls[0].init.body as string);
  expect(body.code_verifier).toBe('pkce-verifier');
  expect(body.client_secret).toBe('test-secret');
  expect(calls.slice(1).every((c) => !c.init.method || c.init.method === 'GET')).toBe(true);
  expect(JSON.stringify(repositories)).not.toContain('ghu_fixture');
  expect(calls.some((c) => c.url.includes('team/private'))).toBe(false);
});
test('authorizing a different GitHub user cannot discover or attach installations', async () => {
  const { calls, http } = mockDiscovery(456);
  const broker = new GitHubDiscovery(
    {
      clientId: 'app-client',
      clientSecret: 'test',
      callbackURL: 'https://product.example/api/repository-callback',
    },
    http,
  );
  await expect(
    broker.discover({ code: 'code', verifier: 'verifier', githubUserId: '123' }),
  ).rejects.toThrow('same GitHub account');
  expect(calls).toHaveLength(2);
});
