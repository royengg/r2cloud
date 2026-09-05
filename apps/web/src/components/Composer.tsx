import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, Button, IconButton, Modal } from './ui';
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
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded) latest.current?.scrollIntoView({ block: 'nearest' });
  }, [expanded, comments.length]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setError('');
    if (await onSend(text)) {
      setText('');
      setExpanded(true);
    } else {
      setError('Your message could not be sent. Please try again.');
    }
  }
  return (
    <div className="composer-area">
      <form className="project-composer" onSubmit={submit}>
        <div className="composer-context">
          <span className="composer-mark">
            <Icon name="message" size={20} />
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
          maxLength={8000}
          required
        />
        {error && !expanded && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
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
        <Button variant="ghost" icon="message" onClick={() => setExpanded(true)}>
          Open conversation · {comments.length}
        </Button>
      )}
      {expanded && (
        <Modal
          label="Project conversation"
          close={() => setExpanded(false)}
          className="conversation-dialog"
        >
          <header className="conversation-header">
            <span className="composer-mark">
              <Icon name="message" size={20} />
            </span>
            <div>
              <h2>Project conversation</h2>
              <p>{projectName}</p>
            </div>
            <IconButton
              name="close"
              label="Close conversation"
              onClick={() => setExpanded(false)}
            />
          </header>
          <div className="conversation-messages" role="log" aria-label="Messages">
            {comments.map((comment) => (
              <article className="conversation-message" key={comment.id}>
                <Avatar name={comment.name} size="small" />
                <div>
                  <strong>{comment.name}</strong>
                  <p>{comment.body}</p>
                </div>
              </article>
            ))}
            <div ref={latest} />
          </div>
          <form className="conversation-reply" onSubmit={submit}>
            <label htmlFor="conversation-reply" className="sr-only">
              Message to {projectName}
            </label>
            <textarea
              id="conversation-reply"
              autoFocus
              rows={2}
              maxLength={8000}
              required
              placeholder="Keep the conversation going…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!canComment}
            />
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="composer-actions">
              <span className="composer-hint">
                <Icon name="people" size={15} />
                Shared with your project
              </span>
              <button
                className="composer-send"
                aria-label="Send message"
                disabled={busy || !canComment || !text.trim()}
              >
                <Icon name={busy ? 'loading' : 'up'} size={21} />
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
