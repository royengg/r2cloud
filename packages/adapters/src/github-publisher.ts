import { createSign } from 'node:crypto';
import { Fault, requireThat } from '@r2cloud/contracts/domain';
import { SetupRequired, Uncertain } from '@r2cloud/contracts/adapters';
import type {
  PublicationGrant,
  PublicationResult,
  MergeResult,
  PublisherBackend,
} from '@r2cloud/contracts/adapters';
import { pushPublicationBundle } from './publication-git';

export class GitHubPublisher implements PublisherBackend {
  readonly mode = 'github' as const;
  constructor(
    private config: { appId: string; privateKey: string },
    private http: typeof fetch = fetch,
    private push = pushPublicationBundle,
  ) {
    if (!config.appId || !config.privateKey)
      throw new SetupRequired('Configure the isolated GitHub publisher.');
  }

  private async client(grant: PublicationGrant) {
    const identity = grant.github;
    requireThat(
      identity &&
        Number.isSafeInteger(identity.repositoryId) &&
        Number.isSafeInteger(identity.installationId) &&
        /^\d+$/.test(identity.approverId),
      409,
      'Verified GitHub repository and approver identities are required.',
    );
    requireThat(
      !grant.candidate.fixture && /^[-\w.]+\/[-\w.]+$/.test(grant.candidate.repository),
      409,
      'Invalid publication repository.',
    );
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload =
      encode({ alg: 'RS256', typ: 'JWT' }) +
      '.' +
      encode({ iat: now - 60, exp: now + 540, iss: this.config.appId });
    const jwt =
      payload +
      '.' +
      createSign('RSA-SHA256').update(payload).sign(this.config.privateKey, 'base64url');
    const request = async (token: string, path: string, method = 'GET', body?: unknown) => {
      let response: Response;
      try {
        response = await this.http('https://api.github.com' + path, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer ' + token,
            'X-GitHub-Api-Version': '2026-03-10',
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new Uncertain('GitHub did not confirm the request. Reconciliation is required.');
      }
      if (response.status === 404 && method === 'GET') return null;
      if ([401, 403].includes(response.status))
        throw new SetupRequired(
          'GitHub denied access. Check the App installation and repository permissions.',
        );
      if (response.status >= 500 || response.status === 429)
        throw new Uncertain('GitHub is temporarily unavailable. The operation will be reconciled.');
      if (!response.ok)
        throw new Fault(
          409,
          `GitHub rejected the ${method} request (${response.status}). Check branch rules and PR status.`,
        );
      return response.json();
    };
    const installation = await request(
      jwt,
      `/app/installations/${identity.installationId}/access_tokens`,
      'POST',
      {
        repository_ids: [identity.repositoryId],
        permissions: { contents: 'write', pull_requests: 'write', checks: 'read' },
      },
    );
    requireThat(
      typeof installation?.token === 'string',
      502,
      'GitHub did not issue a scoped token.',
    );
    const call = (path: string, method?: string, body?: unknown) =>
      request(installation.token, path, method, body);
    const repo = '/repos/' + grant.candidate.repository;
    const facts = await call(repo);
    requireThat(
      facts?.id === identity.repositoryId && !facts.archived && !facts.disabled,
      409,
      'The connected repository is unavailable or has changed.',
    );
    const authorize = async () => {
      const user = await call('/user/' + identity.approverId);
      requireThat(
        user?.id && String(user.id) === identity.approverId && typeof user.login === 'string',
        403,
        'The approving GitHub account is unavailable.',
      );
      const permission = await call(
        repo + '/collaborators/' + encodeURIComponent(user.login) + '/permission',
      );
      requireThat(
        permission && ['write', 'maintain', 'admin'].includes(permission.permission),
        403,
        'The approver needs GitHub write access to this repository.',
      );
    };
    return { call, repo, authorize, token: installation.token };
  }

  private result(grant: PublicationGrant, pr: any): PublicationResult {
    const c = grant.candidate;
    requireThat(
      pr &&
        Number.isSafeInteger(pr.number) &&
        pr.head?.sha === c.headSha &&
        pr.head.ref === c.branch &&
        pr.head.repo?.id === grant.github?.repositoryId &&
        pr.base?.repo?.id === grant.github?.repositoryId &&
        pr.base.ref === c.targetRef,
      409,
      'The PR no longer matches the approved repository, branch or commit.',
    );
    return {
      prNumber: pr.number,
      url: `https://github.com/${c.repository}/pull/${pr.number}`,
      headSha: c.headSha,
      repository: c.repository,
      targetRef: c.targetRef,
      branch: c.branch,
    };
  }

  async observe(grant: PublicationGrant) {
    const { call, repo } = await this.client(grant);
    if (grant.action === 'merge') {
      requireThat(grant.publication, 409, 'A published PR is required.');
      const pr = await call(repo + '/pulls/' + grant.publication.prNumber);
      const result = this.result(grant, pr);
      if (pr.merged && /^[a-f0-9]{40}$/.test(pr.merge_commit_sha)) {
        await this.checksPassed({ call, repo }, grant);
        return {
          state: 'finished' as const,
          result: {
            ...result,
            merged: true,
            mergeSha: pr.merge_commit_sha,
            requiredChecksPassed: true,
          },
        };
      }
      requireThat(pr.state === 'open', 409, 'The PR was closed without merging.');
      return { state: 'absent' as const };
    }
    const query = new URLSearchParams({
      state: 'all',
      head: grant.candidate.repository.split('/')[0] + ':' + grant.candidate.branch,
      base: grant.candidate.targetRef,
      per_page: '100',
    });
    const prs = await call(repo + '/pulls?' + query);
    requireThat(
      Array.isArray(prs) && prs.length < 100,
      409,
      'Unable to reconcile the published PR.',
    );
    const pr = prs.find((value: any) => value.body?.includes(this.marker(grant)));
    if (!pr) {
      requireThat(
        prs.length === 0,
        409,
        'This branch already has a PR that was not created by this publication.',
      );
      return { state: 'absent' as const };
    }
    const verified = await call(repo + '/pulls/' + pr.number);
    requireThat(
      verified?.state === 'open' || verified?.merged,
      409,
      'The published PR was closed without merging.',
    );
    return { state: 'finished' as const, result: this.result(grant, verified) };
  }

  private marker(grant: PublicationGrant) {
    return `<!-- r2cloud-publication:${grant.operationId}:${grant.digest} -->`;
  }

  async publish(grant: PublicationGrant, authorize = async () => {}) {
    const client = await this.client(grant);
    await this.push(grant.candidate, client.token, async () => {
      await authorize();
      await client.authorize();
    });
    await authorize();
    await client.authorize();
    const pr = await client.call(client.repo + '/pulls', 'POST', {
      title: (grant.candidate.summary.split('\n')[0] || 'Task changes').slice(0, 180),
      body: grant.candidate.summary.slice(0, 20000) + '\n\n' + this.marker(grant),
      head: grant.candidate.branch,
      base: grant.candidate.targetRef,
    });
    return this.result(grant, pr);
  }

  private async checksPassed(
    client: Pick<Awaited<ReturnType<GitHubPublisher['client']>>, 'call' | 'repo'>,
    grant: PublicationGrant,
  ) {
    const [status, checks] = await Promise.all([
      client.call(client.repo + '/commits/' + grant.candidate.headSha + '/status'),
      client.call(client.repo + '/commits/' + grant.candidate.headSha + '/check-runs?per_page=100'),
    ]);
    requireThat(
      status &&
        (status.total_count === 0 || status.state === 'success') &&
        checks &&
        checks.total_count <= 100 &&
        Array.isArray(checks.check_runs) &&
        checks.check_runs.length === checks.total_count &&
        checks.check_runs.every(
          (check: any) =>
            check.status === 'completed' &&
            ['success', 'neutral', 'skipped'].includes(check.conclusion),
        ),
      409,
      'Wait for GitHub checks to pass before merging.',
    );
  }

  async merge(grant: PublicationGrant, authorize = async () => {}): Promise<MergeResult> {
    const client = await this.client(grant);
    requireThat(grant.publication, 409, 'A published PR is required.');
    const path = client.repo + '/pulls/' + grant.publication.prNumber;
    const pr = await client.call(path);
    this.result(grant, pr);
    requireThat(
      pr.state === 'open' && !pr.draft && pr.mergeable === true && pr.mergeable_state === 'clean',
      409,
      'GitHub has not marked this PR ready to merge. Resolve checks, reviews or conflicts first.',
    );
    await this.checksPassed(client, grant);
    await authorize();
    await client.authorize();
    const merged = await client.call(path + '/merge', 'PUT', {
      sha: grant.candidate.headSha,
      merge_method: 'merge',
    });
    requireThat(merged.merged === true, 409, 'GitHub did not merge this PR.');
    const verified = await client.call(path);
    const result = this.result(grant, verified);
    requireThat(
      verified.merged && /^[a-f0-9]{40}$/.test(verified.merge_commit_sha),
      409,
      'GitHub has not confirmed the merge.',
    );
    return {
      ...result,
      merged: true,
      mergeSha: verified.merge_commit_sha,
      requiredChecksPassed: true,
    };
  }
}
