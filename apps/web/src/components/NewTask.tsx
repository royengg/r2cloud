import { useState, type FormEvent } from 'react';
import { Button, IconButton, Modal } from './ui';
import { Select } from './Select';
import { Icon } from './Icon';
export function NewTask({
  busy,
  error,
  close,
  save,
}: {
  busy: boolean;
  error: string;
  close: () => void;
  save: (input: unknown) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(''),
    [outcome, setOutcome] = useState(''),
    [criteria, setCriteria] = useState(''),
    [priority, setPriority] = useState('Medium');
  async function submit(event: FormEvent) {
    event.preventDefault();
    await save({
      title,
      outcome,
      criteria: criteria
        .split('\n')
        .map((c) => c.trim())
        .filter(Boolean),
      priority,
    });
  }
  return (
    <Modal label="Create a task" close={close} className="task-form-modal">
      <div className="modal-topline">
        <span className="modal-symbol">
          <Icon name="add" size={24} />
        </span>
        <IconButton name="close" label="Close new task" onClick={close} />
      </div>
      <h2>A new possibility.</h2>
      <p className="modal-description">Start with the outcome you have in mind.</p>
      <form onSubmit={submit}>
        <label>
          Task title
          <input
            autoFocus
            name="title"
            required
            minLength={3}
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Make the first visit feel effortless"
          />
        </label>
        <label>
          Intended outcome
          <textarea
            name="outcome"
            required
            minLength={3}
            maxLength={8000}
            rows={2}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Who is this for? What should be better?"
          />
        </label>
        <label>
          Acceptance criteria <span className="label-note">One per line</span>
          <textarea
            name="criteria"
            required
            rows={3}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder={'One clear next step\nWorks on a phone'}
          />
        </label>
        <Select
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={['High', 'Medium', 'Low'].map((value) => ({ value, label: value }))}
        />
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-actions">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon="add" busy={busy}>
            Create task
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
