import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { prisma } from '@r2cloud/database';
import { access } from '@r2cloud/core/project-context';
import { requestActor } from '../auth/session';
import { allowedOrigins, type AppOptions } from '../config/options';
export function attachRealtime(server: HttpServer, options: AppOptions) {
  const io = new SocketServer(server, {
    maxHttpBufferSize: 1024,
    cors: { origin: [...allowedOrigins(options)], credentials: true },
    allowRequest: (req, callback) =>
      callback(null, allowedOrigins(options).has(req.headers.origin ?? '')),
  });
  io.use(async (socket, next) => {
    try {
      const projectId = String(socket.handshake.auth.projectId ?? '');
      const actor = await requestActor(options, socket.request.headers);
      await access(prisma, actor, projectId);
      socket.data = { projectId, actor };
      next();
    } catch {
      next(new Error('Project access denied.'));
    }
  });
  io.on('connection', (socket) => {
    const { projectId, actor } = socket.data;
    let cursor = '-1',
      checking = false;
    const update = async () => {
      if (checking || !socket.connected) return;
      checking = true;
      try {
        await requestActor(options, socket.request.headers);
        await access(prisma, actor, projectId);
        const aggregate = await prisma.events.aggregate({
          where: { project_id: projectId },
          _max: { id: true },
        });
        const latest = String(aggregate._max.id ?? 0);
        if (latest !== cursor) {
          cursor = latest;
          socket.emit('snapshot-required', { cursor });
        }
      } catch {
        socket.emit('access-ended');
        socket.disconnect(true);
      } finally {
        checking = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 750);
    socket.on('disconnect', () => clearInterval(timer));
  });
  return io;
}
