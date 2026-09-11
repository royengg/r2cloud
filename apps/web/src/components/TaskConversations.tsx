import { useQuery } from '@tanstack/react-query';
import { readQuery } from '../lib/queries';
import type { Thread } from '../lib/types';
import { Button } from './ui';
import { Icon } from './Icon';

export function TaskConversations({
  projectId,
  taskId,
  onOpen,
}: {
  projectId: string;
  taskId: string;
  onOpen: (id: string, workspaceId?: string) => void;
}) {
  const path = `/projects/${projectId}/threads`;
  const query = useQuery(readQuery<{ threads: Thread[] }>(path));
  const threads = (query.data?.threads ?? []).filter((thread) => thread.taskId === taskId);
  return (
    <section className="task-conversations" aria-label="Task conversations">
      <div className="task-section-heading">
        <h3>Linked threads</h3>
      </div>
      {query.isPending ? (
        <p role="status">Loading conversations…</p>
      ) : query.isError ? (
        <Button onClick={() => void query.refetch()}>Retry loading conversations</Button>
      ) : threads.length ? (
        <div className="task-thread-list">
          {threads.map((thread) => (
            <button key={thread.id} onClick={() => onOpen(thread.id, thread.workspaceId)}>
              <Icon name={thread.turns?.length ? 'loading' : 'message'} size={18} />
              <span>{thread.title}</span>
              {thread.turns?.length ? <span className="sr-only">Agent active</span> : null}
              <Icon name="right" size={16} />
            </button>
          ))}
        </div>
      ) : (
        <p>No conversations yet. Select Ask agent on the task card to start one.</p>
      )}
    </section>
  );
}
