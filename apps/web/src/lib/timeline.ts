import type { AgentTimeline } from '@r2cloud/contracts/agent';
import { api } from './api';
import { queryClient, readQuery } from './queries';

export function mergeTimeline(
  previous: AgentTimeline | undefined,
  next: AgentTimeline,
): AgentTimeline {
  if (!previous || next.reset) return next;
  const items = new Map(previous.items.map((item) => [item.id, item]));
  for (const item of next.items) items.set(item.id, item);
  return {
    ...next,
    nextBefore: previous.nextBefore,
    items: [...items.values()].sort((a, b) => {
      const left = BigInt(a.revision ?? 0),
        right = BigInt(b.revision ?? 0);
      return left < right ? -1 : left > right ? 1 : 0;
    }),
  };
}
export function timelineQuery(path: string) {
  return {
    ...readQuery<AgentTimeline>(path),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const previous = queryClient.getQueryData<AgentTimeline>(['api', path]);
      const next = await api<AgentTimeline>(
        path + (previous ? `?after=${previous.cursor}` : ''),
        undefined,
        signal,
      );
      return mergeTimeline(queryClient.getQueryData<AgentTimeline>(['api', path]), next);
    },
  };
}
