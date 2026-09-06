import { codexModels, type CodexModel } from '@r2cloud/contracts/threads';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, mkdir, mkdtemp, writeFile, readdir, readlink, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Uncertain } from '@r2cloud/contracts/adapters';
export interface CodexLoginSession {
  start(): Promise<{ loginId: string; userCode: string }>;
  completed(loginId: string): boolean;
  credentials(): Promise<{ auth: Buffer; plan: string }>;
  close(): Promise<void>;
}
export class CodexLoginProcess implements CodexLoginSession {
  private process: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sequence = 0;
  private buffer = '';
  private completion: { loginId: string; success: boolean } | null = null;
  private stopped = false;
  private exited: Promise<void>;
  private constructor(
    binary: string,
    private home: string,
  ) {
    if (!isAbsolute(binary) || !isAbsolute(home)) throw new Error('Codex paths must be absolute.');
    this.process = spawn(
      binary,
      [
        'app-server',
        '--listen',
        'stdio://',
        '-c',
        'cli_auth_credentials_store="file"',
        '-c',
        'forced_login_method="chatgpt"',
      ],
      {
        cwd: home,
        env: {
          HOME: home,
          CODEX_HOME: home,
          LANG: 'C.UTF-8',
          TOKIO_WORKER_THREADS: '2',
          RAYON_NUM_THREADS: '2',
        },
        stdio: 'pipe',
      },
    );
    this.exited = new Promise((resolve) =>
      this.process.once('close', () => {
        this.fail();
        resolve();
      }),
    );
    this.process.on('error', () => this.fail());
    this.process.stdin.on('error', () => this.fail());
    this.process.stderr.resume();
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 1024 * 1024) {
        this.fail();
        this.process.kill('SIGTERM');
        return;
      }
      let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          this.message(JSON.parse(line));
        } catch {
          this.fail();
          this.process.kill('SIGTERM');
        }
      }
    });
  }
  static async create(binary: string, root: string) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const home = await mkdtemp(join(root, 'login-'));
    const session = new CodexLoginProcess(binary, home);
    try {
      await writeFile(join(home, 'process-id'), String(session.process.pid ?? ''), {
        mode: 0o600,
        flag: 'wx',
      });
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
  static async catalogue(binary: string, root: string, auth: Buffer) {
    const session = await CodexLoginProcess.create(binary, root);
    try {
      await writeFile(join(session.home, 'auth.json'), auth, { mode: 0o600, flag: 'wx' });
      await session.request('initialize', {
        clientInfo: { name: 'r2cloud-models', version: '0.1.0' },
      });
      session.process.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
      const models: CodexModel[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page++) {
        const result: { data: (CodexModel & { hidden?: boolean })[]; nextCursor: string | null } =
          await session.request('model/list', { limit: 20, includeHidden: false, cursor });
        models.push(...codexModels.parse(result.data.filter((m) => !m.hidden)));
        if (!result.nextCursor) return codexModels.parse(models);
        cursor = result.nextCursor;
      }
      throw new Error('Model catalog exceeded its limit.');
    } finally {
      await session.close();
    }
  }
  private fail() {
    this.stopped = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Uncertain('Codex sign-in was interrupted.'));
    }
    this.pending.clear();
  }
  private message(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid Codex message.');
    const message = value as {
      id?: string | number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: unknown;
    };
    if (message.method && message.id !== undefined) {
      this.process.stdin.write(
        JSON.stringify({
          id: message.id,
          error: { code: -32601, message: 'Authentication only' },
        }) + '\n',
      );
    } else if (message.method === 'account/login/completed') {
      const params = message.params as { loginId?: unknown; success?: unknown } | null;
      if (!params || typeof params.loginId !== 'string' || typeof params.success !== 'boolean')
        throw new Error('Invalid Codex login completion.');
      this.completion = { loginId: params.loginId, success: params.success };
    } else if (typeof message.id === 'number') {
      const p = this.pending.get(message.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(message.id);
      if (message.error) p.reject(new Error('Codex could not complete the sign-in request.'));
      else p.resolve(message.result);
    }
  }
  private request<T>(
    method: 'initialize' | 'account/login/start' | 'account/read' | 'model/list',
    params: unknown,
  ): Promise<T> {
    if (this.stopped) return Promise.reject(new Uncertain('Codex sign-in was interrupted.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Uncertain('Codex sign-in timed out.'));
      }, 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async start() {
    await this.request('initialize', { clientInfo: { name: 'r2cloud-login', version: '0.1.0' } });
    this.process.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const result = await this.request<{
      type: string;
      verificationUrl: string;
      loginId: string;
      userCode: string;
    }>('account/login/start', { type: 'chatgptDeviceCode' });
    if (
      result?.type !== 'chatgptDeviceCode' ||
      result.verificationUrl !== 'https://auth.openai.com/codex/device' ||
      typeof result.loginId !== 'string' ||
      !result.loginId ||
      typeof result.userCode !== 'string' ||
      !/^[A-Z0-9-]{4,32}$/.test(result.userCode)
    )
      throw new Error('Unsupported Codex sign-in response.');
    return { loginId: result.loginId, userCode: result.userCode };
  }
  completed(loginId: string) {
    if (this.stopped) throw new Uncertain('Codex sign-in was interrupted.');
    if (this.completion?.loginId !== loginId) return false;
    if (this.completion.success !== true) throw new Error('Codex sign-in was not completed.');
    return true;
  }
  async credentials() {
    const result = await this.request<{ account: { type: string; planType: string } }>(
      'account/read',
      { refreshToken: false },
    );
    if (result?.account?.type !== 'chatgpt' || typeof result.account.planType !== 'string')
      throw new Error('Connect a ChatGPT account. API keys are not enabled.');
    const auth = await readFile(join(this.home, 'auth.json'));
    if (auth.length > 128_000) throw new Error('Invalid Codex credential file.');
    const parsed = JSON.parse(auth.toString()) as {
      OPENAI_API_KEY?: unknown;
      tokens?: { access_token?: unknown; refresh_token?: unknown };
    };
    if (
      parsed.OPENAI_API_KEY ||
      typeof parsed.tokens?.access_token !== 'string' ||
      typeof parsed.tokens?.refresh_token !== 'string'
    )
      throw new Error('A managed ChatGPT login is required.');
    return { auth, plan: result.account.planType.slice(0, 40) };
  }
  async close() {
    this.process.kill('SIGTERM');
    const timer = setTimeout(() => this.process.kill('SIGKILL'), 3000);
    try {
      await this.exited;
    } finally {
      clearTimeout(timer);
    }
    await rm(this.home, { recursive: true, force: true });
  }
}

export async function cleanStoppedLoginHomes(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^login-[a-zA-Z0-9]+$/.test(entry.name)) continue;
    const home = join(root, entry.name);
    try {
      const pid = (await readFile(join(home, 'process-id'), 'utf8')).trim();
      if (/^[1-9][0-9]*$/.test(pid)) {
        try {
          if ((await readlink(`/proc/${pid}/cwd`)) === home) continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
        }
      }
      await rm(home, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
