import { createServer, createConnection, type Socket } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, chmodSync, chownSync, rmSync } from 'node:fs';
import { once } from 'node:events';

const config = JSON.parse(process.argv.at(-1)!);
const sockets = new Set<Socket>();
const gid = Number(execFileSync('id', ['-g', 'r2-browser'], { encoding: 'utf8' }).trim());
const directory = mkdtempSync('/tmp/r2-browser-');
const socketPath = directory + '/preview.sock';
chownSync(directory, 0, gid);
chmodSync(directory, 0o750);
const relay = createServer((socket) => {
  if (sockets.size >= 128) {
    socket.destroy();
    return;
  }
  const upstream = createConnection({ host: '127.0.0.1', port: config.port });
  for (const stream of [socket, upstream]) {
    sockets.add(stream);
    stream.setTimeout(20000, () => stream.destroy());
    stream.on('error', () => {
      socket.destroy();
      upstream.destroy();
    });
    stream.on('close', () => {
      sockets.delete(stream);
      socket.destroy();
      upstream.destroy();
    });
  }
  socket.pipe(upstream).pipe(socket);
});
relay.listen(socketPath);
await once(relay, 'listening');
chownSync(socketPath, 0, gid);
chmodSync(socketPath, 0o660);
const inner = `
const {createServer,createConnection}=require('node:net');
const {spawn,execFileSync}=require('node:child_process');
const config=JSON.parse(process.argv.at(-1));
execFileSync('ip',['link','set','lo','up']);
const relay=createServer(socket=>{
 const upstream=createConnection(config.socketPath);
 socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
 socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
 socket.pipe(upstream).pipe(socket);
});
relay.listen(config.port,'127.0.0.1',()=>{
 const child=spawn('runuser',['-u','r2-browser','--','bun','-e',config.page,'--',JSON.stringify(config)],{stdio:['ignore','inherit','inherit']});
 child.on('error',()=>process.exit(1));child.on('exit',code=>process.exit(code??1));
});
`;
const child = spawn(
  'unshare',
  ['--net', 'bun', '-e', inner, '--', JSON.stringify({ ...config, socketPath })],
  {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
  },
);
const kill = () => {
  try {
    process.kill(-child.pid!, 'SIGKILL');
  } catch {}
};
const timer = setTimeout(kill, 35000);
process.once('SIGTERM', kill);
process.once('SIGINT', kill);
let bytes = 0;
child.stdout.on('data', (chunk) => {
  bytes += chunk.length;
  if (bytes > 3 * 1024 * 1024) {
    kill();
    return;
  }
  process.stdout.write(chunk);
});
child.stderr.resume();
try {
  const [code] = await once(child, 'exit');
  process.exitCode = code === 0 && bytes <= 3 * 1024 * 1024 ? 0 : 1;
} finally {
  clearTimeout(timer);
  kill();
  for (const socket of sockets) socket.destroy();
  relay.close();
  rmSync(directory, { recursive: true, force: true });
}
