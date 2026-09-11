import { useState } from 'react';
import { RichText } from './RichText';
import type { AgentTimeline as Timeline, AgentRequest } from '@r2cloud/contracts/agent';
import { Button } from './ui';
import { CodexLogo } from './CodexLogo';
export function AgentTimeline({
  projectId,
  timeline,
  respond,
  disabled,
}: {
  projectId: string;
  timeline: Timeline;
  respond: (body: unknown) => Promise<void>;
  disabled: boolean;
}) {
  const labels: Record<string, string> = {
    project_context: 'Reading project context',
    list_tasks: 'Reading the board',
    read_task: 'Reading a task',
    read_repository: 'Reading repository files',
    create_task: 'Creating a task',
    start_task: 'Preparing implementation',
    ask_user: 'Asking a question',
    inspect_preview: 'Inspecting the preview',
    start_preview: 'Starting the preview',
  };
  return (
    <>
      {timeline.items
        .filter((item) => item.kind !== 'userMessage' || item.text)
        .map((item) => {
          if (item.kind === 'previewInspection')
            return (
              <details className="agent-activity" key={item.id}>
                <summary>Preview screenshot · {String(item.detail.path ?? '/')}</summary>
                <img
                  src={`/api/projects/${encodeURIComponent(projectId)}/preview-screenshots/${encodeURIComponent(item.id)}`}
                  alt={`Preview of ${String(item.detail.path ?? '/')}`}
                  loading="lazy"
                  style={{ maxWidth: '100%', height: 'auto', borderRadius: 12 }}
                />
                <pre>{item.text}</pre>
              </details>
            );
          if (['userMessage', 'agentMessage', 'error'].includes(item.kind))
            return (
              <article
                className={`agent-message ${item.kind === 'userMessage' ? 'agent-message-user' : 'agent-message-codex'} ${item.kind === 'error' ? 'inline-error' : ''}`}
                key={item.id}
              >
                <strong className="agent-message-author">
                  {item.kind !== 'userMessage' && <CodexLogo />}
                  {item.kind === 'userMessage' ? String(item.detail.authorName ?? 'You') : 'Codex'}
                </strong>
                {item.kind === 'userMessage' ? (
                  <p>{item.text}</p>
                ) : (
                  <RichText>{item.text}</RichText>
                )}
              </article>
            );
          return (
            <details className="agent-activity" key={item.id}>
              <summary>
                {item.kind === 'reasoning'
                  ? 'Thinking'
                  : item.kind === 'plan'
                    ? 'Plan'
                    : item.kind === 'evidence'
                      ? item.text
                      : item.kind === 'commandExecution'
                        ? 'Running a command'
                        : item.kind === 'fileChange'
                          ? 'Updating files'
                          : (labels[String(item.detail.tool)] ?? 'Tool activity')}
                {item.status === 'running' ? '…' : ''}
              </summary>
              {item.kind === 'plan' && Array.isArray(item.detail.plan) ? (
                <ol>
                  {(item.detail.plan as { step: string; status: string }[]).map((step, index) => (
                    <li key={index}>
                      {step.step} {step.status === 'completed' ? '✓' : ''}
                    </li>
                  ))}
                </ol>
              ) : item.kind === 'reasoning' ? (
                <RichText>{item.text}</RichText>
              ) : (
                <pre>{item.text || JSON.stringify(item.detail, null, 2)}</pre>
              )}
            </details>
          );
        })}
      {timeline.requests
        .filter((request) => !request.resolved && ['running', 'waiting'].includes(timeline.state))
        .map((request) => (
          <Request key={request.id} request={request} respond={respond} disabled={disabled} />
        ))}
    </>
  );
}
function Request({
  request,
  respond,
  disabled,
}: {
  request: AgentRequest;
  respond: (body: unknown) => Promise<void>;
  disabled: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const questions = (request.detail.questions ?? []) as {
    id: string;
    question: string;
    options?: { label: string; description: string }[];
  }[];
  return (
    <form
      className="agent-request"
      onSubmit={(event) => {
        event.preventDefault();
        void respond({
          action: 'respond',
          requestId: request.id,
          answers: Object.fromEntries(questions.map((q) => [q.id, [answers[q.id] ?? '']])),
        });
      }}
    >
      <strong>{request.prompt}</strong>
      {request.kind === 'question' ? (
        <>
          {questions.map((question) => (
            <fieldset key={question.id}>
              <legend>{question.question}</legend>
              {question.options?.map((option) => (
                <button
                  type="button"
                  key={option.label}
                  disabled={disabled}
                  aria-pressed={answers[question.id] === option.label}
                  onClick={() =>
                    setAnswers((current) => ({ ...current, [question.id]: option.label }))
                  }
                >
                  {option.label}
                </button>
              ))}
              <input
                required
                aria-label={question.question}
                maxLength={8000}
                value={answers[question.id] ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
              />
            </fieldset>
          ))}
          <Button type="submit" variant="primary" disabled={disabled}>
            Reply
          </Button>
        </>
      ) : (
        <>
          <p>{String(request.detail.summary ?? request.detail.outcome ?? '')}</p>
          <div className="thread-actions">
            <Button
              type="button"
              disabled={disabled}
              onClick={() =>
                void respond({ action: 'respond', requestId: request.id, approved: false })
              }
            >
              Decline
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={disabled}
              onClick={() =>
                void respond({ action: 'respond', requestId: request.id, approved: true })
              }
            >
              Approve
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
