import { io } from 'socket.io-client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Command as CommandIcon,
  FileCheck2,
  Flag,
  GitMerge,
  Layers3,
  Menu,
  MessageSquare,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  AlertCircle,
  ExternalLink,
  Play,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { Command, CandidateManifest, Evidence } from '@r2cloud/contracts/domain';
type Task = {
  id: string;
  title: string;
  outcome: string;
  criteria: string[];
  priority: string;
  state: string;
  version: number;
  generation: number;
  owner_name: string | null;
  owner_id: string | null;
  run: { state: string; manifest: any } | null;
  candidate: { id: string; digest: string; manifest: CandidateManifest; evidence: Evidence } | null;
  publication: { pr_number: number; url: string } | null;
  completed_at: string | null;
};
type Project = {
  id: string;
  name: string;
  org_name?: string;
  org_id: string;
  contribute: boolean;
  review: boolean;
  merge: boolean;
};
type Snapshot = {
  project: Project;
  tasks: Task[];
  participants: { id: string; name: string; review: boolean }[];
  comments: {
    id: string;
    task_id: string | null;
    body: string;
    name: string;
    created_at: string;
  }[];
  events: { id: string; task_id: string; kind: string; created_at: string }[];
  cursor: string;
};
type Me = { user: { id: string; name: string }; projects: Project[]; mode: string };
const stateLabel: Record<string, string> = {
  todo: 'Ready to start',
  building: 'Building the outcome',
  review: 'Needs your review',
  publishing: 'Publishing for code review',
  code_review: 'In code review',
  merging: 'Verifying merge',
  completed: 'Merged and verified',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};
async function api(path: string, body?: unknown, key?: string) {
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? {}
        : { 'Content-Type': 'application/json', 'Idempotency-Key': key ?? crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Unable to connect.');
  return data;
}
function initials(name: string) {
  return name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');
}
export function App() {
  const [me, setMe] = useState<Me | null>(null),
    [login, setLogin] = useState(false),
    [projectId, setProjectId] = useState('launch'),
    [data, setData] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(''),
    [attention, setAttention] = useState(false),
    [priority, setPriority] = useState('All priorities'),
    [filters, setFilters] = useState(false),
    [nav, setNav] = useState(false),
    [newTask, setNewTask] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [connection, setConnection] = useState('Connecting'),
    [message, setMessage] = useState(''),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState<'publish' | 'merge' | null>(null),
    [correct, setCorrect] = useState(false),
    [feedback, setFeedback] = useState('');
  const requestSerial = useRef(0),
    composer = useRef<HTMLTextAreaElement>(null),
    drawer = useRef<HTMLElement>(null),
    lastFocus = useRef<HTMLElement | null>(null);
  const refresh = useCallback(async () => {
    const serial = ++requestSerial.current;
    try {
      const next = await api(`/projects/${projectId}/snapshot`);
      if (serial === requestSerial.current) setData(next);
    } catch (e) {
      if (serial === requestSerial.current) setError((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    api('/me')
      .then((m: Me) => {
        setMe(m);
        setProjectId(
          m.projects.some((p) => p.id === 'launch') ? 'launch' : (m.projects[0]?.id ?? ''),
        );
      })
      .catch(() => setLogin(true));
  }, []);
  useEffect(() => {
    if (!me || !projectId) return;
    setData(null);
    setSelected(null);
    void refresh();
    const socket = io({ auth: { projectId }, withCredentials: true, transports: ['websocket'] });
    socket.on('connect', () => {
      setConnection('Live');
      void refresh();
    });
    socket.on('snapshot-required', () => void refresh());
    socket.on('disconnect', () => setConnection('Reconnecting'));
    socket.on('connect_error', () => setConnection('Connection unavailable'));
    socket.on('access-ended', () => {
      setData(null);
      setError('Your access ended. Sign in again.');
      setConnection('Access ended');
    });
    return () => {
      socket.disconnect();
      requestSerial.current++;
    };
  }, [me, projectId, refresh]);
  useEffect(() => {
    if (selected) {
      lastFocus.current = document.activeElement as HTMLElement;
      drawer.current?.focus();
    } else {
      lastFocus.current?.focus();
    }
    setCorrect(false);
    setConfirm(null);
    setFeedback('');
  }, [selected]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelected(null);
        setNewTask(false);
        setConfirm(null);
        setNav(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const task = data?.tasks.find((t) => t.id === selected),
    p = data?.project;
  const mutate = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
      if (success) setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runCommand = (input: Command) =>
    mutate(() => api(`/projects/${projectId}/tasks/${task!.id}/commands`, input), 'Task updated.');
  async function signIn(userId: string) {
    setBusy(true);
    try {
      await api('/local-session', { userId });
      const m = await api('/me');
      setMe(m);
      setLogin(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    await mutate(async () => {
      await api(`/projects/${projectId}/comments`, { taskId: selected, body: message });
      setMessage('');
    }, 'Feedback shared with the project.');
  }
  async function openPreview() {
    if (!task?.candidate) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const result = await api(
        `/projects/${projectId}/candidates/${task.candidate.id}/preview`,
        {},
      );
      if (tab) tab.location.href = result.url;
      else setError('Allow a new tab to open the private preview.');
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    }
  }
  const filtered =
    data?.tasks.filter(
      (t) =>
        (!search || `${t.title} ${t.outcome}`.toLowerCase().includes(search.toLowerCase())) &&
        (priority === 'All priorities' || t.priority === priority) &&
        (!attention ||
          t.state === 'blocked' ||
          (p?.review && t.state === 'review') ||
          (p?.merge && t.state === 'code_review')),
    ) ?? [];
  const attentionCount =
    data?.tasks.filter(
      (t) =>
        t.state === 'blocked' ||
        (p?.review && t.state === 'review') ||
        (p?.merge && t.state === 'code_review'),
    ).length ?? 0;
  const currentProject = me?.projects.find((x) => x.id === projectId);
  if (login)
    return (
      <div className="welcome">
        <div className="brandmark">
          <Layers3 size={28} />
        </div>
        <span className="eyebrow">R2CLOUD / PRODUCT WORKSPACE</span>
        <h1>
          Good ideas deserve
          <br />a place to become real.
        </h1>
        <p>
          Describe the outcome. Make progress together.
          <br />
          Review every change before it reaches your repository.
        </p>
        <div className="login-box">
          <span className="fixture-tag">LOCAL FIXTURE</span>
          <h2>Explore the workspace</h2>
          <p>
            Choose a sample participant. Cloud runs, previews and repository actions are simulated.
          </p>
          {[
            ['maya', 'Maya Chen', 'Contributor · Reviewer · Merge authoriser'],
            ['alex', 'Alex Morgan', 'Contributor'],
            ['sam', 'Sam Rivera', 'Viewer'],
          ].map(([id, name, role]) => (
            <button key={id} onClick={() => void signIn(id)} disabled={busy}>
              <span className="avatar">{initials(name)}</span>
              <span>
                <strong>{name}</strong>
                <small>{role}</small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
      </div>
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="top-left">
          <button className="icon-button" aria-label="Open navigation" onClick={() => setNav(!nav)}>
            <Menu size={20} />
          </button>
          <div className="brand">
            <Layers3 size={20} />
            <span>r2cloud</span>
          </div>
          <span className="divider" />
          <button className="context-switch" onClick={() => setNav(!nav)}>
            <span className="org-symbol">N</span>
            {currentProject?.org_name ?? 'Your organisation'}
            <ChevronDown size={13} />
          </button>
          <ChevronRight className="breadcrumb-chevron" size={13} />
          <label className="project-select">
            <span className="sr-only">Select project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {me?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="top-right">
          <span className="collaboration">
            <span className={'live-dot ' + (connection === 'Live' ? '' : 'offline')} />
            {connection}
          </span>
          <div className="avatars" aria-label="Project participants">
            {data?.participants.map((u, i) => (
              <span key={u.id} className={`avatar avatar-${i}`} title={u.name}>
                {initials(u.name)}
              </span>
            ))}
          </div>
          <button
            className="icon-button my-profile"
            aria-label={`Signed in as ${me?.user.name}`}
            title={me?.user.name}
            onClick={() => setNav(!nav)}
          >
            {initials(me?.user.name ?? 'You')}
          </button>
        </div>
      </header>
      {nav && (
        <div className="nav-popover">
          <span className="eyebrow">YOUR WORKSPACE</span>
          <strong>{currentProject?.org_name}</strong>
          {me?.projects.map((pr) => (
            <button
              key={pr.id}
              onClick={() => {
                setProjectId(pr.id);
                setNav(false);
              }}
            >
              <Layers3 size={16} />
              {pr.name}
              {pr.id === projectId && <Check size={15} />}
            </button>
          ))}
          <hr />
          <p>
            <ShieldCheck size={16} />
            Repository and AI connections are separate from project membership.
          </p>
          <button
            onClick={() =>
              void api('/logout', {}).then(() => {
                setMe(null);
                setLogin(true);
                setNav(false);
              })
            }
          >
            Switch fixture participant
            <ArrowUpRight size={16} />
          </button>
        </div>
      )}
      <main className="workspace">
        <div className="project-heading">
          <div>
            <div className="eyebrow">
              <span className="tiny-square" /> THE NEXT CHAPTER
            </div>
            <h1>
              {currentProject?.name ?? 'Your project'}
              <span className="project-dot">.</span>
            </h1>
            <p>A shared place to turn intentions into working outcomes.</p>
          </div>
          <button
            className="primary small"
            disabled={!p?.contribute}
            onClick={() => setNewTask(true)}
          >
            <Plus size={16} />
            New task
          </button>
        </div>
        <div className="board-toolbar">
          <div className="view-tabs">
            <button className={!attention ? 'active' : ''} onClick={() => setAttention(false)}>
              <Layers3 size={16} />
              Board<span>{data?.tasks.length ?? 0}</span>
            </button>
            <button className={attention ? 'active' : ''} onClick={() => setAttention(true)}>
              <Circle size={15} />
              Needs my attention
              {attentionCount > 0 && <span className="attention-count">{attentionCount}</span>}
            </button>
          </div>
          <div className="board-tools">
            <label className="search-box">
              <Search size={15} />
              <input
                aria-label="Search tasks"
                placeholder="Search tasks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span>/</span>
            </label>
            <button
              className={'filter-button ' + (filters ? 'active' : '')}
              onClick={() => setFilters(!filters)}
            >
              <SlidersHorizontal size={15} />
              Filter
            </button>
          </div>
        </div>
        {filters && (
          <div className="filter-row">
            <label>
              Priority{' '}
              <select
                aria-label="Filter priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {['All priorities', 'High', 'Medium', 'Low'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                setPriority('All priorities');
                setSearch('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            <AlertCircle size={16} />
            {error}
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className="board" aria-label="Project task board">
          {['Todo', 'Ongoing', 'Completed'].map((column, index) => {
            const tasks = filtered.filter((t) =>
              index === 0
                ? t.state === 'todo'
                : index === 2
                  ? t.state === 'completed'
                  : !['todo', 'completed'].includes(t.state),
            );
            return (
              <section className="column" key={column} aria-label={column}>
                <div className="column-title">
                  <div>
                    <span className={`status-dot dot-${index}`} />
                    <h2>{column}</h2>
                    <span className="column-count">{tasks.length}</span>
                  </div>
                  {index === 0 ? (
                    <button
                      aria-label="Add a task to Todo"
                      className="icon-button"
                      disabled={!p?.contribute}
                      onClick={() => setNewTask(true)}
                    >
                      <Plus size={16} />
                    </button>
                  ) : (
                    <span className="column-hint">{index === 1 ? 'In motion' : 'Merged'}</span>
                  )}
                </div>
                <div className="column-content">
                  {tasks.map((t, i) => (
                    <button
                      className={'task-card ' + (selected === t.id ? 'selected' : '')}
                      key={t.id}
                      onClick={() => setSelected(t.id)}
                    >
                      <div className="card-top">
                        <span className="task-code">
                          WEB–{String(data!.tasks.indexOf(t) + 1).padStart(2, '0')}
                        </span>
                        <span className={'priority priority-' + t.priority.toLowerCase()}>
                          <Flag size={11} />
                          {t.priority}
                        </span>
                      </div>
                      <h3>{t.title}</h3>
                      <p className="card-outcome">{t.outcome}</p>
                      {t.state !== 'todo' && (
                        <div className={'progress-badge badge-' + t.state}>
                          {t.state === 'review' ? (
                            <Circle size={11} />
                          ) : t.state === 'completed' ? (
                            <Check size={12} />
                          ) : t.state === 'blocked' ? (
                            <AlertCircle size={12} />
                          ) : (
                            <Clock3 size={12} />
                          )}{' '}
                          {stateLabel[t.state]}
                        </div>
                      )}
                      <div className="card-footer">
                        <div>
                          {t.owner_name ? (
                            <>
                              <span className="avatar mini">{initials(t.owner_name)}</span>
                              <span>{t.owner_name.split(' ')[0]}</span>
                            </>
                          ) : (
                            <>
                              <span className="unassigned">
                                <Users size={12} />
                              </span>
                              <span>Unassigned</span>
                            </>
                          )}
                        </div>
                        <span className="agent-marker">
                          {t.run ? (
                            <>
                              <Sparkles size={12} />
                              Agent
                            </>
                          ) : (
                            <>
                              <FileCheck2 size={12} />
                              {t.criteria.length} criteria
                            </>
                          )}
                        </span>
                      </div>
                      {t.state === 'building' && (
                        <div className="card-progress">
                          <span />
                        </div>
                      )}
                    </button>
                  ))}
                  {tasks.length === 0 && (
                    <div className="empty-column">
                      {index === 0 ? (
                        <Layers3 size={24} />
                      ) : index === 1 ? (
                        <Sparkles size={24} />
                      ) : (
                        <Check size={24} />
                      )}
                      <h3>
                        {search || attention || priority !== 'All priorities'
                          ? 'No matching tasks'
                          : index === 0
                            ? 'Room for your next idea'
                            : index === 1
                              ? 'Ready when you are'
                              : 'Outcomes, delivered'}
                      </h3>
                      <p>
                        {index === 0
                          ? 'Describe something you want to improve.'
                          : index === 1
                            ? 'Start a task to bring it into motion.'
                            : 'Tasks arrive here after a verified merge.'}
                      </p>
                    </div>
                  )}
                </div>
                {index === 0 && (
                  <button
                    className="add-task"
                    disabled={!p?.contribute}
                    onClick={() => setNewTask(true)}
                  >
                    <Plus size={15} />
                    Add a task
                  </button>
                )}
              </section>
            );
          })}
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <div className="composer-heading">
            <span className="composer-icon">
              <Sparkles size={16} />
            </span>
            <span>Keep the work moving</span>
            <span className="scope-pill">
              {selected ? 'Task' : 'Project'}
              <ChevronRight size={12} />
              {task?.title ?? currentProject?.name}
            </span>
            {selected && (
              <button
                type="button"
                className="icon-button"
                aria-label="Use project composer"
                onClick={() => setSelected(null)}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <textarea
            ref={composer}
            aria-label="Share project or task feedback"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              selected
                ? 'Share feedback or clarify the intended outcome…'
                : 'Share an idea, a little context, or what a great outcome looks like…'
            }
            rows={2}
            disabled={!p?.contribute}
          />
          <div className="composer-bottom">
            <span>
              <MessageSquare size={13} />
              Feedback is shared. Work starts when you choose “Start work”.
            </span>
            <button
              className="send-button"
              aria-label="Send feedback"
              disabled={busy || !message.trim() || !p?.contribute}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
        <footer className="workspace-footer">
          <span>
            <span className="fixture-dot" />
            Local fixture · Cloud runs and GitHub actions are simulated
          </span>
          <span>
            You decide what gets published <ShieldCheck size={13} />
          </span>
        </footer>
      </main>
      {task && (
        <>
          <button
            className="drawer-backdrop"
            aria-label="Close task details"
            onClick={() => setSelected(null)}
          />
          <aside
            ref={drawer}
            tabIndex={-1}
            className="task-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={task.title}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                const els = drawer.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]',
                );
                if (!els?.length) return;
                const first = els[0],
                  last = els[els.length - 1];
                if (
                  e.shiftKey &&
                  (document.activeElement === first || document.activeElement === drawer.current)
                ) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="drawer-top">
              <span>
                <Layers3 size={15} /> {currentProject?.name}
                <ChevronRight size={13} />
                Task details
              </span>
              <button
                className="icon-button"
                aria-label="Close task details"
                onClick={() => setSelected(null)}
              >
                <PanelRightClose size={20} />
              </button>
            </div>
            <div className="drawer-body">
              <span className={'progress-badge badge-' + task.state}>{stateLabel[task.state]}</span>
              <h1>{task.title}</h1>
              <div className="task-meta">
                <span>
                  <Flag size={13} />
                  {task.priority} priority
                </span>
                <span>{task.owner_name ?? 'Ready for an owner'}</span>
                {task.run && (
                  <span>
                    <Sparkles size={13} />
                    Codex · fixture
                  </span>
                )}
              </div>
              <section>
                <h2>The intended outcome</h2>
                <p>{task.outcome}</p>
              </section>
              <section>
                <h2>What success looks like</h2>
                <ul className="criteria-list">
                  {task.criteria.map((c, i) => (
                    <li key={i}>
                      <span
                        className={
                          task.candidate?.evidence.checks[i]?.status === 'passed'
                            ? 'criterion-check'
                            : ''
                        }
                      >
                        {task.candidate?.evidence.checks[i]?.status === 'passed' ? (
                          <Check size={13} />
                        ) : (
                          <Circle size={13} />
                        )}
                      </span>
                      {c}
                    </li>
                  ))}
                </ul>
                {task.candidate?.manifest.fixture && (
                  <small className="muted">
                    Check results below are fixtures, not executed application tests.
                  </small>
                )}
              </section>
              {task.state === 'todo' && (
                <div className="start-panel">
                  <Sparkles size={22} />
                  <h3>Give this outcome a first pass</h3>
                  <p>
                    One owner, an isolated execution, and a review before anything is published.
                  </p>
                  <small>Authorise one run · up to 15 minutes · $3 model budget limit</small>
                  <button
                    className="primary"
                    disabled={busy || !p?.contribute}
                    onClick={() =>
                      void runCommand({
                        action: 'start',
                        version: task.version,
                        minutes: 15,
                        budgetCents: 300,
                      })
                    }
                  >
                    <Play size={14} />
                    Start work
                  </button>
                </div>
              )}
              {task.state === 'building' && (
                <div className="info-panel">
                  <Sparkles size={18} />
                  <div>
                    <strong>Working toward your outcome</strong>
                    <p>This task stays with its current owner, even if you close this window.</p>
                  </div>
                </div>
              )}
              {task.state === 'blocked' && (
                <div className="info-panel warning">
                  <AlertCircle size={18} />
                  <div>
                    <strong>This task needs attention</strong>
                    <p>
                      Ownership is reserved while the worker verifies what happened. See activity
                      for details.
                    </p>
                  </div>
                </div>
              )}
              {task.candidate && (
                <>
                  <section className="preview-panel">
                    <div className="preview-window">
                      <div>
                        <span />
                        <span />
                        <span />
                        <small>PRIVATE SNAPSHOT PREVIEW</small>
                      </div>
                      <div className="preview-placeholder">
                        <Layers3 size={34} />
                        <strong>See the outcome for yourself.</strong>
                        <span>
                          Immutable candidate {task.candidate.digest.slice(0, 8)} · fixture
                        </span>
                        <button className="primary" onClick={() => void openPreview()}>
                          <ArrowUpRight size={15} />
                          Try the preview
                        </button>
                      </div>
                    </div>
                    <p>
                      <ShieldCheck size={13} />
                      Private, expiring access in a separate tab.
                    </p>
                  </section>
                  <section>
                    <h2>What changed</h2>
                    <p>{task.candidate.manifest.summary}</p>
                    <h3 className="subheading">Known limitations</h3>
                    {task.candidate.manifest.limitations.map((l, i) => (
                      <p key={i} className="limitation">
                        {l}
                      </p>
                    ))}
                  </section>
                  <section>
                    <h2>
                      Acceptance evidence <span className="fixture-tag">FIXTURE</span>
                    </h2>
                    {task.candidate.evidence.checks.map((c, i) => (
                      <div className="evidence-row" key={i}>
                        {c.status === 'passed' ? <Check size={15} /> : <AlertCircle size={15} />}
                        <span>{c.name}</span>
                        <small>{c.status}</small>
                      </div>
                    ))}
                  </section>
                </>
              )}
              {task.state === 'review' && (
                <section className="review-panel">
                  <h2>Your review makes the difference</h2>
                  <p>
                    Try the outcome and check the evidence. Publishing will push this exact
                    candidate and open a pull request for code review.
                  </p>
                  {!p?.review && (
                    <small>A designated project reviewer must approve publication.</small>
                  )}
                  <div className="review-buttons">
                    <button
                      disabled={busy || !(p?.review || task.owner_id === me?.user.id)}
                      onClick={() => setCorrect(!correct)}
                    >
                      Request changes
                    </button>
                    <button
                      className="primary"
                      disabled={busy || !p?.review}
                      onClick={() => setConfirm('publish')}
                    >
                      <ArrowUpRight size={14} />
                      Publish changes for code review
                    </button>
                  </div>
                  {correct && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void runCommand({ action: 'changes', version: task.version, feedback });
                      }}
                    >
                      <label>
                        What should be different?
                        <textarea
                          autoFocus
                          required
                          minLength={3}
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          placeholder="Describe the correction you want to see…"
                        />
                      </label>
                      <button className="primary" disabled={busy || feedback.trim().length < 3}>
                        Request correction and resume
                      </button>
                      <small>Another bounded run starts under the existing owner.</small>
                    </form>
                  )}
                </section>
              )}
              {task.state === 'code_review' && (
                <section className="review-panel">
                  <GitMerge size={22} />
                  <h2>Published for code review</h2>
                  <p>
                    Fixture pull request #{task.publication?.pr_number}. This task stays Ongoing
                    until a separately authorised merge is verified.
                  </p>
                  <button
                    className="primary"
                    disabled={busy || !p?.merge}
                    onClick={() => setConfirm('merge')}
                  >
                    Authorise merge
                  </button>
                </section>
              )}
              {task.state === 'completed' && (
                <div className="info-panel">
                  <Check size={20} />
                  <div>
                    <strong>Merge verified · fixture</strong>
                    <p>
                      The coding outcome is complete. Production deployment is tracked separately.
                    </p>
                  </div>
                </div>
              )}
              {confirm && task.candidate && (
                <section
                  className="confirmation"
                  role="alertdialog"
                  aria-label={confirm === 'publish' ? 'Confirm publication' : 'Confirm merge'}
                >
                  <ShieldCheck size={24} />
                  <h2>
                    {confirm === 'publish'
                      ? 'Publish this exact candidate?'
                      : 'Authorise this merge?'}
                  </h2>
                  <p>
                    {confirm === 'publish'
                      ? 'This permission covers pushing the candidate branch and opening one PR. Repository workflows may run.'
                      : 'This is a separate merge permission. Required repository checks and verified merge facts are needed before completion.'}
                  </p>
                  <dl>
                    <dt>Repository</dt>
                    <dd>{task.candidate.manifest.repository}</dd>
                    <dt>Target</dt>
                    <dd>{task.candidate.manifest.targetRef}</dd>
                    <dt>Candidate</dt>
                    <dd>{task.candidate.digest.slice(0, 16)}</dd>
                    <dt>Expires</dt>
                    <dd>30 minutes</dd>
                  </dl>
                  <p className="muted">Fixture mode: no real GitHub operation will occur.</p>
                  <div>
                    <button onClick={() => setConfirm(null)}>Go back</button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        void runCommand({
                          action: confirm,
                          version: task.version,
                          candidateId: task.candidate!.id,
                          digest: task.candidate!.digest,
                        });
                        setConfirm(null);
                      }}
                    >
                      {confirm === 'publish' ? 'Approve publication' : 'Approve merge'}
                    </button>
                  </div>
                </section>
              )}
              <section>
                <h2>Conversation & feedback</h2>
                {data?.comments
                  .filter((c) => c.task_id === task.id)
                  .map((c) => (
                    <article className="comment" key={c.id}>
                      <span className="avatar mini">{initials(c.name)}</span>
                      <div>
                        <strong>{c.name}</strong>
                        <p>{c.body}</p>
                      </div>
                    </article>
                  ))}
                {!data?.comments.some((c) => c.task_id === task.id) && (
                  <p className="muted">
                    A little context goes a long way. Add your thoughts below.
                  </p>
                )}
                <form className="feedback-form" onSubmit={sendMessage}>
                  <textarea
                    aria-label="Task feedback"
                    placeholder="Share feedback with the task owner…"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={!p?.contribute}
                  />
                  <button disabled={busy || !message.trim() || !p?.contribute}>
                    Send feedback
                    <MessageSquare size={14} />
                  </button>
                </form>
              </section>
              <section>
                <h2>Activity</h2>
                <div className="activity">
                  {data?.events
                    .filter((e) => e.task_id === task.id)
                    .map((e) => (
                      <div key={e.id}>
                        <span />
                        <p>
                          {e.kind}
                          <small>
                            {new Date(e.created_at).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </small>
                        </p>
                      </div>
                    ))}
                  {!data?.events.some((e) => e.task_id === task.id) && (
                    <p className="muted">Ready for the first step.</p>
                  )}
                </div>
              </section>
              <details className="advanced">
                <summary>
                  <Code2 size={16} />
                  Advanced details
                  <ChevronDown size={14} />
                </summary>
                <p>
                  Execution: {task.run?.state ?? 'Not started'} · generation {task.generation}
                </p>
                {task.candidate && (
                  <>
                    <p>Branch: {task.candidate.manifest.branch}</p>
                    <p>Base: {task.candidate.manifest.baseSha}</p>
                    <p>Head: {task.candidate.manifest.headSha}</p>
                    <p>Artifact: {task.candidate.manifest.artifactDigest}</p>
                    <p>Fixture runs contain no real diff or execution transcript.</p>
                  </>
                )}
                {task.run && (
                  <p>
                    Skills pinned:{' '}
                    {task.run.manifest.skills.map((s: any) => `${s.id}@${s.version}`).join(', ') ||
                      'None'}
                  </p>
                )}
              </details>
            </div>
            <div className="drawer-foot">
              <ShieldCheck size={14} />
              Agents cannot authorise publication or merge.
            </div>
          </aside>
        </>
      )}
      {newTask && (
        <NewTask
          busy={busy}
          close={() => setNewTask(false)}
          save={(input) =>
            mutate(async () => {
              const t = await api(`/projects/${projectId}/tasks`, input);
              setNewTask(false);
              setSelected(t.id);
            }, 'Task created.')
          }
        />
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {notice}
      </div>
    </div>
  );
}
function NewTask({
  busy,
  close,
  save,
}: {
  busy: boolean;
  close: () => void;
  save: (input: unknown) => Promise<void>;
}) {
  const [title, setTitle] = useState(''),
    [outcome, setOutcome] = useState(''),
    [criteria, setCriteria] = useState(''),
    [priority, setPriority] = useState('Medium');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog ref={dialog} className="new-task-modal" onCancel={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            title,
            outcome,
            criteria: criteria
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            priority,
          });
        }}
      >
        <div className="modal-heading">
          <span className="eyebrow">MAKE ROOM FOR AN OUTCOME</span>
          <button type="button" className="icon-button" aria-label="Close new task" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <h1>What would you like to improve?</h1>
        <p>A clear outcome gives everyone a useful place to start.</p>
        <label>
          Task title
          <input
            autoFocus
            required
            minLength={3}
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Make onboarding feel effortless"
          />
        </label>
        <label>
          Intended outcome
          <textarea
            required
            minLength={3}
            maxLength={8000}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Who is this for, and what should be better?"
          />
        </label>
        <label>
          Acceptance criteria <small>One per line</small>
          <textarea
            required
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder={'Visitors understand the next step\nThe experience works on a phone'}
          />
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {['High', 'Medium', 'Low'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Create task
            <Plus size={15} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
