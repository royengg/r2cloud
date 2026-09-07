import { QueryCache, QueryClient, queryOptions } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error, query) {
      if (!(error instanceof ApiError)) return;
      if (error.status === 401) window.dispatchEvent(new Event('session-ended'));
      if (error.status === 403) {
        const path = String(query.queryKey[1] ?? '');
        const projectId = /^\/projects\/([^/]+)\//.exec(path)?.[1];
        if (projectId)
          window.dispatchEvent(new CustomEvent('project-access-ended', { detail: projectId }));
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 120_000,
      retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status >= 500),
    },
    mutations: { retry: false },
  },
});

export function readQuery<T>(path: string) {
  return queryOptions({
    queryKey: ['api', path],
    queryFn: ({ signal }) => api<T>(path, undefined, signal),
  });
}

export function clearProjectQueries(projectId: string) {
  queryClient.removeQueries({
    predicate: (query) => String(query.queryKey[1] ?? '').startsWith(`/projects/${projectId}/`),
  });
}
