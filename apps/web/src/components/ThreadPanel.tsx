import { useEffect, useRef, useState } from 'react';
import type { CodexModel } from '@r2cloud/contracts/threads';
import type { Project, Comment } from '../lib/types';
import { api } from '../lib/api';
import { Avatar, Button, Status } from './ui';
import { Icon } from './Icon';
import { io } from 'socket.io-client';
import type { AgentTimeline as Timeline } from '@r2cloud/contracts/agent';
import { AgentTimeline } from './AgentTimeline';
import { ModelPicker } from './ModelPicker';
type Thread = {
  id: string;
  title: string;
  model: string | null;
  instructions: string;
  taskId: string | null;
  version: number;
  createdBy: string;
};
type Detail = {
  failure?: string | null;
  activity?: string | null;
  thread: Thread;
  messages: Comment[];
  task: { id: string; title: string; state: string; version: number } | null;
  run: { state: string; stopped_at: string | null } | null;
};
export function ThreadPanel({
  project,
  taskId,
  userId,
  initialMessage = '',
}: {
  project: Project;
  taskId?: string;
  userId: string;
  initialMessage?: string;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [text, setText] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const following = useRef(true);
  const latest = useRef<HTMLDivElement>(null);
  const version = useRef(0);
  const path = `/projects/${project.id}/threads`;
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      const generation = ++version.current;
      try {
        const list = await api<{ threads: Thread[]; models: CodexModel[] }>(path);
        const current = selected ? await api<Detail>(`${path}/${selected}`) : null;
        const stream = selected ? await api<Timeline>(`${path}/${selected}/timeline`) : null;
        if (!disposed && generation === version.current) {
          setThreads(list.threads.filter((t) => !taskId || t.taskId === taskId));
          setModels(list.models);
          setDetail(current);
          setTimeline(stream);
          setLoaded(true);
        }
      } catch (e) {
        if (!disposed && generation === version.current) setError((e as Error).message);
      } finally {
        if (!disposed) timer = setTimeout(() => void load(), 5000);
      }
    }
    setDetail(null);
    setTimeline(null);
    const socket = io({ auth: { projectId: project.id }, withCredentials: true });
    socket.on('snapshot-required', () => {
      clearTimeout(timer);
      void load();
    });
    socket.on('access-ended', () => {
      setTimeline(null);
      setDetail(null);
    });
    void load();
    return () => {
      disposed = true;
      socket.disconnect();
      clearTimeout(timer);
      version.current++;
    };
  }, [path, taskId, selected]);
  useEffect(() => {
    if (following.current) latest.current?.scrollIntoView({ block: 'nearest' });
  }, [detail?.messages.length, selected, timeline?.cursor]);
  const running =
    (!!timeline && ['queued', 'running', 'waiting', 'unknown'].includes(timeline.state)) ||
    (!!detail?.run && !detail.run.stopped_at);
  const canRun = !!project.contribute && !running;
  async function control(body: unknown) {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`${path}/${selected}/control`, body);
      setTimeline(await api<Timeline>(`${path}/${selected}/timeline`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function perform(body: unknown, target = selected) {
    if (busy) return;
    setBusy(true);
    setError('');
    version.current++;
    try {
      const result = await api<{ id: string }>(target ? `${path}/${target}` : path, body);
      const archived = (body as { action: string }).action === 'archive';
      const list = await api<{ threads: Thread[]; models: CodexModel[] }>(path);
      version.current++;
      setThreads(list.threads.filter((t) => !taskId || t.taskId === taskId));
      setModels(list.models);
      if (archived) {
        setSelected(null);
        setDetail(null);
      } else {
        setSelected(result.id);
        setDetail(await api<Detail>(`${path}/${result.id}`));
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function newThread() {
    setSelected(null);
    setDetail(null);
    setModel(null);
    setText('');
    setError('');
  }
  async function send() {
    if (busy || running || !text.trim() || (selected && !detail)) return;
    setBusy(true);
    setError('');
    version.current++;
    try {
      let current = detail;
      if (!current) {
        const created = await api<{ id: string }>(path, {
          action: 'create',
          title: text.trim().replace(/\s+/g, ' ').slice(0, 80),
          model,
          instructions: '',
          taskId: taskId ?? null,
        });
        setSelected(created.id);
        current = await api<Detail>(`${path}/${created.id}`);
        setDetail(current);
      }
      await api(`${path}/${current.thread.id}`, {
        action: 'run',
        version: current.thread.version,
        body: text,
      });
      setTimeline(await api<Timeline>(`${path}/${current.thread.id}/timeline`));
      setText('');
      const updated = await api<Detail>(`${path}/${current.thread.id}`);
      const list = await api<{ threads: Thread[]; models: CodexModel[] }>(path);
      version.current++;
      setDetail(updated);
      setThreads(list.threads.filter((t) => !taskId || t.taskId === taskId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeModel(value: string | null) {
    if (!detail) {
      setModel(value);
      return;
    }
    void perform({
      action: 'update',
      version: detail.thread.version,
      title: detail.thread.title,
      instructions: detail.thread.instructions,
      model: value,
    });
  }
  const messages = detail?.messages ?? [];
  return (
    <section className="thread-panel" aria-label="Agent conversations">
      <nav className="thread-navigation" aria-label="Conversation threads">
        <Button icon="add" onClick={newThread} disabled={busy || !project.contribute}>
          New thread
        </Button>
        <div className="thread-list">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              title={thread.title}
              aria-pressed={selected === thread.id}
              disabled={busy}
              onClick={() => {
                setSelected(thread.id);
                setText('');
                setError('');
              }}
            >
              <Icon name="message" size={17} />
              <span>{thread.title}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="thread-content">
        <header className="thread-heading">
          <div>
            <h3 title={detail?.thread.title}>{detail?.thread.title ?? 'New conversation'}</h3>
          </div>
          {detail && (detail.thread.createdBy === userId || project.review) && (
            <Button
              variant="ghost"
              disabled={busy || running}
              onClick={() => void perform({ action: 'archive', version: detail.thread.version })}
            >
              Archive
            </Button>
          )}
        </header>
        {detail?.failure && (
          <p className="inline-error thread-error" role="alert">
            {detail.failure}
          </p>
        )}
        {detail?.task && (
          <div className="thread-task-context">
            <Icon name="flag" size={16} />
            <span>{detail.task.title}</span>
            <Status state={detail.task.state} />
          </div>
        )}
        <div
          className="conversation-messages thread-messages"
          onScroll={(event) => {
            const box = event.currentTarget;
            following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
          }}
          role="log"
          aria-label="Thread messages"
        >
          {!timeline?.items.length &&
            messages.map((message) => (
              <article className="conversation-message" key={message.id}>
                <Avatar name={message.name} size="small" />
                <div>
                  <strong>{message.name}</strong>
                  <p>{message.body}</p>
                </div>
              </article>
            ))}
          {timeline && (
            <AgentTimeline
              timeline={timeline}
              respond={control}
              disabled={busy || !project.contribute || timeline.actorId !== userId}
            />
          )}
          {!messages.length && !timeline?.items.length && (
            <div className="conversation-empty">
              <Icon name="message" size={28} />
              <p>
                {selected
                  ? 'Give Codex a clear next step.'
                  : loaded
                    ? 'What would you like to work on?'
                    : 'Loading conversations…'}
              </p>
            </div>
          )}
          {running && (
            <p className="thread-running" role="status">
              <Icon name="loading" size={16} />
              {timeline?.state === 'waiting'
                ? 'Waiting for your response'
                : timeline?.state === 'queued'
                  ? 'Starting Codex'
                  : 'Codex is working'}
            </p>
          )}
          <div ref={latest} />
        </div>
        <form
          className="conversation-reply"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor={`thread-message-${selected ?? 'new'}`}>
            Instructions or message
          </label>
          <textarea
            id={`thread-message-${selected ?? 'new'}`}
            rows={3}
            required
            maxLength={8000}
            placeholder="Describe the next step…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy || !project.contribute}
          />
          <div className="thread-toolbar">
            <ModelPicker
              models={models}
              value={detail ? detail.thread.model : model}
              onChange={changeModel}
              disabled={
                busy ||
                running ||
                !project.contribute ||
                (!!selected && (!detail || (detail.thread.createdBy !== userId && !project.review)))
              }
            />
            <div className="thread-actions">
              {running ? (
                <Button
                  type="button"
                  disabled={busy || timeline?.actorId !== userId}
                  onClick={() => void control({ action: 'stop' })}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  busy={busy}
                  disabled={!canRun || !text.trim() || (!!selected && !detail)}
                >
                  Send
                </Button>
              )}
            </div>
          </div>
        </form>
        {error && (
          <p className="inline-error thread-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
