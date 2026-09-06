import type { Session } from '@vercel/sandbox';
import { setTimeout as pause } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { Uncertain } from '@r2cloud/contracts/adapters';
import type { CodexTransport } from './codex';
import { sandboxDigest, type SandboxJournal, type VercelIdentity } from './vercel';

const root = '/tmp/r2cloud-control';
export const codexBridge = String.raw`
import json, os, pathlib, pwd, subprocess, threading, time
root = pathlib.Path('/tmp/r2cloud-control')
root.mkdir(mode=0o700, exist_ok=True)
(root / 'in').mkdir(exist_ok=True)
(root / 'out').mkdir(exist_ok=True)
(root / 'events').mkdir(exist_ok=True)
event_seq = 0
event_batch = []
agent = pwd.getpwnam('r2-agent')
home = pathlib.Path(agent.pw_dir) / '.codex'
home.mkdir(mode=0o700, exist_ok=True)
os.chown(home, agent.pw_uid, agent.pw_gid)
def unprivileged():
    os.setgroups([])
    os.setgid(agent.pw_gid)
    os.setuid(agent.pw_uid)
proc = subprocess.Popen(['codex', 'app-server', '--listen', 'stdio://', '-c', 'cli_auth_credentials_store="file"'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    cwd=agent.pw_dir, preexec_fn=unprivileged, env={'PATH':'/opt/r2cloud/bin:' + os.environ['PATH'], 'HOME':str(home), 'CODEX_HOME':str(home), 'LANG':'C.UTF-8'}, text=True)
def save(name, value):
    temp = root / (name + '.tmp')
    temp.write_text(json.dumps(value))
    temp.replace(root / name)
def listen():
    global event_seq, event_batch
    for line in proc.stdout:
        if len(line) > 1048576:
            proc.kill()
            return
        try:
            message = json.loads(line)
            ident = message.get('id')
            if message.get('method'):
                event_seq += 1
                if event_seq > 20000:
                    proc.kill()
                    return
                if (event_seq - 1) % 10 == 0: event_batch = []
                event_batch.append({'seq':event_seq,'message':message})
                save('events/batch-' + str((event_seq - 1) // 10) + '.json', event_batch)
                save('events/head.json', {'seq':event_seq})
            if isinstance(ident, str) and len(ident) == 64 and not message.get('method'):
                save('out/' + ident + '.json', message)
            elif message.get('method') == 'turn/completed':
                save('turn.json', message.get('params', {}))
            elif message.get('method') == 'item/completed' and message.get('params', {}).get('item', {}).get('type') == 'agentMessage':
                save('message.json', {'text':str(message['params']['item'].get('text',''))[-16000:]})
            elif message.get('method') == 'item/agentMessage/delta':
                save('progress.json', {'text':str(message.get('params', {}).get('delta',''))[-16000:]})
        except (ValueError, OSError):
            proc.kill()
            return
threading.Thread(target=listen, daemon=True).start()
seen = set()
while proc.poll() is None:
    for path in sorted((root / 'in').glob('*.json')):
        if path.name in seen: continue
        try:
            message = json.loads(path.read_text())
        except (ValueError, OSError): continue
        seen.add(path.name)
        proc.stdin.write(json.dumps(message)+'\n')
        proc.stdin.flush()
        if 'id' not in message: save('out/' + path.name, {'notified':True})
    time.sleep(0.1)
save('exit.json', {'code':proc.returncode})
`;

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
  async events() {
    const head = await this.read<{ seq: number }>('events/head.json');
    const messages: { seq: number; message: Record<string, any> }[] = [];
    const end = Math.min(head?.seq ?? 0, this.eventCursor + 100);
    for (
      let batch = Math.floor(this.eventCursor / 10);
      batch <= Math.floor((end - 1) / 10) && this.eventCursor < end;
      batch++
    ) {
      const entries = await this.read<typeof messages>(
        `events/batch-${batch}.json`,
        11 * 1024 * 1024,
      );
      if (!entries) throw new Uncertain('Provider event sequence has a gap.');
      messages.push(...entries.filter((entry) => entry.seq > this.eventCursor && entry.seq <= end));
    }
    if (messages.length !== end - this.eventCursor)
      throw new Uncertain('Provider event sequence has a gap.');
    return messages;
  }
  acknowledge(seq: number) {
    this.eventCursor = seq;
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
    if (receipt.fresh) await this.send(requestId, { id: requestId, method, params });
    const until = Math.min(this.deadline, Date.now() + 30_000);
    do {
      const response = await this.read<{ result?: T; error?: unknown }>(`out/${requestId}.json`);
      if (response) {
        for (const listener of this.listeners) listener(response);
        if (response.error) throw new Error(`Codex ${method} failed.`);
        if (response.result === undefined) throw new Error('Codex returned no result.');
        await this.journal.finishStep(this.identity, `rpc:${requestId}`, response.result);
        return response.result;
      }
      if (!receipt.fresh) throw new Uncertain('Codex request outcome is unresolved.');
      if (await this.read('exit.json')) throw new Uncertain('Codex process stopped.');
      await pause(500);
    } while (Date.now() < until);
    throw new Uncertain('Codex request timed out; it will not be replayed.');
  }
  async notify(method: string, params?: unknown) {
    const key = this.key(`notify:${method}`);
    await this.send(key, { method, params });
    const until = Math.min(this.deadline, Date.now() + 10000);
    while (Date.now() < until) {
      if (await this.read(`out/${key}.json`)) return;
      await pause(100);
    }
    throw new Uncertain('Codex notification was not acknowledged.');
  }
  reply(id: string | number, result: unknown) {
    return this.send(this.key(`reply:${id}`), { id, result });
  }
  onMessage(_listener: (message: unknown) => void) {
    this.listeners.add(_listener);
    return () => {
      this.listeners.delete(_listener);
    };
  }
  private send(key: string, message: unknown) {
    return this.session.writeFiles(
      [{ path: `${root}/in/${key}.json`, content: JSON.stringify(message), mode: 0o600 }],
      { signal: AbortSignal.timeout(15000) },
    );
  }
  async read<T = unknown>(path: string, limit = 1024 * 1024): Promise<T | null> {
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
      }
      const ended = await this.read<{ threadId: string; turn: { id: string; status: string } }>(
        'turn.json',
      );
      if (ended?.threadId === threadId && ended.turn.id === turnId) {
        for (const listener of this.listeners)
          listener({ method: 'turn/completed', params: ended });
        if (!['completed', 'failed', 'interrupted'].includes(ended.turn.status))
          throw new Error('Invalid Codex turn status.');
        return { status: ended.turn.status as 'completed' | 'failed' | 'interrupted' };
      }
      if (await this.read('exit.json'))
        throw new Uncertain('Codex process stopped before its turn completed.');
      await pause(1000);
    }
    throw new Uncertain('Execution reached its deadline.');
  }
}
