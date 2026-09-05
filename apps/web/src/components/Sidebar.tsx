import type { Identity, Project } from '../lib/types';
import { Icon } from './Icon';
import { IconButton, Modal } from './ui';
import { AccountMenu } from './AccountMenu';
import { WorkspacePicker } from './WorkspacePicker';
export function Sidebar({
  identity,
  project,
  attention,
  attentionCount,
  onAttention,
  onProject,
  onClose,
  onConnections,
  onNewProject,
  onSignOut,
  mobile,
}: {
  identity: Identity;
  project: Project | undefined;
  attention: boolean;
  attentionCount: number;
  onAttention: (value: boolean) => void;
  onProject: (id: string) => void;
  onClose: () => void;
  onConnections: () => void;
  onNewProject: () => void;
  onSignOut: () => void;
  mobile: boolean;
}) {
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
      <nav className="sidebar-navigation" aria-label="Workspace navigation">
        <button
          className={!attention ? 'nav-item is-active' : 'nav-item'}
          onClick={() => onAttention(false)}
        >
          <Icon name="board" />
          <span>Project board</span>
        </button>
        <button
          className={attention ? 'nav-item is-active' : 'nav-item'}
          onClick={() => onAttention(true)}
        >
          <Icon name="attention" />
          <span>Needs my attention</span>
          {attentionCount > 0 && <span className="nav-count">{attentionCount}</span>}
        </button>
      </nav>
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
              <button
                key={p.id}
                className={`project-nav ${p.id === project?.id ? 'is-current' : ''}`}
                onClick={() => onProject(p.id)}
              >
                <span className={`project-color project-color-${i % 3}`}>
                  <Icon name={i === 0 ? 'globe' : 'folder'} size={16} />
                </span>
                <span>{p.name}</span>
                {p.id === project?.id && <span className="current-project-dot" />}
              </button>
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
