import { io } from 'socket.io-client';
import { queryClient } from './queries';

const refreshing = new Map<string, { pending: boolean; promise: Promise<void> }>();
export function refreshRead(path: string): Promise<void> {
  const query = queryClient.getQueryCache().find({ queryKey: ['api', path], exact: true });
  if (!query?.isActive()) {
    return queryClient.cancelQueries({ queryKey: ['api', path], exact: true }).then(() =>
      queryClient.invalidateQueries({
        queryKey: ['api', path],
        exact: true,
        refetchType: 'none',
      }),
    );
  }
  const current = refreshing.get(path);
  if (current) {
    current.pending = true;
    return current.promise;
  }
  const entry = {
    pending: queryClient.getQueryState(['api', path])?.fetchStatus === 'fetching',
    promise: Promise.resolve(),
  };
  refreshing.set(path, entry);
  entry.promise = (async () => {
    do {
      const inFlight = queryClient.getQueryState(['api', path])?.fetchStatus === 'fetching';
      entry.pending = false;
      await queryClient.invalidateQueries(
        { queryKey: ['api', path], exact: true },
        { cancelRefetch: false },
      );
      if (inFlight) entry.pending = true;
    } while (entry.pending && queryClient.getQueryState(['api', path]));
  })().finally(() => refreshing.delete(path));
  return entry.promise;
}

export function projectRealtime(
  projectId: string,
  status: (value: string) => void,
  revoked: () => void,
) {
  const prefix = `/projects/${projectId}/`;
  const refresh = (
    event: { reset?: boolean; board?: boolean; threads?: string[] } = { reset: true },
  ) => {
    for (const query of queryClient.getQueryCache().findAll()) {
      const path = String(query.queryKey[1] ?? '');
      if (!path.startsWith(prefix)) continue;
      if (
        path.startsWith(`${prefix}review?`) &&
        new URLSearchParams(path.split('?')[1]).has('snapshot')
      )
        continue;
      const selectedThread = /^threads\/([^/]+)/.exec(path.slice(prefix.length))?.[1];
      if (
        event.reset ||
        (selectedThread
          ? (event.threads?.includes(selectedThread) &&
              (path.endsWith('/timeline') || path.endsWith('/preview'))) ||
            event.board
          : event.board)
      )
        void refreshRead(path);
    }
  };
  const socket = io({ auth: { projectId }, withCredentials: true, transports: ['websocket'] });
  socket.on('connect', () => status('Live'));
  socket.on('snapshot-required', refresh);
  socket.on('disconnect', () => status('Reconnecting'));
  socket.on('connect_error', () => status('Offline'));
  socket.on('access-ended', revoked);
  const timer = setInterval(() => {
    if (!socket.connected) {
      if (!socket.active) socket.connect();
      refresh();
    }
  }, 5000);
  return () => {
    clearInterval(timer);
    socket.disconnect();
  };
}
