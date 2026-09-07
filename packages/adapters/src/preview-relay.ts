import { createConnection, type Socket } from 'node:net';

const port = Number(process.argv.at(-1));
if (!Number.isInteger(port) || port < 1024 || port > 65535) process.exit(1);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const streams = new Map<number, { socket: Socket; paused: boolean }>();
let buffered = '';
let blocked = false;
function send(frame: object) {
  if (process.stdout.writableLength > 8 * 1024 * 1024) process.exit(1);
  if (!process.stdout.write(JSON.stringify(frame) + '\n')) {
    blocked = true;
    for (const { socket } of streams.values()) socket.pause();
  }
}
process.stdout.on('drain', () => {
  blocked = false;
  for (const entry of streams.values()) if (!entry.paused) entry.socket.resume();
});
process.stdin.on('data', (chunk: Buffer) => {
  buffered += chunk.toString();
  if (buffered.length > 1024 * 1024) process.exit(1);
  let end: number;
  while ((end = buffered.indexOf('\n')) !== -1) {
    const line = buffered.slice(0, end);
    buffered = buffered.slice(end + 1);
    try {
      const frame = JSON.parse(line);
      if (!Number.isSafeInteger(frame.id) || frame.id < 1) throw new Error();
      if (frame.type === 'open') {
        if (streams.has(frame.id) || streams.size >= 64) throw new Error();
        const socket = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
        const entry = { socket, paused: false };
        streams.set(frame.id, entry);
        socket.setTimeout(120000, () => socket.destroy());
        socket.on('data', (data) => {
          for (let offset = 0; offset < data.length; offset += 32768)
            send({
              id: frame.id,
              type: 'data',
              data: data.subarray(offset, offset + 32768).toString('base64'),
            });
        });
        socket.on('end', () => send({ id: frame.id, type: 'end' }));
        socket.on('error', () => socket.destroy());
        socket.on('close', () => {
          streams.delete(frame.id);
          send({ id: frame.id, type: 'close' });
        });
        if (blocked) socket.pause();
        continue;
      }
      const entry = streams.get(frame.id);
      if (!entry) continue;
      if (frame.type === 'data') {
        if (typeof frame.data !== 'string' || frame.data.length > 43692) throw new Error();
        const bytes = Buffer.from(frame.data, 'base64');
        if (bytes.toString('base64') !== frame.data) throw new Error();
        if (entry.socket.writableLength + bytes.length > 1024 * 1024) {
          entry.socket.destroy();
        } else entry.socket.write(bytes, () => send({ id: frame.id, type: 'drain' }));
      } else if (frame.type === 'end') entry.socket.end();
      else if (frame.type === 'close') entry.socket.destroy();
      else if (frame.type === 'pause') {
        entry.paused = true;
        entry.socket.pause();
      } else if (frame.type === 'resume') {
        entry.paused = false;
        if (!blocked) entry.socket.resume();
      } else throw new Error();
    } catch {
      process.exit(1);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
send({ ready: true });
