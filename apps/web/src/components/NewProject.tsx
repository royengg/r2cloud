import { useState } from 'react';
import { Button, IconButton, Modal } from './ui';
import { Icon } from './Icon';
export function NewProject({
  workspace,
  busy,
  error,
  close,
  save,
}: {
  workspace: string;
  busy: boolean;
  error: string;
  close: () => void;
  save: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  return (
    <Modal label="New project" close={close}>
      <div className="modal-topline">
        <span className="modal-symbol">
          <Icon name="folder" size={25} />
        </span>
        <IconButton name="close" label="Close new project" onClick={close} />
      </div>
      <h2>A home for your next idea.</h2>
      <p className="modal-description">Create a project in {workspace}.</p>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(name);
        }}
      >
        <label>
          Project name
          <input
            autoFocus
            required
            minLength={3}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What are you building?"
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" busy={busy} icon="add">
          Create project
        </Button>
      </form>
    </Modal>
  );
}
