import { createServer } from 'node:http';
import { createApp } from './app';
import { attachRealtime } from './realtime/socket';
import type { AppOptions } from './config/options';
export function createHttpServer(options: AppOptions) {
  const server = createServer(createApp(options));
  const io = attachRealtime(server, options);
  return { server, io };
}
