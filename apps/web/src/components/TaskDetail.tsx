import { ReviewPanel } from './ReviewPanel';
import { ThreadPanel } from './ThreadPanel';
import { useState } from 'react';
import type { Command } from '@r2cloud/contracts/domain';
import type { Task, Project, Comment, Activity } from '../lib/types';
import { Icon } from './Icon';
import { Avatar, Button, IconButton, Modal, Status } from './ui';
export function TaskDetail({
  task,
  project,
  userId,
  comments,
  events,
  busy,
  error,
  close,
  onCommand,
  onPreview,
}: {
  task: Task;
  project: Project;
  userId: string;
  comments: Comment[];
  events: Activity[];
  busy: boolean;
  error: string;
  close: () => void;
  onCommand: (input: Command) => Promise<boolean>;
  onPreview: () => Promise<void>;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [view, setView] = useState('overview'),
    [correction, setCorrection] = useState(false),
    [feedback, setFeedback] = useState(''),
    [confirmation, setConfirmation] = useState<'publish' | 'merge' | null>(null);
  const candidate = task.candidate;
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
        <Status state={task.state} />
        <h2>{task.title}</h2>
        <div className="detail-meta">
          <span className={`priority-label priority-${task.priority.toLowerCase()}`}>
            <Icon name="flag" size={14} />
            {task.priority} priority
          </span>
          <span>
            {task.owner_name ? (
              <Avatar name={task.owner_name} size="small" />
            ) : (
              <Icon name="person" size={16} />
            )}
            <span>
              <span className="sr-only">Assignee: </span>
              {task.owner_name ?? 'Unassigned'}
            </span>
          </span>
          {task.run && (
            <span>
              <Icon name="sparkles" size={15} />
              Codex{' '}
              {task.run.manifest.mode === 'fixture' && (
                <span className="fixture-inline">fixture</span>
              )}
            </span>
          )}
        </div>
      </div>
      <nav className="detail-tabs" aria-label="Task information">
        {['overview', 'conversation', 'activity'].map((tab) => (
          <button key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>
            {tab[0].toUpperCase() + tab.slice(1)}
            {tab === 'conversation' && comments.length > 0 && <span>{comments.length}</span>}
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
              <p>{task.outcome}</p>
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
            {task.state === 'todo' && (
              <section className="task-agent-summary" aria-label="Agent execution">
                <Icon name="play" size={20} />
                <div>
                  <h3>Agent execution</h3>
                  <p>
                    Start an agent to implement this task. Review its changes before publishing.
                  </p>
                </div>
              </section>
            )}
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
                <Button icon="branch" onClick={() => setReviewOpen(true)}>
                  Review saved changes
                </Button>
                <section className="candidate-preview">
                  <div className="preview-caption">
                    <div>
                      <h3>
                        {candidate.evidence.preview.available ? 'Preview' : 'Preview unavailable'}
                      </h3>
                      <span>
                        Saved revision{' '}
                        {candidate.manifest.fixture && (
                          <span className="fixture-inline">fixture</span>
                        )}
                      </span>
                    </div>
                    <Button
                      icon="external"
                      disabled={!candidate.evidence.preview.available}
                      onClick={() => void onPreview()}
                    >
                      Open preview
                    </Button>
                  </div>
                </section>
                <section className="detail-section">
                  <h3>Changes</h3>
                  <p>{candidate.manifest.summary}</p>
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
                  <details className="evidence-disclosure">
                    <summary>
                      <Icon name="info" size={18} />
                      Known limitations
                      <Icon name="down" size={16} />
                    </summary>
                    <div>
                      {candidate.manifest.limitations.map((l, i) => (
                        <p key={i}>{l}</p>
                      ))}
                    </div>
                  </details>
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
          </>
        )}
        {view === 'conversation' && (
          <ThreadPanel project={project} taskId={task.id} userId={userId} />
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
      <footer className="detail-footer">
        {task.state === 'blocked' &&
          !candidate &&
          task.run?.state === 'stopped' &&
          project.contribute &&
          (task.owner_id === userId || project.review) && (
            <Button
              busy={busy}
              onClick={() => void onCommand({ action: 'release', version: task.version })}
            >
              Return to Todo
            </Button>
          )}
        {task.state === 'todo' ? (
          <>
            <span>10-minute run · No paid overage</span>
            <Button
              variant="primary"
              icon="play"
              busy={busy}
              disabled={!project.contribute}
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
          task.owner_id === userId ? (
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
            {project.review || task.owner_id === userId ? (
              <Button onClick={() => setCorrection(true)} busy={busy}>
                Request changes
              </Button>
            ) : (
              <span>A project reviewer will review this.</span>
            )}
            <Button
              variant="primary"
              icon="external"
              disabled={!project.review || task.state !== 'review'}
              busy={busy}
              onClick={() => setConfirmation('publish')}
            >
              Publish changes for code review
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
          close={() => setConfirmation(null)}
          className="confirmation-modal"
        >
          <div className="modal-topline">
            <span className="modal-symbol">
              <Icon name="shield" size={23} />
            </span>
            <IconButton name="close" label="Close approval" onClick={() => setConfirmation(null)} />
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
            <Button onClick={() => setConfirmation(null)}>Go back</Button>
            <Button
              variant="primary"
              icon={confirmation === 'publish' ? 'external' : 'merge'}
              busy={busy}
              onClick={async () => {
                if (
                  await onCommand({
                    action: confirmation,
                    version: task.version,
                    candidateId: candidate.id,
                    digest: candidate.digest,
                  })
                )
                  setConfirmation(null);
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
