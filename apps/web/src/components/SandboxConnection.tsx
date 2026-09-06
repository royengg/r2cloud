import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';
type Setup = {
  ready: boolean;
  profile: unknown;
  sandbox: { status: string };
  subscription: { status: string };
};
export function SandboxConnection({ projectId }: { projectId: string }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const result = await api<Setup>(`/projects/${projectId}/execution-setup`);
        if (!disposed) {
          setSetup(result);
          setError(false);
        }
      } catch {
        if (!disposed) setError(true);
      } finally {
        if (!disposed) timer = setTimeout(() => void load(), 5000);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [projectId]);
  const message = error
    ? 'Connection status unavailable'
    : !setup
      ? 'Checking execution readiness…'
      : setup.sandbox.status !== 'available'
        ? 'Task runner is not available yet'
        : !setup.profile
          ? 'Save repository execution settings'
          : setup.subscription.status !== 'connected'
            ? 'Connect Codex to start work'
            : setup.ready
              ? 'Ready for task runs'
              : 'Checking your Codex connection';
  return (
    <div className="connection-row">
      <Icon name="cloud" />
      <div>
        <strong>Vercel Sandbox</strong>
        <span role="status">{message}</span>
      </div>
    </div>
  );
}
