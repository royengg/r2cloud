import { useState, type FormEvent } from 'react';
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
  onFeedback,
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
  onFeedback: (body: string) => Promise<boolean>;
}) {
  const [view, setView] = useState('overview'),
    [correction, setCorrection] = useState(false),
    [feedback, setFeedback] = useState(''),
    [confirmation, setConfirmation] = useState<'publish' | 'merge' | null>(null);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!feedback.trim()) return;
    if (await onFeedback(feedback)) setFeedback('');
  }
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
            <Avatar name={task.owner_name ?? 'Unassigned'} size="small" />
            {task.owner_name ?? 'Unassigned'}
          </span>
          {task.run && (
            <span>
              <Icon name="sparkles" size={15} />
              Codex <span className="fixture-inline">fixture</span>
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
              <h3>The outcome</h3>
              <p>{task.outcome}</p>
            </section>
            <section className="detail-section">
              <h3>What success looks like</h3>
              <ul className="acceptance-list">
                {task.criteria.map((item, i) => (
                  <li key={i}>
                    <span
                      className={
                        candidate?.evidence.checks[i]?.status === 'passed'
                          ? 'acceptance-checked'
                          : ''
                      }
                    >
                      <Icon
                        name={
                          candidate?.evidence.checks[i]?.status === 'passed' ? 'check' : 'complete'
                        }
                        size={17}
                      />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>
            {task.state === 'todo' && (
              <div className="start-illustration">
                <div className="start-orb">
                  <Icon name="sparkles" size={30} />
                </div>
                <h3>Ready for a first pass?</h3>
                <p>One owner. A working preview. Your review.</p>
                <small>One run · 15 minutes · $3 model budget cap</small>
              </div>
            )}
            {task.state === 'building' && (
              <div className="state-notice">
                <Icon name="clock" />
                <div>
                  <strong>Working toward your outcome</strong>
                  <p>You can leave this window. Ownership stays reserved.</p>
                </div>
              </div>
            )}
            {task.state === 'blocked' && (
              <div className="state-notice notice-warning">
                <Icon name="attention" />
                <div>
                  <strong>This task needs attention</strong>
                  <p>
                    Ownership is reserved while the outcome is checked. Open Activity for the
                    reason.
                  </p>
                </div>
              </div>
            )}
            {candidate && (
              <>
                <section className="candidate-preview">
                  <div className="preview-illustration" aria-hidden="true">
                    <div className="mini-browser">
                      <div className="mini-browser-bar">
                        <i />
                        <i />
                        <i />
                        <span />
                      </div>
                      <div className="mini-browser-content">
                        <span className="mini-browser-shape" />
                        <div>
                          <i />
                          <i />
                          <b />
                        </div>
                      </div>
                      <div className="mini-browser-tiles">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                    <span className="preview-decoration decoration-one" />
                    <span className="preview-decoration decoration-two" />
                  </div>
                  <div className="preview-caption">
                    <div>
                      <h3>See it for yourself</h3>
                      <span>
                        Private candidate preview <span className="fixture-inline">fixture</span>
                      </span>
                    </div>
                    <Button icon="external" onClick={() => void onPreview()}>
                      Try the preview
                    </Button>
                  </div>
                </section>
                <section className="detail-section">
                  <h3>What changed</h3>
                  <p>{candidate.manifest.summary}</p>
                  <details className="evidence-disclosure">
                    <summary>
                      <Icon name="complete" size={18} />
                      Acceptance evidence <span className="fixture-inline">fixture</span>
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
                      <p className="subtle">
                        Fixture results are simulated, not application tests.
                      </p>
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
                  <strong>Merge verified · fixture</strong>
                  <p>Production deployment is tracked separately.</p>
                </div>
              </div>
            )}
            <details className="technical-details">
              <summary>
                <Icon name="branch" size={17} />
                Advanced details
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
                    <p>Fixture runs contain no real diff or execution log.</p>
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
          <section className="conversation-section">
            <h3>Conversation & feedback</h3>
            {comments.length ? (
              comments.map((comment) => (
                <article className="comment" key={comment.id}>
                  <Avatar name={comment.name} size="small" />
                  <div>
                    <strong>{comment.name}</strong>
                    <p>{comment.body}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="conversation-empty">
                <Icon name="message" size={28} />
                <p>Add a little context for the task owner.</p>
              </div>
            )}
            <form className="feedback-form" onSubmit={send}>
              <label htmlFor="task-feedback">Task feedback</label>
              <textarea
                id="task-feedback"
                rows={3}
                required
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Share a thought or clarify the outcome…"
                disabled={!project.contribute}
              />
              <Button icon="up" busy={busy} disabled={!project.contribute}>
                Send feedback
              </Button>
            </form>
          </section>
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
              <p className="subtle">The next step is yours.</p>
            )}
          </section>
        )}
      </div>
      <footer className="detail-footer">
        {task.state === 'todo' ? (
          <>
            <span>Review before anything is published.</span>
            <Button
              variant="primary"
              icon="play"
              busy={busy}
              disabled={!project.contribute}
              onClick={() =>
                void onCommand({
                  action: 'start',
                  version: task.version,
                  minutes: 15,
                  budgetCents: 300,
                })
              }
            >
              Start work
            </Button>
          </>
        ) : task.state === 'review' ? (
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
              disabled={!project.review}
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
          <h2>A little closer to your outcome.</h2>
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
              What should be different?
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
            <p className="subtle">Another bounded run starts with the existing owner.</p>
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
          <p className="fixture-caption">
            <Icon name="info" size={15} />
            Fixture mode. No real GitHub operation.
          </p>
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
    </Modal>
  );
}
