import { useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { refreshRead } from '../lib/realtime';
import { Icon } from './Icon';
import type { Project } from '../lib/types';
export function Composer({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (threadId: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !text.trim() || !project.contribute) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const path = `/projects/${project.id}/threads`;
    try {
      const thread = await api<{ id: string }>(path, {
        action: 'create',
        title: text.trim().replace(/\s+/g, ' ').slice(0, 80),
        model: null,
        instructions: '',
        taskId: null,
        body: text.trim(),
      });
      onOpen(thread.id);
      void refreshRead(path);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="composer-area">
      <form className="project-composer" onSubmit={send}>
        <div className="composer-context">
          <span className="composer-mark">
            <Icon name="message" size={20} />
          </span>
          <label htmlFor="project-message">A thought, a question, a next step.</label>
          <span className="composer-scope">
            <Icon name="globe" size={14} />
            Project<span className="scope-separator">/</span>
            {project.name}
          </span>
        </div>
        <textarea
          id="project-message"
          rows={2}
          placeholder="What would you like to work on?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy || !project.contribute}
          maxLength={8000}
        />
        <div className="composer-actions">
          <button
            className="composer-send"
            type="submit"
            aria-label="Send message"
            aria-busy={busy}
            disabled={busy || !project.contribute || !text.trim()}
          >
            <Icon name={busy ? 'loading' : 'up'} size={21} />
          </button>
        </div>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
