import { digest } from '@r2cloud/contracts/hash';
import { test, expect } from 'bun:test';
import { CodexHarness, type CodexTransport } from '@r2cloud/adapters/codex';
import { ManagedCodexExecution, type ManagedSandboxProvider } from '@r2cloud/adapters/managed';
import type { RunGrant } from '@r2cloud/contracts/adapters';
function transport() {
  const calls: { key: string; method: string; params: any }[] = [],
    replies: any[] = [];
  let listener: (m: any) => void = () => {};
  const t: CodexTransport = {
    requestOnce: async <T>(key: string, method: string, params: any) => {
      calls.push({ key, method, params });
      return (
        method === 'account/read'
          ? { account: { type: 'apiKey' }, requiresOpenaiAuth: true }
          : method === 'thread/start'
            ? { thread: { id: 'thread' } }
            : method === 'turn/start'
              ? { turn: { id: 'turn', status: 'inProgress' } }
              : {}
      ) as T;
    },
    notify: async (method) => {
      calls.push({ key: '', method, params: {} });
    },
    reply: async (id, result) => {
      replies.push({ id, result });
    },
    onMessage: (fn) => {
      listener = fn;
      return () => {};
    },
  };
  return { t, calls, replies, emit: (m: any) => listener(m) };
}
test('Codex protocol adapter initializes, checks auth, starts/resumes and interrupts', async () => {
  const x = transport(),
    h = new CodexHarness(x.t);
  await h.initialize('connection');
  expect((await h.health('health')).account).toEqual({ type: 'apiKey' });
  await h.start('start', '/workspace/repository');
  await h.resume('resume', 'thread');
  await h.input('input', 'thread', 'Improve the welcome');
  await h.interrupt('interrupt', 'thread', 'turn');
  expect(x.calls.map((c) => c.method)).toEqual([
    'initialize',
    'initialized',
    'account/read',
    'thread/start',
    'thread/resume',
    'turn/start',
    'turn/interrupt',
  ]);
  expect(x.calls.find((c) => c.method === 'thread/start')!.params.approvalPolicy).toBe('never');
});
test('provider completion and permission events cannot approve product publication', async () => {
  const x = transport(),
    h = new CodexHarness(x.t);
  let ended = 0,
    permissions = 0;
  h.on('turnEnded', () => ended++);
  h.on('permission', (p) => {
    permissions++;
    void h.denyPermission(p.id);
  });
  x.emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  x.emit({
    id: 8,
    method: 'item/commandExecution/requestApproval',
    params: { command: 'git push' },
  });
  await Promise.resolve();
  expect(ended).toBe(1);
  expect(permissions).toBe(1);
  expect(x.replies).toEqual([{ id: 8, result: { decision: 'decline' } }]);
  expect(x.calls).toHaveLength(0);
});
test('managed path requires isolated environment and independent check/snapshot/stop evidence', async () => {
  const x = transport();
  let spec: any,
    checked = false;
  const grant: RunGrant = {
    operationId: 'op',
    runId: 'run',
    taskId: 'task',
    projectId: 'p',
    orgId: 'o',
    generation: 1,
    outcome: 'A clear first step',
    criteria: ['Clear action'],
    feedback: [],
    config: {
      repository: 'org/repo',
      baseSha: 'a'.repeat(40),
      targetRef: 'main',
      minutes: 15,
      budgetCents: 300,
      skills: [{ id: 'web-review', version: '1', digest: 'pinned' }],
      mode: 'byok-proposed',
    },
  };
  const config = {
    directory: '.',
    install: { cmd: 'bun', args: ['install'] },
    dev: { cmd: 'bun', args: ['run', 'dev'] },
    tests: [{ cmd: 'bun', args: ['test'] }],
    port: 3000,
    healthPath: '/',
    maxMinutes: 20,
    maxBudgetCents: 500,
    vcpus: 2 as const,
  };
  grant.config.executionSetup = { version: 1, digest: digest(config), config };
  const provider: ManagedSandboxProvider = {
    observe: async () => ({ state: 'absent' }),
    ensure: async (_op, s) => {
      spec = s;
      return {
        transport: x.t,
        waitForTurn: async () => ({ status: 'completed' }),
        checkSnapshotAndStop: async () => {
          checked = true;
          return { manifest: {} as any, evidence: {} as any, stopProof: 'supervisor' };
        },
      };
    },
  };
  const result = await new ManagedCodexExecution(provider).start(grant);
  expect(checked).toBe(true);
  expect(result.stopProof).toBe('supervisor');
  expect(spec.githubWrites).toBe(false);
  expect(spec.inheritHostEnvironment).toBe(false);
  expect(spec.inheritProviderConfig).toBe(false);
  expect(spec.isolatedBrowser).toBe(true);
  expect(spec.skills).toEqual(grant.config.skills);
  expect(spec.executionSetup).toEqual(grant.config.executionSetup);
  grant.config.executionSetup.digest = 'tampered';
  await expect(new ManagedCodexExecution(provider).start(grant)).rejects.toThrow(
    'identity or limits',
  );
});

test('Codex subscription login uses the managed device flow and returns only browser ceremony data', async () => {
  const calls: any[] = [];
  const t: CodexTransport = {
    requestOnce: async <T>(key: string, method: string, params: unknown) => {
      calls.push({ key, method, params });
      return {
        type: 'chatgptDeviceCode',
        loginId: 'login-1',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'ABCD-1234',
        accessToken: 'must-not-leave-adapter',
      } as T;
    },
    notify: async () => {},
    reply: async () => {},
    onMessage: () => () => {},
  };
  const harness = new CodexHarness(t);
  expect(await harness.subscriptionLogin('attempt-1')).toEqual({
    loginId: 'login-1',
    verificationUrl: 'https://auth.openai.com/codex/device',
    userCode: 'ABCD-1234',
  });
  expect(calls[0].params).toEqual({ type: 'chatgptDeviceCode' });
  await harness.cancelSubscriptionLogin('cancel-1', 'login-1');
  await harness.logout('logout-1');
  await harness.rateLimits('limits-1');
  expect(calls.map((c) => c.method)).toEqual([
    'account/login/start',
    'account/login/cancel',
    'account/logout',
    'account/rateLimits/read',
  ]);
});
test('Codex subscription login rejects an untrusted verification destination', async () => {
  const t: CodexTransport = {
    requestOnce: async <T>() =>
      ({
        type: 'chatgptDeviceCode',
        loginId: 'id',
        verificationUrl: 'https://example.com/phish',
        userCode: 'ABCD-1234',
      }) as T,
    notify: async () => {},
    reply: async () => {},
    onMessage: () => () => {},
  };
  await expect(new CodexHarness(t).subscriptionLogin('attempt')).rejects.toThrow(
    'supported device login',
  );
});
