import { useEffect, useState } from 'react';
import { executionProfile, type ExecutionProfile } from '@r2cloud/contracts/execution';
import { api } from '../lib/api';
import { Button } from './ui';
const template: ExecutionProfile = {
  directory: '.',
  install: { cmd: 'bun', args: ['install', '--frozen-lockfile'] },
  dev: { cmd: 'bun', args: ['run', 'dev', '--host', '0.0.0.0', '--port', '3000'] },
  tests: [{ cmd: 'bun', args: ['test'] }],
  port: 3000,
  healthPath: '/',
  maxMinutes: 10,
  maxBudgetCents: 0,
  vcpus: 2,
};
type Setup = { profile: { version: number; config: ExecutionProfile } | null };
export function ExecutionSetup({ projectId, manage }: { projectId: string; manage: boolean }) {
  const [profile, setProfile] = useState<ExecutionProfile>(template);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [advanced, setAdvanced] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    void api<Setup>(`/projects/${projectId}/execution-setup`)
      .then((next) => {
        if (disposed) return;
        const config = executionProfile.parse(next.profile?.config ?? template);
        setProfile(config);
        setVersion(next.profile?.version ?? 0);
        setAdvanced(
          JSON.stringify(
            { install: config.install, dev: config.dev, tests: config.tests },
            null,
            2,
          ),
        );
        setReady(true);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [projectId]);
  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let commands;
      try {
        commands = JSON.parse(advanced);
        if (!commands || typeof commands !== 'object' || Array.isArray(commands))
          throw new Error('Invalid commands');
      } catch {
        throw new Error('Use valid JSON for the install, dev and test commands.');
      }
      const parsed = executionProfile.safeParse({
        ...profile,
        maxBudgetCents: 0,
        vcpus: 2,
        install: commands.install,
        dev: commands.dev,
        tests: commands.tests,
      });
      if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'Check the execution settings.');
      const result = await api<{ version: number }>(`/projects/${projectId}/execution-setup`, {
        version,
        config: parsed.data,
      });
      setVersion(result.version);
      setProfile(parsed.data);
      setNotice('Settings saved. No sandbox was started.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="evidence-disclosure execution-setup">
      <summary>Repository execution settings</summary>
      <div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {ready && (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {!version && (
              <p className="subtle">
                Start from the Bun + Vite template. Check the commands for your repository before
                saving.
              </p>
            )}
            <fieldset disabled={!manage || busy}>
              <label>
                App directory
                <input
                  value={profile.directory}
                  onChange={(e) => setProfile({ ...profile, directory: e.target.value })}
                  required
                />
              </label>
              <label>
                Preview port
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={profile.port}
                  onChange={(e) => setProfile({ ...profile, port: Number(e.target.value) })}
                  required
                />
              </label>
              <label>
                Health check path
                <input
                  value={profile.healthPath}
                  onChange={(e) => setProfile({ ...profile, healthPath: e.target.value })}
                  required
                />
              </label>
              <label>
                Maximum run time (minutes)
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={profile.maxMinutes}
                  onChange={(e) => setProfile({ ...profile, maxMinutes: Number(e.target.value) })}
                  required
                />
              </label>
              <details>
                <summary>Install, development and test commands</summary>
                <label className="command-settings">
                  Executable and argument arrays
                  <textarea
                    rows={12}
                    value={advanced}
                    onChange={(e) => setAdvanced(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </details>
              {manage && <Button busy={busy}>Save execution settings</Button>}
            </fieldset>
            <p className="subtle">
              {profile.vcpus} vCPUs · Subscription usage only · No paid overage
            </p>
            {notice && <p role="status">{notice}</p>}
          </form>
        )}
      </div>
    </details>
  );
}
