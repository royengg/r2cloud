import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, readQuery, clearProjectQueries } from './queries';
import { projectRealtime } from './realtime';
import { api } from './api';
import type { Identity, Snapshot } from './types';
export function useWorkspace() {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [projectId, setProjectId] = useState(''),
    [blockedProject, setBlockedProject] = useState(''),
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
  const board = useQuery({
    ...readQuery<Snapshot>(`/projects/${projectId}/snapshot`),
    enabled: Boolean(identity && projectId && blockedProject !== projectId),
  });
  const snapshot = identity && blockedProject !== projectId ? (board.data ?? null) : null;
  const serial = useRef(0);
  const refresh = useRef<{ generation: number; pending: boolean; promise: Promise<void> } | null>(
    null,
  );
  const reload = useCallback((): Promise<void> => {
    if (!projectId || blockedProject === projectId) return Promise.resolve();
    const generation = serial.current;
    const active = refresh.current;
    if (active?.generation === generation) {
      active.pending = true;
      return active.promise;
    }
    const batch = { generation, pending: false, promise: Promise.resolve() };
    refresh.current = batch;
    batch.promise = (async () => {
      do {
        batch.pending = false;
        try {
          await queryClient.fetchQuery({
            ...readQuery<Snapshot>(`/projects/${projectId}/snapshot`),
            staleTime: 0,
          });
        } catch (e) {
          if (generation === serial.current) setError((e as Error).message);
        }
      } while (batch.pending && generation === serial.current);
      if (refresh.current === batch) refresh.current = null;
    })();
    return batch.promise;
  }, [projectId, blockedProject]);
  async function loadIdentity(preferredProject?: string) {
    const next = await queryClient.fetchQuery({ ...readQuery<Identity>('/me'), staleTime: 0 });
    setBlockedProject('');
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
      queryClient
        .fetchQuery(
          readQuery<{ mode: string; provider: string | null; enabled: boolean }>('/auth-config'),
        )
        .then(setAuthConfig),
      loadIdentity().catch(() => {}),
    ])
      .catch((e) => setError((e as Error).message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!identity || !projectId || blockedProject === projectId) return;

    const disconnect = projectRealtime(projectId, setConnection, () => {
      serial.current++;
      clearProjectQueries(projectId);
      setBlockedProject(projectId);
      setError('Project access ended. Sign in again.');
      setConnection('Access ended');
    });
    return () => {
      disconnect();
      serial.current++;
    };
  }, [identity, projectId, blockedProject, reload]);
  useEffect(() => {
    const endSession = () => {
      serial.current++;
      queryClient.clear();
      setIdentity(null);
      setProjectId('');
    };
    const endProject = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      clearProjectQueries(id);
      if (id === projectId) {
        serial.current++;
        setBlockedProject(id);
        setError('Project access ended. Sign in again.');
      }
    };
    window.addEventListener('session-ended', endSession);
    window.addEventListener('project-access-ended', endProject);
    return () => {
      window.removeEventListener('session-ended', endSession);
      window.removeEventListener('project-access-ended', endProject);
    };
  }, [projectId]);
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
      serial.current++;
      queryClient.clear();
      setIdentity(null);
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
    error: error || board.error?.message || '',
    setError,
    busy,
    announcement,
    act,
    signOut,
  };
}
