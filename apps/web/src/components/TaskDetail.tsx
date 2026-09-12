import { Select } from './Select';
import { canMoveTask } from '../lib/types';
import { RichText } from './RichText';
import { ReviewPanel } from './ReviewPanel';
import { TaskConversations } from './TaskConversations';
import { useState } from 'react';
import type { Command } from '@r2cloud/contracts/domain';
import type { Task, Project, Activity } from '../lib/types';
import { Icon } from './Icon';
import { Avatar, Button, IconButton, Modal, Status } from './ui';
export function TaskDetail({
  task,
  project,
  userId,
  events,
  busy,
  error,
  close,
  onCommand,
  onPreview,
  onOpenThread,
  participants,
}: {
  task: Task;
  project: Project;
  userId: string;
  events: Activity[];
  busy: boolean;
  error: string;
  close: () => void;
  onCommand: (input: Command) => Promise<boolean>;
  onPreview: () => Promise<void>;
  onOpenThread: (id: string, workspaceId?: string) => void;
  participants: { id: string; name: string; contribute?: boolean }[];
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [view, setView] = useState('overview'),
    [correction, setCorrection] = useState(false),
    [feedback, setFeedback] = useState(''),
    [confirmation, setConfirmation] = useState<'publish' | 'merge' | null>(null);
  const candidate = task.candidate;
  const [acceptedRevision, setAcceptedRevision] = useState<string | null>(null);
  const unverifiedChecks =
    candidate?.evidence.checks.filter((check) => check.status === 'unknown') ?? [];
  const validationFailed =
    !candidate?.evidence.checks.length ||
    candidate.evidence.checks.some((check) => !['passed', 'unknown'].includes(check.status));
  const revision = candidate ? candidate.id + ':' + candidate.digest : null;
  const acceptanceConfirmed = acceptedRevision !== null && acceptedRevision === revision;
  function closeConfirmation() {
    setConfirmation(null);
    setAcceptedRevision(null);
  }
  const canPublish = project.review || (project.contribute && task.assignee_id === userId);
  const publicationRetry =
    task.state === 'blocked' && task.publicationOperation?.state === 'blocked'
      ? task.publicationOperation.kind
      : null;
  const manager = ['owner', 'admin'].includes(project.workspace_role ?? '');
  const ownershipBusy = busy || !!task.agent || !!(task.run && !task.run.stopped_at);
  const locked = ['publishing', 'code_review', 'merging', 'completed'].includes(task.state);
  return (
    <Modal label={task.title} close={close} className="task-detail">
      <header className="detail-context">
        <span>
          <Icon name="globe" size={17} />
          {project.name}
          <Icon name="right" size={13} />
          Task
        </span>
        <IconButton name="close" label="Close task details" onClick={close} />
      </header>
      <div className="detail-title">
        <h2>{task.title}</h2>
        <div className="detail-meta">
          <Status
            state={
              task.state === 'todo' && task.board_status === 'ongoing' ? 'building' : task.state
            }
          />
          <span className={`priority-label priority-${task.priority.toLowerCase()}`}>
            <Icon name="flag" size={14} />
            {task.priority} priority
          </span>
          <span>
            {task.assignee_name ? (
              <Avatar name={task.assignee_name} size="small" />
            ) : (
              <Icon name="person" size={16} />
            )}
            <span>
              <span className="sr-only">Assignee: </span>
              {task.assignee_name ?? 'Unassigned'}
            </span>
          </span>
        </div>
      </div>
      <div className="task-ownership-controls">
        {manager ? (
          <Select
            label="Assignee"
            value={task.assignee_id ?? ''}
            disabled={!project.contribute || ownershipBusy || locked}
            options={[
              { value: '', label: 'Unassigned' },
              ...participants
                .filter((person) => person.contribute || person.id === task.assignee_id)
                .map((person) => ({ value: person.id, label: person.name })),
            ]}
            onChange={(assigneeId) =>
              void onCommand({
                action: 'assign',
                version: task.version,
                assigneeId: assigneeId || null,
              })
            }
          />
        ) : !task.assignee_id && project.contribute && task.board_status === 'todo' && !locked ? (
          <Button
            disabled={ownershipBusy}
            onClick={() =>
              void onCommand({ action: 'assign', version: task.version, assigneeId: userId })
            }
          >
            Assign to me
          </Button>
        ) : null}
        {task.board_status !== 'completed' && (
          <Select
            label="Move to"
            value={task.board_status}
            disabled={ownershipBusy || !project.contribute || !canMoveTask(task, userId, manager)}
            options={[
              { value: 'todo', label: 'Todo' },
              { value: 'ongoing', label: 'Ongoing' },
            ]}
            onChange={(status) =>
              void onCommand({
                action: 'move',
                version: task.version,
                status: status as 'todo' | 'ongoing',
              })
            }
          />
        )}
      </div>
      <nav className="detail-tabs" aria-label="Task information">
        {['overview', 'conversation', 'activity'].map((tab) => (
          <button key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>
      <div className="detail-scroll">
        {error && !correction && !confirmation && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {view === 'overview' && (
          <>
            <section className="detail-section">
              <h3>Description</h3>
              <div className="task-rich-text">
                <RichText>{task.outcome}</RichText>
              </div>
            </section>
            <section className="detail-section">
              <h3>Acceptance criteria</h3>
              <ul className="acceptance-list">
                {task.criteria.map((item, i) => (
                  <li key={i}>
                    <span className="acceptance-bullet" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
            {task.state === 'building' && (
              <div className="state-notice">
                <Icon name="clock" />
                <div>
                  <strong>Agent running</strong>
                  <p>The agent is working on this task. You can close this panel.</p>
                </div>
              </div>
            )}
            {task.state === 'blocked' && (
              <div className="state-notice notice-warning">
                <Icon name="attention" />
                <div>
                  <strong>This task needs attention</strong>
                  <p>Open Activity to view the error and next steps.</p>
                </div>
              </div>
            )}
            {candidate && (
              <>
                <section className="detail-section">
                  <div className="task-section-heading">
                    <h3>Changes</h3>
                    <div className="task-review-actions">
                      <Button icon="branch" onClick={() => setReviewOpen(true)}>
                        View diff
                      </Button>
                      {candidate.evidence.preview.available && (
                        <IconButton
                          name="external"
                          label="Open preview"
                          onClick={() => void onPreview()}
                        />
                      )}
                    </div>
                  </div>
                  <div className="task-rich-text">
                    <RichText>{candidate.manifest.summary}</RichText>
                  </div>
                  {candidate.evidence.checks.length > 0 && (
                    <details className="evidence-disclosure">
                      <summary>
                        <Icon name="complete" size={18} />
                        Checks{' '}
                        {candidate.manifest.fixture && (
                          <span className="fixture-inline">fixture</span>
                        )}
                        <Icon name="down" size={16} />
                      </summary>
                      <div>
                        {candidate.evidence.checks.map((check, i) => (
                          <div className="evidence-check" key={i}>
                            <Icon name={check.status === 'passed' ? 'check' : 'info'} size={16} />
                            <span>{check.name}</span>
                            <small>{check.status}</small>
                          </div>
                        ))}
                        {candidate.manifest.fixture && (
                          <p className="subtle">
                            Fixture results are simulated, not application tests.
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                  {candidate.manifest.limitations.length > 0 && (
                    <details className="evidence-disclosure">
                      <summary>
                        <Icon name="info" size={18} />
                        Known limitations
                        <Icon name="down" size={16} />
                      </summary>
                      <div>
                        {candidate.manifest.limitations.map((l, i) => (
                          <div key={i} className="task-rich-text">
                            <RichText>{l}</RichText>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </section>
              </>
            )}
            {task.state === 'code_review' && (
              <div className="state-notice">
                <Icon name="branch" />
                <div>
                  <strong>Published for code review</strong>
                  <p>
                    Fixture PR #{task.publication?.pr_number}. Merge needs separate authorisation.
                  </p>
                </div>
              </div>
            )}
            {task.state === 'completed' && (
              <div className="state-notice notice-success">
                <Icon name="complete" />
                <div>
                  <strong>Merge verified{candidate?.manifest.fixture ? ' · fixture' : ''}</strong>
                  <p>Production deployment is tracked separately.</p>
                </div>
              </div>
            )}
            {(task.run || candidate) && (
              <details className="technical-details">
                <summary>
                  <Icon name="branch" size={17} />
                  Execution details
                  <Icon name="down" size={16} />
                </summary>
                <div>
                  <p>
                    Execution: {task.run?.state ?? 'Not started'} · generation {task.generation}
                  </p>
                  {candidate && (
                    <>
                      <p>
                        Branch: <code>{candidate.manifest.branch}</code>
                      </p>
                      <p>
                        Head: <code>{candidate.manifest.headSha}</code>
                      </p>
                      <p>
                        Base: <code>{candidate.manifest.baseSha}</code>
                      </p>
                      <p>
                        Artifact: <code>{candidate.manifest.artifactDigest}</code>
                      </p>
                      {candidate.manifest.fixture && (
                        <p>Fixture runs contain no real diff or execution log.</p>
                      )}
                    </>
                  )}
                  {task.run && (
                    <p>
                      Skills:{' '}
                      {task.run.manifest.skills.map((s) => `${s.id}@${s.version}`).join(', ') ||
                        'None'}
                    </p>
                  )}
                </div>
              </details>
            )}
          </>
        )}
        {view === 'conversation' && (
          <TaskConversations projectId={project.id} taskId={task.id} onOpen={onOpenThread} />
        )}
        {view === 'activity' && (
          <section className="activity-section">
            <h3>Task activity</h3>
            {events.length ? (
              events.map((event) => (
                <div className="activity-item" key={event.id}>
                  <span className="activity-dot" />
                  <div>
                    <strong>{event.kind}</strong>
                    {event.detail?.message && <p>{event.detail.message}</p>}
                    <time>
                      {new Date(event.created_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </div>
              ))
            ) : (
              <p className="subtle">No activity yet.</p>
            )}
          </section>
        )}
      </div>
      {view === 'overview' && (
        <footer className="detail-footer">
          {task.state === 'blocked' &&
            !candidate &&
            task.run?.state === 'stopped' &&
            project.contribute &&
            (task.assignee_id === userId || manager) && (
              <Button
                busy={busy}
                onClick={() => void onCommand({ action: 'release', version: task.version })}
              >
                Return to Todo
              </Button>
            )}
          {publicationRetry && candidate ? (
            <>
              <span>{task.publicationOperation?.error ?? 'Publication needs attention.'}</span>
              <Button
                busy={busy}
                disabled={publicationRetry === 'merge' ? !project.merge : !canPublish}
                onClick={() => setConfirmation(publicationRetry === 'merge' ? 'merge' : 'publish')}
              >
                {publicationRetry === 'merge' ? 'Retry merge' : 'Retry publication'}
              </Button>
            </>
          ) : task.state === 'todo' ? (
            <>
              <Button
                variant="primary"
                icon="play"
                busy={busy}
                disabled={!project.contribute || task.assignee_id !== userId}
                onClick={() =>
                  void onCommand({
                    action: 'start',
                    version: task.version,
                    minutes: 10,
                    budgetCents: 0,
                  })
                }
              >
                Start agent
              </Button>
            </>
          ) : task.state === 'blocked' &&
            !candidate &&
            task.run?.state === 'stopped' &&
            task.assignee_id === userId ? (
            <Button
              busy={busy}
              onClick={() =>
                void onCommand({
                  action: 'changes',
                  version: task.version,
                  feedback: 'Retry this task with the current execution settings.',
                })
              }
            >
              Retry task
            </Button>
          ) : ['review', 'blocked'].includes(task.state) && candidate ? (
            <>
              {task.assignee_id === userId ? (
                <Button onClick={() => setCorrection(true)} busy={busy}>
                  Request changes
                </Button>
              ) : (
                <span>A project reviewer will review this.</span>
              )}
              <Button
                variant="primary"
                icon="external"
                disabled={!canPublish || task.state !== 'review'}
                busy={busy}
                onClick={() => setConfirmation('publish')}
              >
                Publish changes
              </Button>
            </>
          ) : task.state === 'code_review' ? (
            <>
              <span>A PR is still an ongoing task.</span>
              <Button
                variant="primary"
                icon="merge"
                disabled={!project.merge}
                busy={busy}
                onClick={() => setConfirmation('merge')}
              >
                Authorise merge
              </Button>
            </>
          ) : (
            <span>
              <Icon name="shield" size={15} />
              You control publication and merge.
            </span>
          )}
        </footer>
      )}
      {correction && (
        <Modal
          label="Request changes"
          close={() => setCorrection(false)}
          className="confirmation-modal"
        >
          <div className="modal-topline">
            <span className="modal-symbol">
              <Icon name="message" size={23} />
            </span>
            <IconButton
              name="close"
              label="Close correction"
              onClick={() => setCorrection(false)}
            />
          </div>
          <h2>Request changes</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await onCommand({ action: 'changes', version: task.version, feedback })) {
                setCorrection(false);
                setFeedback('');
              }
            }}
          >
            <label>
              Feedback
              <textarea
                autoFocus
                rows={4}
                required
                minLength={3}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Describe the correction you want to see…"
              />
            </label>
            <p className="subtle">The assigned agent will update this task with your feedback.</p>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <Button variant="primary" icon="up" busy={busy}>
              Request correction and resume
            </Button>
          </form>
        </Modal>
      )}
      {confirmation && candidate && (
        <Modal
          label={confirmation === 'publish' ? 'Confirm publication' : 'Confirm merge'}
          close={closeConfirmation}
          className="confirmation-modal"
        >
          <div className="modal-topline">
            <span className="modal-symbol">
              <Icon name="shield" size={23} />
            </span>
            <IconButton name="close" label="Close approval" onClick={closeConfirmation} />
          </div>
          <h2>{confirmation === 'publish' ? 'Ready for code review?' : 'Authorise this merge?'}</h2>
          <p>
            {confirmation === 'publish'
              ? 'Approve pushing this exact branch and opening one pull request. Repository workflows may run.'
              : 'This is a separate merge permission. Required checks must pass before the merge is verified.'}
          </p>
          <dl className="approval-facts">
            <dt>Repository</dt>
            <dd>{candidate.manifest.repository}</dd>
            <dt>Target</dt>
            <dd>{candidate.manifest.targetRef}</dd>
            <dt>Candidate</dt>
            <dd>
              <code>{candidate.digest.slice(0, 16)}</code>
            </dd>
            <dt>Permission expires</dt>
            <dd>30 minutes</dd>
          </dl>
          {confirmation === 'publish' && unverifiedChecks.length > 0 && (
            <section className="publication-acceptance" aria-label="Acceptance confirmation">
              <h3>Verify this change</h3>
              <ul>
                {unverifiedChecks.map((check, index) => (
                  <li key={index}>{check.name}</li>
                ))}
              </ul>
              <label>
                <input
                  type="checkbox"
                  checked={acceptanceConfirmed}
                  disabled={busy || validationFailed}
                  onChange={(event) => setAcceptedRevision(event.target.checked ? revision : null)}
                />
                I verified these criteria in this saved change.
              </label>
            </section>
          )}
          {validationFailed && (
            <p className="inline-error" role="alert">
              Resolve failed validation and prepare a new saved change before publication.
            </p>
          )}
          {candidate.manifest.fixture && (
            <p className="fixture-caption">
              <Icon name="info" size={15} />
              Fixture mode. No real GitHub operation.
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button onClick={closeConfirmation}>Go back</Button>
            <Button
              variant="primary"
              icon={confirmation === 'publish' ? 'external' : 'merge'}
              busy={busy}
              disabled={
                validationFailed ||
                (confirmation === 'publish' && unverifiedChecks.length > 0 && !acceptanceConfirmed)
              }
              onClick={async () => {
                if (
                  await onCommand({
                    action: confirmation,
                    version: task.version,
                    candidateId: candidate.id,
                    digest: candidate.digest,
                    ...(confirmation === 'publish' ? { acceptanceConfirmed } : {}),
                  })
                )
                  closeConfirmation();
              }}
            >
              {confirmation === 'publish' ? 'Approve publication' : 'Approve merge'}
            </Button>
          </div>
        </Modal>
      )}
      {reviewOpen && candidate && (
        <Modal
          label="Saved task changes"
          className="repository-review"
          close={() => setReviewOpen(false)}
        >
          <ReviewPanel
            projectId={project.id}
            initialSnapshot={candidate.id}
            close={() => setReviewOpen(false)}
          />
        </Modal>
      )}
    </Modal>
  );
}
