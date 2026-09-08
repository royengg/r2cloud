import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
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
      const latest = await prisma.events.aggregate({
        where: { project_id: projectId },
        _max: { id: true },
      });
      socket.data = { projectId, actor, cursor: latest._max.id ?? 0n };
      next();
    } catch {
      next(new Error('Project access denied.'));
    }
  });
  const projects = new Map<
    string,
    {
      sockets: Set<Socket>;
      timer: ReturnType<typeof setInterval>;
      cursor: bigint;
      checking: boolean;
    }
  >();
  io.on('connection', (socket) => {
    const projectId = socket.data.projectId as string;
    let group = projects.get(projectId);
    if (!group) {
      group = {
        sockets: new Set(),
        timer: undefined!,
        cursor: socket.data.cursor,
        checking: false,
      };
      projects.set(projectId, group);
      const update = async () => {
        if (group!.checking) return;
        group!.checking = true;
        try {
          const checks = new Map<string, Promise<void>>();
          await Promise.all(
            [...group!.sockets].map(async (subscriber) => {
              const key = subscriber.request.headers.cookie ?? '';
              let check = checks.get(key);
              if (!check) {
                check = (async () => {
                  const actor = await requestActor(options, subscriber.request.headers);
                  await access(prisma, actor, projectId);
                })();
                checks.set(key, check);
              }
              try {
                await check;
              } catch {
                subscriber.emit('access-ended');
                subscriber.disconnect(true);
              }
            }),
          );
          if (!group!.sockets.size) return;
          const events = await prisma.events.findMany({
            where: { project_id: projectId, id: { gt: group!.cursor } },
            orderBy: { id: 'asc' },
            take: 201,
          });
          if (!events.length) return;
          group!.cursor = events.at(-1)!.id;
          const threads = [
            ...new Set(
              events.flatMap((event) => {
                const id = (event.detail as { threadId?: string }).threadId;
                return id ? [id] : [];
              }),
            ),
          ];
          const board = events.some(
            (event) => !['Agent timeline updated', 'Preview updated'].includes(event.kind),
          );
          for (const subscriber of group!.sockets)
            subscriber.emit('snapshot-required', {
              cursor: String(group!.cursor),
              threads,
              board,
              reset: events.length === 201,
            });
        } finally {
          group!.checking = false;
        }
      };
      group.timer = setInterval(() => void update().catch(() => {}), 750);
    }
    group.sockets.add(socket);
    socket.emit('snapshot-required', { reset: true, cursor: String(socket.data.cursor) });
    socket.on('disconnect', () => {
      group!.sockets.delete(socket);
      if (!group!.sockets.size) {
        clearInterval(group!.timer);
        projects.delete(projectId);
      }
    });
  });
  return io;
}
