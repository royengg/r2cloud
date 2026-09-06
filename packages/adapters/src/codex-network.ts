import type { NetworkPolicy, NetworkPolicyRule } from '@vercel/sandbox';
import type { ExecutionCredentials } from './vercel-execution';
export function codexNetworkPolicy(
  repository: string,
  account?: ExecutionCredentials,
): NetworkPolicy {
  const allow: Record<string, NetworkPolicyRule[]> = {
    'github.com': [
      {
        match: { method: ['GET'], path: { exact: `/${repository}.git/info/refs` } },
        transform: [],
      },
      {
        match: { method: ['POST'], path: { exact: `/${repository}.git/git-upload-pack` } },
        transform: [],
      },
    ],
    'registry.npmjs.org': [{ match: { method: ['GET', 'HEAD'] }, transform: [] }],
    'fonts.googleapis.com': [{ match: { method: ['GET'] }, transform: [] }],
    'fonts.gstatic.com': [{ match: { method: ['GET'] }, transform: [] }],
  };
  if (account)
    allow['chatgpt.com'] = [
      {
        match: { method: ['GET', 'POST'], path: { startsWith: '/backend-api/codex/' } },
        transform: [
          {
            headers: {
              authorization: `Bearer ${account.accessToken}`,
              'chatgpt-account-id': account.accountId,
            },
          },
        ],
      },
    ];
  return { allow };
}
