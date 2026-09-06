import { useEffect, useRef, useState } from 'react';
import type { CodexModel } from '@r2cloud/contracts/threads';
import type { Project, Comment } from '../lib/types';
import { api } from '../lib/api';
import { Avatar, Button, IconButton, Status } from './ui';
import { Icon } from './Icon';
import { CodexLogo } from './CodexLogo';
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
  legacy = [],
  initialMessage = '',
}: {
  project: Project;
  taskId?: string;
  userId: string;
  legacy?: Comment[];
  initialMessage?: string;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [editVersion, setEditVersion] = useState(0);
  const [title, setTitle] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [instructions, setInstructions] = useState('');
  const [text, setText] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
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
        if (!disposed && generation === version.current) {
          setThreads(list.threads.filter((t) => !taskId || t.taskId === taskId));
          setModels(list.models);
          setDetail(current);
          setLoaded(true);
        }
      } catch (e) {
        if (!disposed && generation === version.current) setError((e as Error).message);
      } finally {
        if (!disposed) timer = setTimeout(() => void load(), 2000);
      }
    }
    setDetail(null);
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      version.current++;
    };
  }, [path, taskId, selected]);
  useEffect(() => {
    latest.current?.scrollIntoView({ block: 'nearest' });
  }, [detail?.messages.length, selected]);
  const running = !!detail?.run && !detail.run.stopped_at;
  const canRun =
    !!project.contribute &&
    (!detail?.task || ['todo', 'review', 'blocked'].includes(detail.task.state)) &&
    !running;
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
      setEditing(false);
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
    setTitle('');
    setModel(null);
    setInstructions('');
    setText('');
    setEditing(true);
    setError('');
  }
  function settings() {
    if (!detail) return;
    setEditVersion(detail.thread.version);
    setTitle(detail.thread.title);
    setModel(detail.thread.model);
    setInstructions(detail.thread.instructions);
    setEditing(true);
  }
  async function send(run: boolean) {
    if (!text.trim() || !detail) return;
    if (
      await perform(
        run
          ? {
              action: 'run',
              version: detail.thread.version,
              taskVersion: detail.task?.version,
              body: text,
            }
          : { action: 'message', body: text },
      )
    )
      setText('');
  }
  const messages = detail?.messages ?? (!selected && !editing ? legacy : []);
  return (
    <section className="thread-panel" aria-label="Agent conversations">
      <nav className="thread-navigation" aria-label="Conversation threads">
        <Button icon="add" onClick={newThread} disabled={busy || !project.contribute}>
          New thread
        </Button>
        <div className="thread-list">
          {legacy.length > 0 && (
            <button
              type="button"
              aria-pressed={!selected && !editing}
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setDetail(null);
                setEditing(false);
              }}
            >
              Earlier messages
            </button>
          )}
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              aria-pressed={selected === thread.id}
              disabled={busy}
              onClick={() => {
                setSelected(thread.id);
                setEditing(false);
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
        {editing || (!selected && !threads.length && loaded && !legacy.length) ? (
          <form
            className="thread-settings"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(
                selected && detail
                  ? { action: 'update', version: editVersion, title, model, instructions }
                  : { action: 'create', title, model, instructions, taskId: taskId ?? null },
                selected,
              );
            }}
          >
            <h3>{selected ? 'Thread settings' : 'A new conversation'}</h3>
            <label>
              Thread name
              <input
                autoFocus
                required
                maxLength={160}
                placeholder="What are we working on?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <fieldset className="thread-models">
              <legend>Model</legend>
              {[{ model: '', displayName: 'Codex default', isDefault: true }, ...models].map(
                (m) => (
                  <label key={m.model}>
                    <input
                      type="radio"
                      name="thread-model"
                      value={m.model}
                      checked={(model ?? '') === m.model}
                      onChange={() => setModel(m.model || null)}
                    />
                    <span>{m.displayName}</span>
                  </label>
                ),
              )}
            </fieldset>
            <label>
              Instructions <span className="subtle">Optional</span>
              <textarea
                rows={3}
                maxLength={8000}
                placeholder="Preferences and context for this thread…"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <div className="thread-actions">
              <Button variant="primary" busy={busy} disabled={!project.contribute || !title.trim()}>
                {selected ? 'Save settings' : 'Create thread'}
              </Button>
              {selected && (
                <Button type="button" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        ) : (
          <>
            <header className="thread-heading">
              <div>
                <h3>{detail?.thread.title ?? 'Conversations'}</h3>
                {detail && (
                  <span className="thread-model-label">
                    <CodexLogo />
                    {models.find((m) => m.model === detail.thread.model)?.displayName ??
                      detail.thread.model ??
                      'Codex default'}
                  </span>
                )}
              </div>
              {detail && (detail.thread.createdBy === userId || project.review) && (
                <>
                  <IconButton
                    name="settings"
                    label="Thread settings"
                    disabled={busy || running}
                    onClick={settings}
                  />
                  <Button
                    variant="ghost"
                    disabled={busy || running}
                    onClick={() =>
                      void perform({ action: 'archive', version: detail.thread.version })
                    }
                  >
                    Archive
                  </Button>
                </>
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
              role="log"
              aria-label="Thread messages"
            >
              {messages.map((message) => (
                <article className="conversation-message" key={message.id}>
                  <Avatar name={message.name} size="small" />
                  <div>
                    <strong>{message.name}</strong>
                    <p>{message.body}</p>
                  </div>
                </article>
              ))}
              {!messages.length && (
                <div className="conversation-empty">
                  <Icon name="message" size={28} />
                  <p>
                    {selected
                      ? 'Give Codex a clear next step.'
                      : loaded
                        ? 'Choose a thread or start a new one.'
                        : 'Loading conversations…'}
                  </p>
                </div>
              )}
              {running && (
                <p className="thread-running" role="status">
                  <Icon name="loading" size={16} />
                  {detail?.activity ?? 'Preparing the task'}
                </p>
              )}
              <div ref={latest} />
            </div>
            {detail && (
              <form
                className="conversation-reply"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(true);
                }}
              >
                <label className="sr-only" htmlFor={`thread-message-${detail.thread.id}`}>
                  Instructions or message
                </label>
                <textarea
                  id={`thread-message-${detail.thread.id}`}
                  rows={3}
                  required
                  maxLength={8000}
                  placeholder="Describe the next step…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy || !project.contribute}
                />
                <div className="thread-actions">
                  <Button
                    type="button"
                    onClick={() => void send(false)}
                    icon="message"
                    busy={busy}
                    disabled={!project.contribute || !text.trim()}
                  >
                    Save note
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    icon="play"
                    busy={busy}
                    disabled={!canRun || text.trim().length < 1}
                    onClick={() => void send(true)}
                  >
                    {!detail.task
                      ? 'Create task & start work'
                      : detail.task.state === 'todo'
                        ? 'Start work'
                        : 'Run next turn'}
                  </Button>
                </div>
              </form>
            )}
          </>
        )}
        {error && (
          <p className="inline-error thread-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
