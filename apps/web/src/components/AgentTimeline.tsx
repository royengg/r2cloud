import { useState, lazy, Suspense } from 'react';
import type { AgentTimeline as Timeline, AgentRequest } from '@r2cloud/contracts/agent';
import { Button } from './ui';
const Markdown = lazy(() => import('react-markdown'));
function RichText({ children }: { children: string }) {
  return (
    <Suspense fallback={<p>{children}</p>}>
      <Markdown
        skipHtml
        disallowedElements={['img']}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </Suspense>
  );
}

export function AgentTimeline({
  timeline,
  respond,
  disabled,
}: {
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
  };
  return (
    <>
      {timeline.items
        .filter((item) => item.kind !== 'userMessage' || item.text)
        .map((item) => {
          if (['userMessage', 'agentMessage', 'error'].includes(item.kind))
            return (
              <article
                className={`agent-message ${item.kind === 'error' ? 'inline-error' : ''}`}
                key={item.id}
              >
                <strong>
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
