import { ReviewPanel } from './ReviewPanel';
import { SkillTextarea } from './SkillTextarea';
import type { Skill } from '@r2cloud/contracts/skills';
import { PreviewButton } from './PreviewButton';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CodexModel } from '@r2cloud/contracts/threads';
import type { Project, Comment, Thread } from '../lib/types';
import { api } from '../lib/api';
import { Avatar, Button, IconButton, Status } from './ui';
import { Icon } from './Icon';
import { useQuery } from '@tanstack/react-query';
import { queryClient, readQuery } from '../lib/queries';
import { timelineQuery, mergeTimeline } from '../lib/timeline';
import { refreshRead } from '../lib/realtime';
import type { AgentTimeline as Timeline } from '@r2cloud/contracts/agent';
import { AgentTimeline } from './AgentTimeline';
import { ModelPicker, ThinkingPicker } from './ModelPicker';
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
  selectedThreadId,
  onSelectThread,
  onBack,
}: {
  project: Project;
  taskId?: string;
  userId: string;
  selectedThreadId?: string | null;
  onSelectThread?: (id: string | null) => void;
  onBack?: () => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = selectedThreadId === undefined ? localSelected : selectedThreadId;
  function setSelected(id: string | null) {
    setLocalSelected(id);
    onSelectThread?.(id);
  }
  const [effort, setEffort] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [model, setModel] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  useLayoutEffect(() => {
    if (selectedThreadId !== undefined) {
      if (selectedThreadId === null) setModel(null);
      setText('');
      setEffort(null);
      setError('');
    }
  }, [selectedThreadId]);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    const resize = () => {
      field.style.height = 'auto';
      field.style.height = `${Math.min(field.scrollHeight, 180)}px`;
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) {
        width = field.clientWidth;
        resize();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [text]);
  const following = useRef(true);
  const feed = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const path = `/projects/${project.id}/threads`;
  const listQuery = useQuery(
    readQuery<{ threads: Thread[]; models: CodexModel[]; skills: Skill[] }>(path),
  );
  const detailQuery = useQuery({
    ...readQuery<Detail>(`${path}/${selected}`),
    enabled: !!selected,
  });
  const streamQuery = useQuery({
    ...timelineQuery(`${path}/${selected}/timeline`),
    enabled: !!selected,
  });
  const threads = (listQuery.data?.threads ?? []).filter(
    (thread) => !taskId || thread.taskId === taskId,
  );
  const models = listQuery.data?.models ?? [];
  const loaded = !!listQuery.data;
  const detail = selected ? detailQuery.data : null;
  const timeline = selected ? streamQuery.data : null;
  const selectedModel = detail ? detail.thread.model : model;
  const modelInfo = selectedModel
    ? models.find((model) => model.model === selectedModel)
    : models.find((model) => model.isDefault);
  const selectedEffort = modelInfo?.supportedReasoningEfforts?.some(
    (option) => option.reasoningEffort === effort,
  )
    ? effort
    : null;
  async function older() {
    if (!timeline?.nextBefore || historyBusy) return;
    setHistoryBusy(true);
    const target = `${path}/${selected}/timeline`;
    try {
      const next = await api<Timeline>(`${target}?before=${timeline.nextBefore}`);
      queryClient.setQueryData<Timeline>(['api', target], (current) =>
        current
          ? {
              ...current,
              items: mergeTimeline(next, { ...current, reset: false }).items,
              nextBefore: next.nextBefore,
            }
          : undefined,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryBusy(false);
    }
  }
  useLayoutEffect(() => {
    following.current = true;
    const box = feed.current;
    const body = content.current;
    if (!box || !body) return;
    const follow = () => {
      if (following.current) box.scrollTop = box.scrollHeight;
    };
    const observer = new ResizeObserver(follow);
    observer.observe(body);
    follow();
    return () => observer.disconnect();
  }, [selected]);
  useLayoutEffect(() => {
    if (following.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [timeline, detail?.messages.length]);
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
      await refreshRead(`${path}/${selected}/timeline`);
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
    try {
      const result = await api<{ id: string }>(target ? `${path}/${target}` : path, body);
      const archived = (body as { action: string }).action === 'archive';
      await refreshRead(path);
      if (archived) {
        queryClient.removeQueries({
          predicate: (query) => String(query.queryKey[1]).startsWith(`${path}/${target}`),
        });
        setSelected(null);
      } else {
        setSelected(result.id);
        await refreshRead(`${path}/${result.id}`);
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
    setModel(null);
    setEffort(null);
    setText('');
    setError('');
  }
  async function send() {
    if (busy || running || !text.trim() || (selected && !detail)) return;
    following.current = true;
    setBusy(true);
    setError('');
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
        current = await queryClient.fetchQuery(readQuery<Detail>(`${path}/${created.id}`));
      }
      await api(`${path}/${current.thread.id}`, {
        action: 'run',
        version: current.thread.version,
        body: text,
        reasoningEffort: selectedEffort,
      });
      setText('');
      await Promise.all([
        refreshRead(`${path}/${current.thread.id}/timeline`),
        refreshRead(`${path}/${current.thread.id}`),
        refreshRead(path),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeModel(value: string | null) {
    setEffort(null);
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
  const archiveAction = detail && (detail.thread.createdBy === userId || project.review) && (
    <Button
      variant="ghost"
      disabled={busy || running}
      onClick={() => void perform({ action: 'archive', version: detail.thread.version })}
    >
      Archive
    </Button>
  );
  return (
    <section className="thread-panel" aria-label="Agent conversations">
      {selectedThreadId === undefined && (
        <nav className="thread-navigation" aria-label="Conversation threads">
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
      )}
      <div className="thread-content">
        <div className="project-thread-toolbar">
          {onBack && (
            <Button variant="ghost" icon="board" onClick={onBack}>
              Project board
            </Button>
          )}
          <div className="thread-header-actions">
            {archiveAction}
            <IconButton
              name="add"
              label="New thread"
              disabled={busy || !project.contribute}
              onClick={newThread}
            />
          </div>
        </div>
        <header className="thread-heading">
          <div>
            <h3 title={detail?.thread.title}>
              {detail?.thread.title ??
                threads.find((thread) => thread.id === selected)?.title ??
                (selected ? 'Opening conversation…' : 'New conversation')}
            </h3>
          </div>
          <div className="thread-heading-actions">
            {selected && (
              <IconButton
                name="branch"
                label="Review saved changes"
                aria-pressed={reviewOpen}
                onClick={() => setReviewOpen(!reviewOpen)}
              />
            )}
            {detail && (
              <PreviewButton
                key={detail.thread.id}
                projectId={project.id}
                threadId={detail.thread.id}
                onError={setError}
              />
            )}
          </div>
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
          ref={feed}
          className="conversation-messages thread-messages"
          onClickCapture={(event) => {
            if ((event.target as Element).closest('summary')) following.current = false;
          }}
          onScroll={(event) => {
            const box = event.currentTarget;
            following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
          }}
          role="log"
          aria-label="Thread messages"
        >
          <div ref={content}>
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
            {timeline?.nextBefore && (
              <Button
                variant="ghost"
                busy={historyBusy}
                onClick={() => {
                  following.current = false;
                  void older();
                }}
              >
                Load older activity
              </Button>
            )}
            {timeline && (
              <AgentTimeline
                projectId={project.id}
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
                    ? detailQuery.isPending || streamQuery.isPending
                      ? 'Loading conversation…'
                      : 'Give Codex a clear next step.'
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
          </div>
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
          <SkillTextarea
            id={`thread-message-${selected ?? 'new'}`}
            ref={input}
            rows={1}
            required
            maxLength={8000}
            placeholder="Describe the next step…"
            value={text}
            onChange={setText}
            skills={listQuery.data?.skills ?? []}
            disabled={busy || !project.contribute}
          />
          <div className="thread-toolbar">
            <div className="thread-settings">
              {' '}
              <ModelPicker
                models={models}
                value={detail ? detail.thread.model : model}
                onChange={changeModel}
                disabled={
                  busy ||
                  running ||
                  !project.contribute ||
                  (!!selected &&
                    (!detail || (detail.thread.createdBy !== userId && !project.review)))
                }
              />
              <ThinkingPicker
                model={modelInfo}
                value={selectedEffort}
                onChange={setEffort}
                disabled={busy || running || !project.contribute || (!!selected && !detail)}
              />
            </div>
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
        {(error || listQuery.error || detailQuery.error || streamQuery.error) && (
          <p className="inline-error thread-error" role="alert">
            {error ||
              listQuery.error?.message ||
              detailQuery.error?.message ||
              streamQuery.error?.message}
          </p>
        )}
      </div>
      {reviewOpen && selected && (
        <ReviewPanel
          key={selected}
          projectId={project.id}
          threadId={selected}
          close={() => setReviewOpen(false)}
          onFeedback={
            project.contribute
              ? (feedback) => {
                  setText((current) => (current ? `${current}\n\n${feedback}` : feedback));
                  setReviewOpen(false);
                  requestAnimationFrame(() => input.current?.focus());
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
