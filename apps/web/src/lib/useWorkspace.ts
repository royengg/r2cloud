import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from './api';
import type { Identity, Snapshot } from './types';
export function useWorkspace() {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [projectId, setProjectId] = useState(''),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [ready, setReady] = useState(false),
    [authConfig, setAuthConfig] = useState<{
      mode: string;
      provider: string | null;
      enabled: boolean;
    } | null>(null),
    [connection, setConnection] = useState('Connecting'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [announcement, setAnnouncement] = useState('');
  const serial = useRef(0);
  const reload = useCallback(async () => {
    if (!projectId) return;
    const current = ++serial.current;
    try {
      const next = await api<Snapshot>(`/projects/${projectId}/snapshot`);
      if (current === serial.current) setSnapshot(next);
    } catch (e) {
      if (current === serial.current) setError((e as Error).message);
    }
  }, [projectId]);
  async function loadIdentity(preferredProject?: string) {
    const next = await api<Identity>('/me');
    setIdentity(next);
    setProjectId(
      next.projects.find(
        (p) => p.id === (preferredProject ?? new URLSearchParams(location.search).get('project')),
      )?.id ??
        next.projects[0]?.id ??
        '',
    );
  }
  useEffect(() => {
    void Promise.all([
      api<{ mode: string; provider: string | null; enabled: boolean }>('/auth-config').then(
        setAuthConfig,
      ),
      loadIdentity().catch(() => {}),
    ])
      .catch((e) => setError((e as Error).message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!identity || !projectId) return;
    setSnapshot(null);
    void reload();
    const socket = io({ auth: { projectId }, withCredentials: true, transports: ['websocket'] });
    socket.on('connect', () => {
      setConnection('Live');
      void reload();
    });
    socket.on('snapshot-required', () => void reload());
    socket.on('disconnect', () => setConnection('Reconnecting'));
    socket.on('connect_error', () => setConnection('Offline'));
    socket.on('access-ended', () => {
      setSnapshot(null);
      setError('Project access ended. Sign in again.');
      setConnection('Access ended');
    });
    return () => {
      socket.disconnect();
      serial.current++;
    };
  }, [identity, projectId, reload]);
  async function act(work: () => Promise<unknown>, message = 'Saved') {
    setBusy(true);
    setError('');
    try {
      await work();
      await reload();
      setAnnouncement(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await api('/logout', {});
      setIdentity(null);
      setSnapshot(null);
      setProjectId('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return {
    identity,
    authConfig,
    loadIdentity,
    projectId,
    setProjectId,
    snapshot,
    ready,
    connection,
    error,
    setError,
    busy,
    announcement,
    act,
    signOut,
  };
}
