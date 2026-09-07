import { chownSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import type { Readable } from 'node:stream';

type Message = { id?: string | number; method?: string; params?: Record<string, any> };
type Event = { seq: number; message: Message; providerElapsedMs: number | null };
const root = '/tmp/r2cloud-control';
mkdirSync(root, { mode: 0o700, recursive: true });
for (const directory of ['in', 'out', 'events'])
  mkdirSync(`${root}/${directory}`, { recursive: true });
const [, , uid, gid, , directory] = execFileSync('getent', ['passwd', 'r2-agent'], {
  encoding: 'utf8',
})
  .trim()
  .split(':');
if (!uid || !gid || !directory) throw new Error('Agent user is unavailable.');
const home = `${directory}/.codex`;
mkdirSync(home, { mode: 0o700, recursive: true });
chownSync(home, Number(uid), Number(gid));
const agent = spawn(
  'setpriv',
  [
    '--reuid',
    uid,
    '--regid',
    gid,
    '--clear-groups',
    'codex',
    'app-server',
    '--listen',
    'stdio://',
    '-c',
    'cli_auth_credentials_store="file"',
  ],
  {
    cwd: directory,
    env: {
      PATH: `/opt/r2cloud/bin:${process.env.PATH}`,
      HOME: home,
      CODEX_HOME: home,
      LANG: 'C.UTF-8',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  },
);
const clients = new Set<Socket>();
const seen = new Set<string>();
let sequence = 0;
let batch: Event[] = [];
let turnStarted: number | undefined;
function save(path: string, value: unknown) {
  writeFileSync(`${root}/${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${root}/${path}.tmp`, `${root}/${path}`);
}
function send(client: Socket, value: unknown) {
  if (client.destroyed) return;
  if (client.writableLength > 32 * 1024 * 1024) {
    client.destroy();
    return;
  }
  client.write(JSON.stringify(value) + '\n');
}
function emit(value: unknown) {
  for (const client of clients) send(client, value);
}
function lines(stream: Readable, accept: (value: any) => void, fail: () => void) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) {
      fail();
      return;
    }
    let end: number;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        if (Buffer.byteLength(line) > 1024 * 1024)
          throw new Error('Bridge message exceeds its limit.');
        accept(JSON.parse(line));
      } catch {
        fail();
        return;
      }
    }
  });
  stream.on('error', fail);
}
lines(
  agent.stdout,
  (message: Message) => {
    if (message.method) {
      if (++sequence > 20000) throw new Error('Provider event limit reached.');
      if ((sequence - 1) % 10 === 0) batch = [];
      const event = {
        seq: sequence,
        message,
        providerElapsedMs:
          turnStarted === undefined ? null : Math.round(performance.now() - turnStarted),
      };
      batch.push(event);
      save(`events/batch-${Math.floor((sequence - 1) / 10)}.json`, batch);
      save('events/head.json', { seq: sequence });
      emit({ event });
    }
    const params = message.params ?? {};
    if (typeof message.id === 'string' && /^[a-f0-9]{64}$/.test(message.id) && !message.method) {
      save(`out/${message.id}.json`, message);
      emit({ key: message.id, response: message });
    } else if (message.method === 'turn/completed') save('turn.json', params);
    else if (message.method === 'item/completed' && params.item?.type === 'agentMessage')
      save('message.json', { text: String(params.item.text ?? '').slice(-16000) });
    else if (message.method === 'item/agentMessage/delta')
      save('progress.json', { text: String(params.delta ?? '').slice(-16000) });
  },
  () => agent.kill('SIGKILL'),
);
const server = createServer((client) => {
  client.on('close', () => clients.delete(client));
  lines(
    client,
    (command) => {
      if ('cursor' in command) {
        const cursor = command.cursor;
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > sequence)
          throw new Error('Invalid replay cursor.');
        for (let index = Math.floor(cursor / 10); index < Math.ceil(sequence / 10); index++) {
          const events: Event[] = JSON.parse(
            readFileSync(`${root}/events/batch-${index}.json`, 'utf8'),
          );
          for (const event of events) if (event.seq > cursor) send(client, { event });
        }
        clients.add(client);
        send(client, { ready: true });
        return;
      }
      const { key, message } = command;
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))
        throw new Error('Invalid command key.');
      const path = `${root}/out/${key}.json`;
      if (existsSync(path)) {
        send(client, { key, response: JSON.parse(readFileSync(path, 'utf8')) });
        return;
      }
      if (seen.has(key)) return;
      if (command.lookup) {
        send(client, { key, unresolved: true });
        return;
      }
      if (!message || typeof message !== 'object') throw new Error('Invalid command.');
      seen.add(key);
      save(`in/${key}.json`, message);
      if (message.method === 'turn/start') turnStarted = performance.now();
      if (agent.stdin.writableLength > 1024 * 1024) throw new Error('Provider input is blocked.');
      agent.stdin.write(JSON.stringify(message) + '\n');
      if (message.id === undefined || !message.method) {
        const response = { notified: true };
        save(`out/${key}.json`, response);
        send(client, { key, response });
      }
    },
    () => client.destroy(),
  );
});
server.listen(`${root}/bridge.sock`);
function finish(code: number | null) {
  save('exit.json', { code });
  emit({ exit: code ?? 1 });
  for (const client of clients) client.end();
  server.close();
}
agent.on('error', () => agent.kill('SIGKILL'));
agent.stdin.on('error', () => agent.kill('SIGKILL'));
agent.on('close', finish);
server.on('error', () => agent.kill('SIGKILL'));
