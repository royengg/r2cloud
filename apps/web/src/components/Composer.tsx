import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import type { Project } from '../lib/types';
export function Composer({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (message: string) => void;
}) {
  const [text, setText] = useState('');
  function open(event: FormEvent) {
    event.preventDefault();
    onOpen(text);
  }
  return (
    <div className="composer-area">
      <form className="project-composer" onSubmit={open}>
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
          disabled={!project.contribute}
          maxLength={8000}
        />
        <div className="composer-actions">
          <button
            className="composer-send"
            aria-label="Open conversation"
            disabled={!project.contribute}
          >
            <Icon name="up" size={21} />
          </button>
        </div>
      </form>
    </div>
  );
}
