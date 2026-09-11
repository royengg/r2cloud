import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { readQuery } from '../lib/queries';
import { refreshRead } from '../lib/realtime';
import type { Thread } from '../lib/types';
import { Button } from './ui';
import { Icon } from './Icon';

export function TaskConversations({
  projectId,
  taskId,
  title,
  canCreate,
  onOpen,
}: {
  projectId: string;
  taskId: string;
  title: string;
  canCreate: boolean;
  onOpen: (id: string, workspaceId?: string) => void;
}) {
  const path = `/projects/${projectId}/threads`;
  const query = useQuery(readQuery<{ threads: Thread[] }>(path));
  const threads = (query.data?.threads ?? []).filter((thread) => thread.taskId === taskId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const thread = await api<{ id: string }>(path, { action: 'create', title, taskId });
      await refreshRead(path);
      onOpen(thread.id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="task-conversations" aria-label="Task conversations">
      <div className="task-section-heading">
        <h3>Linked threads</h3>
        {canCreate && (
          <Button icon="add" busy={busy} onClick={() => void create()}>
            New thread
          </Button>
        )}
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
        <p>No conversations yet. Start a thread to discuss this task with an agent.</p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
