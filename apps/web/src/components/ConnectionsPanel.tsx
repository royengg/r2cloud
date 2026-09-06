import { CodexConnection } from './CodexConnection';
import { ExecutionSetup } from './ExecutionSetup';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button, IconButton, Modal } from './ui';
import { Select } from './Select';
import { Icon } from './Icon';
import type { DiscoveredRepository } from '@r2cloud/contracts/adapters';
type State = {
  repository: { full_name: string; target_ref: string } | null;
  manage: boolean;
  githubAvailable: boolean;
  installationURL: string | null;
  pending: {
    id: string;
    status: string;
    repositories: DiscoveredRepository[] | null;
    error: string | null;
    expires_at: string;
  } | null;
};
export function ConnectionsPanel({
  projectId,
  close,
  onConnected,
}: {
  projectId: string;
  close: () => void;
  onConnected: () => Promise<void>;
}) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(
      new URLSearchParams(location.search).has('connection_error')
        ? 'GitHub authorization could not be verified. Try connecting again.'
        : '',
    ),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState('');
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await api<State>(`/projects/${projectId}/connections`);
        if (disposed) return;
        setState(next);
        if (['queued', 'checking'].includes(next.pending?.status ?? ''))
          timer = setTimeout(() => void load(), 2000);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [projectId]);
  async function authorize() {
    setBusy(true);
    setError('');
    try {
      const { url } = await api<{ url: string }>(
        `/projects/${projectId}/repository-authorization`,
        {},
      );
      if (new URL(url).origin !== 'https://github.com')
        throw new Error('Unexpected connection destination.');
      location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function attach() {
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${projectId}/repository`, {
        connectionId: state!.pending!.id,
        repositoryId: Number(selected),
      });
      setState(await api(`/projects/${projectId}/connections`));
      await onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const finishClose = () => {
    history.replaceState(null, '', location.pathname);
    close();
  };
  return (
    <Modal label="Project connections" close={finishClose} className="connections-modal">
      <div className="modal-topline">
        <span className="modal-symbol">
          <Icon name="link" size={25} />
        </span>
        <IconButton name="close" label="Close connections" onClick={finishClose} />
      </div>
      <h2>Connect your project</h2>

      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!state && !error && <p role="status">Loading connections…</p>}
      {state && (
        <>
          <div className="connection-row">
            <Icon name="github" />
            <div>
              <strong>GitHub repository</strong>
              <span>{state.repository?.full_name ?? 'No repository connected'}</span>
            </div>
          </div>
          {!state.repository && state.manage && (
            <div className="connection-setup">
              {state.pending?.status === 'ready' &&
              new Date(state.pending.expires_at) > new Date() &&
              !!state.pending.repositories?.length ? (
                <form
                  className="auth-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void attach();
                  }}
                >
                  <Select
                    label="Repository"
                    required
                    value={selected}
                    onChange={setSelected}
                    placeholder="Choose a repository"
                    disabled={busy}
                    options={state.pending.repositories.map((repo) => ({
                      value: String(repo.id),
                      label: repo.fullName,
                    }))}
                  />
                  <Button variant="primary" busy={busy} disabled={!selected}>
                    Connect repository
                  </Button>
                </form>
              ) : (
                <>
                  {['queued', 'checking'].includes(state.pending?.status ?? '') ? (
                    <p role="status">Checking your GitHub repositories…</p>
                  ) : (
                    <>
                      {state.githubAvailable && (
                        <Button
                          variant="primary"
                          icon="github"
                          busy={busy}
                          onClick={() => void authorize()}
                        >
                          Choose GitHub repositories
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
              {state.installationURL && (
                <p className="subtle">
                  Missing a repository?{' '}
                  <a href={state.installationURL} target="_blank" rel="noopener noreferrer">
                    Manage the GitHub App installation
                  </a>
                  , then reconnect to refresh the list.
                </p>
              )}
            </div>
          )}
          {!state.repository && !state.manage && (
            <p className="subtle">Ask a workspace administrator to connect a repository.</p>
          )}
          <CodexConnection projectId={projectId} />
          {state.repository && <ExecutionSetup projectId={projectId} manage={state.manage} />}
        </>
      )}
    </Modal>
  );
}
