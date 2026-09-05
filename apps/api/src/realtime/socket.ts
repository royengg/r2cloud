import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { pool } from '@r2cloud/database';
import { access } from '@r2cloud/core/service';
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
      await access(pool, actor, projectId);
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
        await access(pool, actor, projectId);
        const latest = (
          await pool.query(
            'SELECT COALESCE(max(id),0)::text cursor FROM events WHERE project_id=$1',
            [projectId],
          )
        ).rows[0].cursor;
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
