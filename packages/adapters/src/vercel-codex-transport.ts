import { readFileSync } from 'node:fs';
import type { Session } from '@vercel/sandbox';
import { setTimeout as pause } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { Uncertain } from '@r2cloud/contracts/adapters';
import type { CodexTransport } from './codex';
import { sandboxDigest, type SandboxJournal, type VercelIdentity } from './vercel';

const root = '/tmp/r2cloud-control';
export const codexBridge = readFileSync(new URL('./codex-bridge.py', import.meta.url), 'utf8');

const bridgeClient = String.raw`
import os, socket, sys, threading, time, tty
tty.setraw(sys.stdin.fileno())
client = socket.socket(socket.AF_UNIX)
for attempt in range(100):
    try:
        client.connect('/tmp/r2cloud-control/bridge.sock')
        break
    except (FileNotFoundError, ConnectionRefusedError): time.sleep(0.05)
else: sys.exit(1)
os.write(sys.stdout.fileno(), b'{"connected":true}\n')
def incoming():
    while True:
        data = client.recv(65536)
        if not data: os._exit(0)
        os.write(sys.stdout.fileno(), data)
threading.Thread(target=incoming, daemon=True).start()
while True:
    data = os.read(sys.stdin.fileno(), 65536)
    if not data: break
    client.sendall(data)
`;
type BridgeEvent = { seq: number; message: Record<string, any>; providerElapsedMs?: number };

export class VercelCodexTransport implements CodexTransport {
  constructor(
    private session: Session,
    private journal: SandboxJournal,
    private identity: VercelIdentity,
    private deadline: number,
  ) {}
  private eventCursor = 0;
  get cursor() {
    return this.eventCursor;
  }
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
  private buffered: (BridgeEvent & { bytes: number })[] = [];
  private bufferedBytes = 0;
  private failure?: Error;
  private ended?: number;
  private async connect() {
    if (this.connecting) return this.connecting;
    if (this.socket?.readyState === WebSocket.OPEN && !this.failure) return;
    this.connecting = this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }
  private async open() {
    const { url, token } = await this.session.openInteractive({
      signal: AbortSignal.timeout(15000),
    });
    const address = new URL(url);
    address.searchParams.set('token', token);
    const socket = new WebSocket(address);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.failure = undefined;
    this.buffered = [];
    this.bufferedBytes = 0;
    let buffer = '';
    const decoder = new TextDecoder();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => fail(new Uncertain('Codex bridge connection timed out.')),
        15000,
      );
      const fail = (error: Error) => {
        clearTimeout(timeout);
        if (this.socket !== socket) return;
        this.failure = error;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        reject(error);
        socket.close();
      };
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: 'start',
            command: 'sudo',
            args: ['python3', '-u', '-c', bridgeClient],
            env: [],
            cwd: '/tmp',
            cols: 80,
            rows: 24,
          }),
        );
      };
      socket.onmessage = ({ data }) => {
        if (typeof data === 'string') {
          if (data.includes('"exit"')) fail(new Uncertain('Codex bridge stopped.'));
          return;
        }
        buffer += decoder.decode(data, { stream: true });
        if (buffer.length > 2 * 1024 * 1024)
          return fail(new Uncertain('Codex bridge output exceeds its limit.'));
        let end: number;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const value = JSON.parse(line);
            if (value.connected)
              socket.send(
                new TextEncoder().encode(JSON.stringify({ cursor: this.eventCursor }) + '\n'),
              );
            else if (value.ready) {
              clearTimeout(timeout);
              resolve();
            } else if (value.event) {
              const bytes = Buffer.byteLength(line);
              this.bufferedBytes += bytes;
              if (this.buffered.length >= 20000 || this.bufferedBytes > 32 * 1024 * 1024)
                throw new Error('Codex event buffer exceeds its limit.');
              this.buffered.push({ ...value.event, bytes });
            } else if (value.key) {
              const request = this.pending.get(value.key);
              if (value.unresolved)
                request?.reject(new Uncertain('Codex request outcome is unresolved.'));
              else request?.resolve(value.response);
              this.pending.delete(value.key);
            } else if (value.exit !== undefined) this.ended = value.exit;
          } catch {
            fail(new Uncertain('Codex bridge returned invalid output.'));
            return;
          }
        }
      };
      socket.onerror = () => fail(new Uncertain('Codex bridge connection failed.'));
      socket.onclose = () => fail(new Uncertain('Codex bridge disconnected.'));
    });
  }
  async events() {
    await this.connect();
    if (this.failure) throw this.failure;
    return this.buffered.filter((entry) => entry.seq > this.eventCursor).slice(0, 100);
  }
  acknowledge(seq: number) {
    this.eventCursor = seq;
    this.buffered = this.buffered.filter((entry) => {
      if (entry.seq > seq) return true;
      this.bufferedBytes -= entry.bytes;
      return false;
    });
  }
  private listeners = new Set<(message: unknown) => void>();
  private key(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
  async requestOnce<T>(operationKey: string, method: string, params: unknown): Promise<T> {
    const requestId = this.key(operationKey);
    const receipt = await this.journal.beginStep(
      this.identity,
      `rpc:${requestId}`,
      sandboxDigest({ method, params }),
    );
    if (receipt.result !== undefined) return receipt.result as T;
    const response = await this.send(requestId, { id: requestId, method, params }, !receipt.fresh);
    for (const listener of this.listeners) listener(response);
    if (response.error) throw new Error(`Codex ${method} failed.`);
    if (response.result === undefined) throw new Error('Codex returned no result.');
    await this.journal.finishStep(this.identity, `rpc:${requestId}`, response.result);
    return response.result as T;
  }
  async notify(method: string, params?: unknown) {
    await this.send(this.key(`notify:${method}`), { method, params });
  }
  async reply(id: string | number, result: unknown) {
    await this.send(this.key(`reply:${id}`), { id, result });
  }
  onMessage(_listener: (message: unknown) => void) {
    this.listeners.add(_listener);
    return () => {
      this.listeners.delete(_listener);
    };
  }
  private async send(key: string, message: unknown, lookup = false): Promise<any> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(key);
          reject(new Uncertain('Codex request timed out; it will not be replayed.'));
        },
        Math.max(1, Math.min(30000, this.deadline - Date.now())),
      );
      this.pending.set(key, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.socket!.send(new TextEncoder().encode(JSON.stringify({ key, message, lookup }) + '\n'));
    });
  }
  close() {
    this.socket?.close();
  }
  async read<T = unknown>(path: string, limit = 1024 * 1024): Promise<T | null> {
    if (path === 'exit.json')
      return (this.ended === undefined ? null : { code: this.ended }) as T | null;
    const stream = await this.session.readFile(
      { path: `${root}/${path}` },
      { signal: AbortSignal.timeout(15000) },
    );
    if (!stream) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const data = Buffer.from(chunk);
      size += data.length;
      if (size > limit) throw new Error('Codex response exceeds the transport limit.');
      chunks.push(data);
    }
    return JSON.parse(Buffer.concat(chunks).toString()) as T;
  }
  async waitForTurn(threadId: string, turnId: string) {
    while (Date.now() < this.deadline) {
      for (const { seq, message } of await this.events()) {
        if (message.id !== undefined && message.method)
          await this.reply(
            message.id,
            message.method === 'item/tool/requestUserInput'
              ? { answers: {} }
              : { decision: 'decline' },
          );
        this.acknowledge(seq);
        const ended = message.params;
        if (
          message.method === 'turn/completed' &&
          ended?.threadId === threadId &&
          ended.turn?.id === turnId
        ) {
          for (const listener of this.listeners) listener(message);
          if (!['completed', 'failed', 'interrupted'].includes(ended.turn.status))
            throw new Error('Invalid Codex turn status.');
          return { status: ended.turn.status as 'completed' | 'failed' | 'interrupted' };
        }
      }
      if (await this.read('exit.json'))
        throw new Uncertain('Codex process stopped before its turn completed.');
      await pause(1000);
    }
    throw new Uncertain('Execution reached its deadline.');
  }
}
