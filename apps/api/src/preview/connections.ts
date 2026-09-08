import { Sandbox } from '@vercel/sandbox';
import { PreviewTunnel } from '@r2cloud/adapters/preview-tunnel';
import type { PreviewGrant } from './gateway';

type Entry = {
  tunnel: Promise<PreviewTunnel>;
  active: number;
  lastUsed: number;
  expiresAt: number;
};
export function previewConnections(credentials: {
  token: string;
  teamId: string;
  projectId: string;
}) {
  const entries = new Map<string, Entry>();
  function remove(key: string, entry: Entry) {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    void entry.tunnel.then(
      (tunnel) => tunnel.close(),
      () => {},
    );
  }
  const timer = setInterval(() => {
    for (const [key, entry] of entries)
      if (entry.expiresAt <= Date.now() || (!entry.active && entry.lastUsed < Date.now() - 30000))
        remove(key, entry);
  }, 5000);
  timer.unref();
  return {
    async connect(grant: PreviewGrant) {
      const key = grant.runtimeId;
      let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= 64) throw new Error('Preview capacity reached.');
        entry = {
          active: 0,
          lastUsed: Date.now(),
          expiresAt: grant.expiresAt,
          tunnel: (async () => {
            const sandbox = await Sandbox.get({
              ...credentials,
              name: grant.sandboxName,
              resume: false,
              signal: AbortSignal.timeout(15000),
            });
            if (
              sandbox.status !== 'running' ||
              sandbox.tags?.r2config !== grant.configHash ||
              sandbox.tags?.r2run !== grant.runtimeId
            )
              throw new Error('Preview sandbox identity changed.');
            return new PreviewTunnel(sandbox.currentSession(), grant.port);
          })(),
        };
        entries.set(key, entry);
      }
      entry.expiresAt = Math.max(entry.expiresAt, grant.expiresAt);
      entry.active++;
      entry.lastUsed = Date.now();
      try {
        const stream = await (await entry.tunnel).open();
        stream.once('close', () => {
          entry!.active--;
          entry!.lastUsed = Date.now();
        });
        return stream;
      } catch (error) {
        entry.active--;
        remove(key, entry);
        throw error;
      }
    },
    close() {
      clearInterval(timer);
      for (const [key, entry] of entries) remove(key, entry);
    },
  };
}
