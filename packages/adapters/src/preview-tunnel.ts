import { readFileSync } from 'node:fs';
import { Duplex } from 'node:stream';
import type { Session } from '@vercel/sandbox';

const relay = readFileSync(new URL('./preview-relay.ts', import.meta.url), 'utf8');
type Frame = { id: number; type: string; data?: string };
type Channel = { stream: Duplex; written?: (error?: Error | null) => void };

export class PreviewTunnel {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private channels = new Map<number, Channel>();
  private sequence = 0;
  private closed = false;
  constructor(
    private session: Pick<Session, 'openInteractive'>,
    private port: number,
  ) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Invalid preview port.');
  }
  private send(frame: Frame) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 8 * 1024 * 1024)
      throw new Error('Preview connection is unavailable.');
    socket.send(new TextEncoder().encode(JSON.stringify(frame) + '\n'));
  }
  private receive(frame: Frame) {
    const channel = this.channels.get(frame.id);
    if (!channel) return;
    if (frame.type === 'data') {
      if (typeof frame.data !== 'string' || frame.data.length > 43692)
        throw new Error('Invalid preview frame.');
      const bytes = Buffer.from(frame.data, 'base64');
      if (bytes.toString('base64') !== frame.data) throw new Error('Invalid preview data.');
      if (channel.stream.readableLength + bytes.length > 1024 * 1024) {
        channel.stream.destroy(new Error('Preview response exceeded its buffer limit.'));
      } else if (!channel.stream.push(bytes)) this.send({ id: frame.id, type: 'pause' });
    } else if (frame.type === 'drain') {
      const callback = channel.written;
      channel.written = undefined;
      callback?.();
    } else if (frame.type === 'end') channel.stream.push(null);
    else if (frame.type === 'close') channel.stream.destroy();
    else throw new Error('Invalid preview frame.');
  }
  private async connect() {
    if (this.closed) throw new Error('Preview tunnel is closed.');
    if (this.connecting) return this.connecting;
    this.connecting = this.start();
    return this.connecting;
  }
  private async start() {
    try {
      const { url, token } = await this.session.openInteractive({
        signal: AbortSignal.timeout(15000),
      });
      if (this.closed) throw new Error('Preview tunnel is closed.');
      const address = new URL(url);
      address.searchParams.set('token', token);
      const socket = new WebSocket(address);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => fail(), 15000);
        const fail = () => {
          clearTimeout(timeout);
          const error = new Error('Preview tunnel disconnected.');
          reject(error);
          this.close(error);
        };
        const decoder = new TextDecoder();
        let buffered = '';
        socket.onopen = () =>
          socket.send(
            JSON.stringify({
              type: 'start',
              command: 'sudo',
              args: ['bun', '-e', relay, '--', String(this.port)],
              env: [],
              cwd: '/tmp',
              cols: 80,
              rows: 24,
            }),
          );
        socket.onmessage = ({ data }) => {
          if (typeof data === 'string') {
            if (data.includes('"exit"')) fail();
            return;
          }
          buffered += decoder.decode(data, { stream: true });
          if (buffered.length > 1024 * 1024) return fail();
          let end: number;
          while ((end = buffered.indexOf('\n')) !== -1) {
            const line = buffered.slice(0, end);
            buffered = buffered.slice(end + 1);
            try {
              const frame = JSON.parse(line);
              if (frame.ready === true) {
                clearTimeout(timeout);
                resolve();
              } else this.receive(frame);
            } catch {
              fail();
              return;
            }
          }
        };
        socket.onerror = fail;
        socket.onclose = fail;
      });
    } catch {
      this.close();
      throw new Error('Preview connection could not be established.');
    }
  }
  async open(): Promise<Duplex> {
    await this.connect();
    if (this.closed || this.channels.size >= 64)
      throw new Error('Preview connection limit reached.');
    const id = ++this.sequence;
    const tunnel = this;
    const channel: Channel = { stream: undefined! };
    const stream = new Duplex({
      allowHalfOpen: true,
      read() {
        try {
          tunnel.send({ id, type: 'resume' });
        } catch (error) {
          this.destroy(error as Error);
        }
      },
      write(chunk: Buffer, _encoding, callback) {
        let offset = 0;
        const next = (error?: Error | null) => {
          if (error || offset >= chunk.length) return callback(error);
          channel.written = next;
          const bytes = chunk.subarray(offset, offset + 32768);
          offset += bytes.length;
          try {
            tunnel.send({ id, type: 'data', data: bytes.toString('base64') });
          } catch (error) {
            channel.written = undefined;
            callback(error as Error);
          }
        };
        next();
      },
      final(callback) {
        try {
          tunnel.send({ id, type: 'end' });
          callback();
        } catch (error) {
          callback(error as Error);
        }
      },
      destroy(error, callback) {
        tunnel.channels.delete(id);
        try {
          tunnel.send({ id, type: 'close' });
        } catch {}
        channel.written?.(error ?? new Error('Preview stream closed.'));
        channel.written = undefined;
        callback(error);
      },
    });
    channel.stream = stream;
    this.channels.set(id, channel);
    try {
      this.send({ id, type: 'open' });
    } catch (error) {
      this.channels.delete(id);
      throw error;
    }
    return stream;
  }
  close(error = new Error('Preview tunnel closed.')) {
    if (this.closed) return;
    this.closed = true;
    this.socket?.close();
    for (const { stream } of this.channels.values()) stream.destroy(error);
    this.channels.clear();
  }
}
