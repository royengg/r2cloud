import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import type { Comment } from '../lib/types';
export function Composer({
  projectName,
  busy,
  canComment,
  comments,
  onSend,
}: {
  projectName: string;
  busy: boolean;
  canComment: boolean;
  comments: Comment[];
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    if (await onSend(text)) setText('');
  }
  return (
    <div className="composer-area">
      <form className="project-composer" onSubmit={submit}>
        <div className="composer-context">
          <span className="composer-mark">
            <Icon name="sparkles" size={20} />
          </span>
          <label htmlFor="project-message">A thought, a question, a next step.</label>
          <span className="composer-scope">
            <Icon name="globe" size={14} />
            Project<span className="scope-separator">/</span>
            {projectName}
          </span>
        </div>
        <textarea
          id="project-message"
          rows={2}
          placeholder="What would you like to work on?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canComment}
          required
        />
        <div className="composer-actions">
          <span className="composer-hint">
            <Icon name="people" size={15} />
            Shared project feedback
          </span>
          <button
            className="composer-send"
            aria-label="Send project feedback"
            disabled={busy || !canComment}
          >
            <Icon name={busy ? 'loading' : 'up'} size={21} />
          </button>
        </div>
      </form>
      {comments.length > 0 && (
        <details className="project-conversation">
          <summary>
            <Icon name="message" size={16} />
            Project conversation <span>{comments.length}</span>
            <Icon name="down" size={14} />
          </summary>
          <div>
            {comments.slice(-5).map((c) => (
              <article key={c.id}>
                <strong>{c.name}</strong>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </details>
      )}
      <div className="composer-footnote">
        <Icon name="shield" size={13} />
        You choose when work starts and what gets published.
      </div>
    </div>
  );
}
