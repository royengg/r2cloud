import { useEffect, useState } from 'react';
import { AuthScreen, WorkspaceSetup } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { Board } from './components/Board';
import { Composer } from './components/Composer';
import { TaskDetail } from './components/TaskDetail';
import { ConnectionsPanel } from './components/ConnectionsPanel';
import { TeamPanel } from './components/TeamPanel';
import { InvitationInbox } from './components/InvitationInbox';
import { NewProject } from './components/NewProject';
import { NewTask } from './components/NewTask';
import { Icon } from './components/Icon';
import { Avatar, Button, IconButton, Modal } from './components/ui';
import { useWorkspace } from './lib/useWorkspace';
import { api } from './lib/api';
export function App() {
  const w = useWorkspace();
  const [mobile, setMobile] = useState(() => innerWidth < 900),
    [sidebarOpen, setSidebarOpen] = useState(() => innerWidth >= 900),
    [attention, setAttention] = useState(false),
    [search, setSearch] = useState(''),
    [priority, setPriority] = useState('All priorities'),
    [showFilters, setShowFilters] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [newProject, setNewProject] = useState(false),
    [connections, setConnections] = useState(
      () => new URLSearchParams(location.search).get('connections') === '1',
    ),
    [participants, setParticipants] = useState(false),
    [inboxDismissed, setInboxDismissed] = useState(false);
  useEffect(() => {
    setInboxDismissed(false);
  }, [w.identity?.user.id]);
  useEffect(() => {
    const media = matchMedia('(max-width: 899px)');
    const change = () => {
      setMobile(media.matches);
      setSidebarOpen(!media.matches);
    };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    setSelectedId(null);
    setSearch('');
    setPriority('All priorities');
    setAttention(false);
  }, [w.projectId]);
  useEffect(() => {
    const pointer = () => document.body.removeAttribute('data-keyboard');
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') document.body.dataset.keyboard = 'true';
    };
    window.addEventListener('pointerdown', pointer);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('pointerdown', pointer);
      window.removeEventListener('keydown', keyboard);
    };
  }, []);
  const project = w.snapshot?.project,
    context = w.identity?.projects.find((p) => p.id === w.projectId),
    task = w.snapshot?.tasks.find((t) => t.id === selectedId),
    tasks = w.snapshot?.tasks ?? [];
  const needsAttention = (t: (typeof tasks)[number]) =>
    t.state === 'blocked' ||
    (project?.review && t.state === 'review') ||
    (project?.merge && t.state === 'code_review');
  const attentionCount = tasks.filter(needsAttention).length;
  const filtered = tasks.filter(
    (t) =>
      (!attention || needsAttention(t)) &&
      `${t.title} ${t.outcome}`.toLowerCase().includes(search.toLowerCase()) &&
      (priority === 'All priorities' || t.priority === priority),
  );
  const selectProject = (id: string) => {
    w.setProjectId(id);
    if (mobile) setSidebarOpen(false);
  };
  async function preview() {
    if (!task?.candidate) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const grant = await api<{ url: string }>(
        `/projects/${w.projectId}/candidates/${task.candidate.id}/preview`,
        {},
      );
      if (tab) tab.location.href = grant.url;
      else w.setError('Allow a new tab, then try the preview again.');
    } catch (error) {
      tab?.close();
      w.setError((error as Error).message);
    }
  }
  if (!w.ready)
    return (
      <div className="initial-loading">
        <span className="brand-symbol">
          <Icon name="cloud" size={28} />
        </span>
        <span>Opening your workspace…</span>
      </div>
    );
  if (!w.authConfig)
    return (
      <main className="initial-loading">
        <p role="alert">Sign-in settings could not be loaded.</p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </main>
    );
  if (!w.identity) return <AuthScreen enabled={w.authConfig.enabled} />;
  if (w.identity && (w.identity.invitations?.length ?? 0) > 0 && !inboxDismissed)
    return (
      <InvitationInbox
        invitations={w.identity.invitations!}
        busy={w.busy}
        error={w.error}
        close={() => setInboxDismissed(true)}
        accept={(id) =>
          void w.act(async () => {
            const result = await api<{ projectId: string }>(`/invitations/${id}/accept`, {});
            await w.loadIdentity(result.projectId);
          }, 'Invitation accepted')
        }
      />
    );
  if (w.identity && w.identity.projects.length === 0)
    return (
      <WorkspaceSetup
        invitationCount={w.identity.invitations?.length ?? 0}
        onInvitations={() => setInboxDismissed(false)}
        busy={w.busy}
        error={w.error}
        onSignOut={() => void w.signOut()}
        onCreate={(input) =>
          w.act(async () => {
            await api('/workspaces', input);
            await w.loadIdentity();
          }, 'Workspace created')
        }
      />
    );
  return (
    <div
      className={`workspace-shell ${sidebarOpen && !mobile ? 'with-sidebar' : ''}`}
      data-connection={w.connection}
    >
      <a href="#main-content" className="skip-link">
        Skip to board
      </a>
      {sidebarOpen && (
        <Sidebar
          identity={w.identity}
          project={context}
          onAttention={(value) => {
            setAttention(value);
            if (mobile) setSidebarOpen(false);
          }}
          onProject={selectProject}
          onNewProject={() => setNewProject(true)}
          onClose={() => setSidebarOpen(false)}
          onConnections={() => setConnections(true)}
          onSignOut={() => void w.signOut()}
          mobile={mobile}
        />
      )}
      <div className="workspace-main">
        <header className="context-bar">
          <div className="context-leading">
            <IconButton
              name="sidebar"
              label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            />
            <span className="context-organisation">{context?.org_name}</span>
            <Icon name="right" size={13} />
            <span className="context-project">{context?.name}</span>
          </div>
          <div className="context-trailing">
            {!!w.identity.invitations?.length && (
              <Button variant="ghost" icon="people" onClick={() => setInboxDismissed(false)}>
                Invitations ({w.identity.invitations.length})
              </Button>
            )}
            <div className="participant-stack">
              {w.snapshot?.participants.slice(0, 4).map((person, i) => (
                <Avatar key={person.id} name={person.name} tone={i} />
              ))}
              <button
                className="participant-plus"
                aria-label="View project participants"
                title="Project team"
                onClick={() => setParticipants(true)}
              >
                <Icon name="people" size={16} />
              </button>
            </div>
          </div>
        </header>
        <main id="main-content" className="board-workspace">
          <section className="project-intro">
            <div className="project-title-group">
              <span className="project-cover-icon">
                <Icon name="globe" size={28} />
              </span>
              <div>
                <div className="project-eyebrow">
                  A shared project <span>·</span> Web application
                </div>
                <h1>{context?.name ?? 'Your project'}</h1>
              </div>
            </div>
            {project?.contribute ? (
              <Button icon="add" variant="primary" onClick={() => setCreating(true)}>
                New task
              </Button>
            ) : (
              <span className="view-only">View only</span>
            )}
          </section>
          <div className="board-control-row">
            <div className="board-views" role="group" aria-label="Task view">
              <button aria-pressed={!attention} onClick={() => setAttention(false)}>
                <Icon name="board" size={17} />
                Board<span>{tasks.length}</span>
              </button>
              <button aria-pressed={attention} onClick={() => setAttention(true)}>
                <Icon name="attention" size={17} />
                <span className="attention-label">Needs my attention</span>
                {attentionCount > 0 && <span className="attention-number">{attentionCount}</span>}
              </button>
            </div>
            <div className="board-filters">
              <label className="task-search">
                <Icon name="search" size={18} />
                <span className="sr-only">Search tasks</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tasks"
                />
              </label>
              <button
                className={`filter-trigger ${showFilters ? 'is-active' : ''}`}
                aria-expanded={showFilters}
                onClick={() => setShowFilters(!showFilters)}
              >
                <Icon name="filter" size={18} />
                <span>Filter</span>
              </button>
            </div>
          </div>
          {showFilters && (
            <div className="active-filters">
              <label>
                Priority
                <select
                  aria-label="Filter priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {['All priorities', 'High', 'Medium', 'Low'].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setPriority('All priorities');
                  setAttention(false);
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
          {w.snapshot ? (
            <Board
              tasks={filtered}
              allTasks={tasks}
              onSelect={setSelectedId}
              onCreate={() => setCreating(true)}
              canCreate={!!project?.contribute}
              filtered={!!search || attention || priority !== 'All priorities'}
            />
          ) : (
            <div className="board-loading" role="status">
              <Icon name="loading" size={24} />
              {w.error ? 'The board is unavailable.' : 'Gathering your tasks…'}
              {w.error && <Button onClick={() => location.reload()}>Reload workspace</Button>}
            </div>
          )}
          <Composer
            key={w.projectId}
            projectName={context?.name ?? 'Project'}
            busy={w.busy}
            canComment={!!project?.contribute}
            comments={w.snapshot?.comments.filter((c) => !c.task_id) ?? []}
            onSend={(body) =>
              w.act(
                () => api(`/projects/${w.projectId}/comments`, { taskId: null, body }),
                'Project feedback shared',
              )
            }
          />
        </main>
      </div>
      {task && project && (
        <TaskDetail
          key={task.id}
          task={task}
          project={project}
          userId={w.identity.user.id}
          comments={w.snapshot!.comments.filter((c) => c.task_id === task.id)}
          events={w.snapshot!.events.filter((e) => e.task_id === task.id)}
          busy={w.busy}
          error={w.error}
          close={() => setSelectedId(null)}
          onCommand={(input) =>
            w.act(
              () => api(`/projects/${w.projectId}/tasks/${task.id}/commands`, input),
              'Task updated',
            )
          }
          onPreview={preview}
          onFeedback={(body) =>
            w.act(
              () => api(`/projects/${w.projectId}/comments`, { taskId: task.id, body }),
              'Task feedback shared',
            )
          }
        />
      )}
      {newProject && context && (
        <NewProject
          workspace={context.org_name ?? 'your workspace'}
          busy={w.busy}
          error={w.error}
          close={() => setNewProject(false)}
          save={(name) =>
            w.act(async () => {
              const result = await api<{ projectId: string }>(
                `/workspaces/${context.org_id}/projects`,
                { name },
              );
              await w.loadIdentity(result.projectId);
              setNewProject(false);
            }, 'Project created')
          }
        />
      )}
      {creating && (
        <NewTask
          busy={w.busy}
          error={w.error}
          close={() => setCreating(false)}
          save={(input) =>
            w.act(async () => {
              const created = await api<{ id: string }>(`/projects/${w.projectId}/tasks`, input);
              setCreating(false);
              setSelectedId(created.id);
            }, 'Task created')
          }
        />
      )}
      {connections && (
        <ConnectionsPanel
          key={w.projectId}
          projectId={w.projectId}
          providerConnected={!!project?.provider_connected}
          close={() => setConnections(false)}
          onConnected={() => w.loadIdentity(w.projectId)}
        />
      )}
      {participants && ['owner', 'admin'].includes(context?.workspace_role ?? '') && (
        <TeamPanel key={w.projectId} projectId={w.projectId} close={() => setParticipants(false)} />
      )}
      {participants && !['owner', 'admin'].includes(context?.workspace_role ?? '') && (
        <Modal
          label="Project participants"
          close={() => setParticipants(false)}
          className="participants-modal"
        >
          <div className="modal-topline">
            <h2>Making it happen, together.</h2>
            <IconButton
              name="close"
              label="Close participants"
              onClick={() => setParticipants(false)}
            />
          </div>
          {w.snapshot?.participants.map((person, i) => (
            <div className="person-row" key={person.id}>
              <Avatar name={person.name} tone={i} />
              <div>
                <strong>{person.name}</strong>
                <span>{person.review ? 'Project reviewer' : 'Project member'}</span>
              </div>
            </div>
          ))}
        </Modal>
      )}
      {w.error && !task && !creating && (
        <div className="error-toast" role="alert">
          <Icon name="info" size={19} />
          <span>{w.error}</span>
          <IconButton name="close" label="Dismiss error" onClick={() => w.setError('')} />
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {w.announcement}
      </div>
    </div>
  );
}
