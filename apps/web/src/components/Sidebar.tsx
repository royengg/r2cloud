import { useQuery } from '@tanstack/react-query';
import { readQuery } from '../lib/queries';
import type { Identity, Project, Thread } from '../lib/types';
import { Icon } from './Icon';
import { IconButton, Modal } from './ui';
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
  onThread: (id: string | null) => void;
}) {
  const threadQuery = useQuery({
    ...readQuery<{ threads: Thread[] }>(`/projects/${project?.id}/threads`),
    enabled: !!project,
  });
  const threads = (threadQuery.data?.threads ?? []).filter(
    (thread) => thread.createdBy === identity.user.id,
  );
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
                <button
                  className={`project-nav ${p.id === project?.id ? 'is-current' : ''}`}
                  aria-expanded={p.id === project?.id}
                  onClick={() => onProject(p.id)}
                >
                  <span className={`project-color project-color-${i % 3}`}>
                    <Icon name={i === 0 ? 'globe' : 'folder'} size={16} />
                  </span>
                  <span className="project-nav-title">{p.name}</span>
                  <Icon name={p.id === project?.id ? 'down' : 'right'} size={13} />
                </button>
                {p.id === project?.id && (
                  <div className="sidebar-threads">
                    <div className="sidebar-threads-heading">
                      <span>Your threads</span>
                      {project.contribute && (
                        <IconButton
                          name="add"
                          label={`New thread in ${p.name}`}
                          onClick={() => onThread(null)}
                        />
                      )}
                    </div>
                    {threadQuery.isPending ? (
                      <p className="sidebar-thread-hint" role="status">
                        Loading threads…
                      </p>
                    ) : threadQuery.isError ? (
                      <button
                        className="sidebar-thread-hint"
                        onClick={() => void threadQuery.refetch()}
                      >
                        Retry loading threads
                      </button>
                    ) : threads.length === 0 ? (
                      <p className="sidebar-thread-hint">Your conversations will appear here.</p>
                    ) : (
                      threads.map((thread) => {
                        const state = thread.turns?.[0]?.state;
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
                            key={thread.id}
                            className="sidebar-thread"
                            aria-current={selectedThreadId === thread.id ? 'page' : undefined}
                            title={`${thread.title}${status ? ` · ${status}` : ''}`}
                            onClick={() => onThread(thread.id)}
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
                            <span className="sidebar-thread-title">{thread.title}</span>
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
