import { api } from '../lib/api';
import { refreshRead } from '../lib/realtime';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { readQuery } from '../lib/queries';
import type { Identity, Project, Thread, ConversationWorkspace } from '../lib/types';
import { Icon } from './Icon';
import { Button, IconButton, Modal } from './ui';
import { AccountMenu } from './AccountMenu';
import { WorkspacePicker } from './WorkspacePicker';
export function Sidebar({
  identity,
  project,
  onAttention,
  onProject,
  onClose,
  onConnections,
  onNewProject,
  onSignOut,
  mobile,
  selectedThreadId,
  selectedWorkspaceId,
  onThread,
}: {
  identity: Identity;
  project: Project | undefined;
  onAttention: (value: boolean) => void;
  onProject: (id: string) => void;
  onClose: () => void;
  onConnections: () => void;
  onNewProject: () => void;
  onSignOut: () => void;
  mobile: boolean;
  selectedThreadId: string | null;
  selectedWorkspaceId?: string;
  onThread: (id: string | null, workspaceId?: string) => void;
}) {
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceTitle, setWorkspaceTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const threadQuery = useQuery({
    ...readQuery<{ threads: Thread[]; workspaces: ConversationWorkspace[] }>(
      `/projects/${project?.id}/threads`,
    ),
    enabled: !!project,
  });
  const threads = (threadQuery.data?.threads ?? []).filter(
    (thread) => thread.createdBy === identity.user.id,
  );
  const workspaces = threadQuery.data?.workspaces ?? [];
  const activeWorkspaceId =
    selectedWorkspaceId ?? threads.find((thread) => thread.id === selectedThreadId)?.workspaceId;
  const orgs = [
    ...new Map(
      identity.projects.map((p) => [p.org_id, { id: p.org_id, name: p.org_name ?? p.org_id }]),
    ).values(),
  ];
  const body = (
    <>
      <div className="sidebar-brand">
        <button className="brand" onClick={() => onAttention(false)} aria-label="R2Cloud board">
          <span className="brand-symbol">
            <Icon name="cloud" size={23} />
          </span>
          <span>
            r2cloud<span className="brand-period">.</span>
          </span>
        </button>
      </div>
      <WorkspacePicker
        workspaces={orgs}
        selectedId={project?.org_id}
        onSelect={(orgId) => {
          const next = identity.projects.find((p) => p.org_id === orgId);
          if (next) onProject(next.id);
        }}
      />
      <div className="sidebar-projects">
        <div className="project-list-heading">
          <span className="section-label">Projects</span>
          {['owner', 'admin'].includes(project?.workspace_role ?? '') && (
            <IconButton name="add" label="New project" onClick={onNewProject} />
          )}
        </div>
        <nav aria-label="Projects">
          {identity.projects
            .filter((p) => p.org_id === project?.org_id)
            .map((p, i) => (
              <div key={p.id} className="sidebar-project-group">
                <div className="sidebar-project-heading">
                  <button
                    className={`project-nav ${p.id === project?.id ? 'is-current' : ''}`}
                    onClick={() => onProject(p.id)}
                  >
                    <span className={`project-color project-color-${i % 3}`}>
                      <Icon name={i === 0 ? 'globe' : 'folder'} size={16} />
                    </span>
                    <span className="project-nav-title">{p.name}</span>
                  </button>
                  {p.id === project?.id && project.contribute && (
                    <IconButton
                      name="add"
                      label={`New workspace in ${p.name}`}
                      onClick={() => {
                        setCollapsed((current) => ({ ...current, [p.id]: false }));
                        setWorkspaceTitle('');
                        setError('');
                        setCreatingWorkspace(true);
                      }}
                    />
                  )}
                  <IconButton
                    name={p.id === project?.id && !collapsed[p.id] ? 'down' : 'right'}
                    label={`${p.id === project?.id && !collapsed[p.id] ? 'Collapse' : 'Expand'} workspaces in ${p.name}`}
                    aria-expanded={p.id === project?.id && !collapsed[p.id]}
                    aria-controls={p.id === project?.id ? `project-threads-${p.id}` : undefined}
                    onClick={() => {
                      if (p.id !== project?.id) {
                        setCollapsed((current) => ({ ...current, [p.id]: false }));
                        onProject(p.id);
                      } else setCollapsed((current) => ({ ...current, [p.id]: !current[p.id] }));
                    }}
                  />
                </div>
                {p.id === project?.id && (
                  <div
                    className="sidebar-threads"
                    id={`project-threads-${p.id}`}
                    hidden={!!collapsed[p.id]}
                  >
                    {threadQuery.isPending ? (
                      <p className="sidebar-thread-hint" role="status">
                        Loading workspaces…
                      </p>
                    ) : threadQuery.isError ? (
                      <button
                        className="sidebar-thread-hint"
                        onClick={() => void threadQuery.refetch()}
                      >
                        Retry loading workspaces
                      </button>
                    ) : workspaces.length === 0 ? (
                      <p className="sidebar-thread-hint">Create a workspace to start chatting.</p>
                    ) : (
                      workspaces.map((workspace) => {
                        const workspaceThreads = threads.filter(
                          (thread) => thread.workspaceId === workspace.id,
                        );
                        const state =
                          workspaceThreads
                            .flatMap((thread) => thread.turns ?? [])
                            .find((turn) => turn.state === 'waiting')?.state ??
                          workspaceThreads.flatMap((thread) => thread.turns ?? [])[0]?.state;
                        const status =
                          state === 'waiting'
                            ? 'Needs your input'
                            : state === 'queued'
                              ? 'Queued'
                              : state === 'unknown'
                                ? 'Reconnecting'
                                : state === 'running'
                                  ? 'Running'
                                  : '';
                        return (
                          <button
                            key={workspace.id}
                            className="sidebar-thread"
                            aria-current={activeWorkspaceId === workspace.id ? 'page' : undefined}
                            title={`${workspace.title}${status ? ` · ${status}` : ''}`}
                            onClick={() => onThread(workspaceThreads[0]?.id ?? null, workspace.id)}
                          >
                            <span className="sidebar-thread-icon" data-state={state}>
                              <Icon
                                name={
                                  state === 'running'
                                    ? 'loading'
                                    : state === 'waiting'
                                      ? 'attention'
                                      : state === 'queued'
                                        ? 'clock'
                                        : state === 'unknown'
                                          ? 'info'
                                          : 'message'
                                }
                                size={15}
                              />
                            </span>
                            <span className="sidebar-thread-title">{workspace.title}</span>
                            {status && <span className="sr-only"> · {status}</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            ))}
        </nav>
      </div>
      {creatingWorkspace && project && (
        <Modal
          label="New conversation workspace"
          className="confirmation-modal"
          close={() => !saving && setCreatingWorkspace(false)}
        >
          <h2>New workspace</h2>
          <p>Keep related conversations together in {project.name}.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving) return;
              setSaving(true);
              setError('');
              try {
                const workspace = await api<ConversationWorkspace>(
                  `/projects/${project.id}/conversation-workspaces`,
                  { title: workspaceTitle },
                );
                await refreshRead(`/projects/${project.id}/threads`);
                setCreatingWorkspace(false);
                onThread(null, workspace.id);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <label>
              Name
              <input
                autoFocus
                required
                maxLength={80}
                value={workspaceTitle}
                onChange={(event) => setWorkspaceTitle(event.target.value)}
                placeholder="What are you working on?"
              />
            </label>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <Button type="button" disabled={saving} onClick={() => setCreatingWorkspace(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                busy={saving}
                disabled={!workspaceTitle.trim()}
              >
                Create workspace
              </Button>
            </div>
          </form>
        </Modal>
      )}
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={onConnections}>
          <Icon name="link" />
          <span>Connections</span>
        </button>
        <AccountMenu
          name={identity.user.name}
          onSignOut={onSignOut}
          onConnections={onConnections}
        />
      </div>
    </>
  );
  return mobile ? (
    <Modal label="Workspace navigation" close={onClose} className="sidebar-modal">
      <div className="sidebar-content">{body}</div>
    </Modal>
  ) : (
    <aside className="sidebar">
      <div className="sidebar-content">{body}</div>
    </aside>
  );
}
