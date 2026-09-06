import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CodexLogo } from './CodexLogo';
import { Button } from './ui';
type Connection = {
  id: string;
  state: string;
  userCode: string | null;
  verificationUrl: string | null;
  expiresAt: string;
  plan: string | null;
  error: string | null;
};
type State = { available: boolean; connection: Connection | null };
export function CodexConnection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await api<State>(`/projects/${projectId}/codex`);
        if (disposed) return;
        setState(next);
        if (['queued', 'starting', 'awaiting'].includes(next.connection?.state ?? ''))
          timer = setTimeout(() => void load(), 1500);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [projectId, revision]);
  async function act(disconnect = false) {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      await api(
        `/projects/${projectId}/codex${disconnect ? `/${state!.connection!.id}/disconnect` : ''}`,
        {},
      );
      setRevision((value) => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const connection = state?.connection;
  const pending = ['queued', 'starting', 'awaiting'].includes(connection?.state ?? '');
  const linked = connection?.state === 'connected';
  return (
    <section className="codex-connection" aria-label="Your Codex account">
      <div className="connection-row">
        <CodexLogo />
        <div>
          <strong>Codex</strong>
          <span>
            {linked
              ? 'Your account is linked'
              : pending
                ? 'Waiting for your sign-in'
                : 'No AI account connected'}
          </span>
        </div>
        {(pending || linked) && (
          <Button variant="ghost" busy={busy} onClick={() => void act(true)}>
            {linked ? 'Disconnect' : 'Cancel'}
          </Button>
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {connection?.error && !error && (
        <p className="subtle" role="status">
          {connection.error}
        </p>
      )}
      {connection?.state === 'awaiting' &&
        connection.userCode &&
        connection.verificationUrl === 'https://auth.openai.com/codex/device' && (
          <div className="codex-login-code">
            <p>Enter this code in ChatGPT to link your account.</p>
            <div className="codex-code-row">
              <code>{connection.userCode}</code>
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(connection.userCode!);
                    setCopied(true);
                  } catch {
                    setError('Select the code and copy it manually.');
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy code'}
              </Button>
            </div>
            <a
              className="button button-primary"
              href={connection.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Continue in ChatGPT
            </a>
            <p className="subtle">This account is linked only for you in this project.</p>
          </div>
        )}
      {state?.available && !pending && !linked && (
        <Button onClick={() => void act()} busy={busy}>
          Connect your Codex account
        </Button>
      )}
      {linked && (
        <p className="subtle">Linked for this project. Cloud execution setup is still pending.</p>
      )}
      {state && !state.available && !linked && !pending && (
        <p className="subtle">Codex account connections are being configured.</p>
      )}
    </section>
  );
}
