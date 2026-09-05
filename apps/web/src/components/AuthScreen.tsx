import { useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui';
import { Icon } from './Icon';
export function AuthScreen({ enabled = true }: { enabled?: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(
      new URLSearchParams(location.search).has('error')
        ? 'Sign-in could not be completed. Please try again.'
        : '',
    );
  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ url: string }>('/auth/sign-in/social', {
        provider: 'github',
        callbackURL: location.origin,
        disableRedirect: true,
      });
      const destination = new URL(result.url);
      if (destination.origin !== 'https://github.com')
        throw new Error('Unexpected sign-in destination.');
      location.assign(destination.href);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="sign-in-page">
      <section className="sign-in-card auth-card">
        <span className="brand sign-in-brand">
          <Icon name="cloud" size={26} />
          r2cloud.
        </span>
        <h1>A space for your next good idea.</h1>
        <p>Sign in to create a workspace or join your team.</p>
        <div className="auth-form">
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <Button
            variant="primary"
            icon="github"
            busy={busy}
            disabled={!enabled}
            onClick={() => void signIn()}
          >
            Continue with GitHub
          </Button>
        </div>
      </section>
    </main>
  );
}
export function WorkspaceSetup({
  busy,
  error,
  onCreate,
  onSignOut,
  onInvitations,
  invitationCount = 0,
}: {
  busy: boolean;
  error: string;
  onCreate: (input: unknown) => Promise<boolean>;
  onSignOut: () => void;
  onInvitations?: () => void;
  invitationCount?: number;
}) {
  const [name, setName] = useState(''),
    [projectName, setProjectName] = useState('');
  return (
    <main className="sign-in-page">
      <section className="sign-in-card auth-card">
        <span className="brand sign-in-brand">
          <Icon name="cloud" size={26} />
          r2cloud.
        </span>
        <h1>Make room for your project.</h1>
        <p>Create a workspace for your team. You’ll be its owner and first reviewer.</p>
        <form
          className="auth-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate({ name, projectName });
          }}
        >
          <label>
            Workspace name
            <input
              required
              minLength={3}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your team or company"
            />
          </label>
          <label>
            First project
            <input
              required
              minLength={3}
              maxLength={80}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="What are you building?"
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="primary" icon="add" busy={busy}>
            Create workspace
          </Button>
        </form>
        {invitationCount > 0 && (
          <Button variant="ghost" onClick={onInvitations}>
            View invitations ({invitationCount})
          </Button>
        )}
        <Button variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </section>
    </main>
  );
}
