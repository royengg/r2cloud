import { EventEmitter } from 'node:events';
/** Transport is supplied by a trusted managed supervisor, never a shell on the API host.
 * requestOnce persists request intent/result by operation key. An ambiguous turn/start
 * must be reconciled; it cannot be blindly replayed on a fresh connection. */
export interface CodexTransport {
  requestOnce<T>(operationKey: string, method: string, params: unknown): Promise<T>;
  notify(method: string, params?: unknown): Promise<void>;
  reply(id: string | number, result: unknown): Promise<void>;
  onMessage(listener: (message: any) => void): () => void;
}
export class CodexHarness extends EventEmitter {
  readonly capabilities = {
    authenticationHealth: true,
    start: true,
    resume: true,
    input: true,
    streaming: true,
    permissionRequests: true,
    cancel: true,
    stopAcknowledgement: 'turn-only' as const,
    usage: 'when-reported' as const,
  };
  constructor(private transport: CodexTransport) {
    super();
    transport.onMessage((m) => {
      if (m.id !== undefined && m.method) {
        this.emit('permission', { id: m.id, method: m.method, params: m.params });
        return;
      }
      if (m.method === 'item/agentMessage/delta') this.emit('progress', m.params);
      if (m.method === 'thread/tokenUsage/updated') this.emit('usage', m.params);
      if (m.method === 'turn/completed') this.emit('turnEnded', m.params);
      this.emit('event', m);
    });
  }
  async initialize(connectionId: string) {
    await this.transport.requestOnce(`${connectionId}:init`, 'initialize', {
      clientInfo: { name: 'r2cloud', title: 'R2Cloud', version: '0.1.0' },
    });
    await this.transport.notify('initialized');
  }
  health(key: string) {
    return this.transport.requestOnce<{ account: unknown; requiresOpenaiAuth: boolean }>(
      key,
      'account/read',
      { refreshToken: false },
    );
  }
  /** The owning credential broker calls this in a fresh, isolated Codex home.
   * No OAuth token is returned to the product API or browser. */
  async subscriptionLogin(key: string) {
    const result = await this.transport.requestOnce<{
      type: string;
      loginId: string;
      verificationUrl: string;
      userCode: string;
    }>(key, 'account/login/start', { type: 'chatgptDeviceCode' });
    if (
      result.type !== 'chatgptDeviceCode' ||
      typeof result.loginId !== 'string' ||
      !result.loginId ||
      result.verificationUrl !== 'https://auth.openai.com/codex/device' ||
      typeof result.userCode !== 'string' ||
      !/^[A-Z0-9-]{4,32}$/.test(result.userCode)
    )
      throw new Error('Codex did not return a supported device login.');
    return {
      loginId: result.loginId,
      verificationUrl: result.verificationUrl,
      userCode: result.userCode,
    };
  }
  cancelSubscriptionLogin(key: string, loginId: string) {
    return this.transport.requestOnce(key, 'account/login/cancel', { loginId });
  }
  logout(key: string) {
    return this.transport.requestOnce(key, 'account/logout', {});
  }
  rateLimits(key: string) {
    return this.transport.requestOnce(key, 'account/rateLimits/read', {});
  }
  async start(key: string, cwd: string) {
    return this.transport.requestOnce<{ thread: { id: string } }>(key, 'thread/start', {
      cwd,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    });
  }
  resume(key: string, threadId: string) {
    return this.transport.requestOnce(key, 'thread/resume', { threadId });
  }
  input(key: string, threadId: string, text: string) {
    return this.transport.requestOnce<{ turn: { id: string; status: string } }>(key, 'turn/start', {
      threadId,
      input: [{ type: 'text', text }],
    });
  }
  interrupt(key: string, threadId: string, turnId: string) {
    return this.transport.requestOnce(key, 'turn/interrupt', { threadId, turnId });
  }
  // Product approval is never routed to a model's permission request. Default deny.
  denyPermission(id: string | number) {
    return this.transport.reply(id, { decision: 'decline' });
  }
}
