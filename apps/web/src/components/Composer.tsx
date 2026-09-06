import { useState, type FormEvent } from 'react';
import { Button, IconButton, Modal } from './ui';
import { Icon } from './Icon';
import { ThreadPanel } from './ThreadPanel';
import type { Comment, Project } from '../lib/types';
export function Composer({
  project,
  userId,
  comments,
}: {
  project: Project;
  userId: string;
  comments: Comment[];
}) {
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  function open(event: FormEvent) {
    event.preventDefault();
    setExpanded(true);
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
          <Button type="button" variant="ghost" icon="message" onClick={() => setExpanded(true)}>
            Threads
          </Button>
          <button
            className="composer-send"
            aria-label="Open agent conversations"
            disabled={!project.contribute}
          >
            <Icon name="up" size={21} />
          </button>
        </div>
      </form>
      {expanded && (
        <Modal
          label="Project conversations"
          close={() => setExpanded(false)}
          className="conversation-dialog threaded-dialog"
        >
          <header className="conversation-header">
            <span className="composer-mark">
              <Icon name="message" size={20} />
            </span>
            <div>
              <h2>Conversations</h2>
              <p>{project.name}</p>
            </div>
            <IconButton
              name="close"
              label="Close conversations"
              onClick={() => setExpanded(false)}
            />
          </header>
          <ThreadPanel project={project} userId={userId} legacy={comments} initialMessage={text} />
        </Modal>
      )}
    </div>
  );
}
