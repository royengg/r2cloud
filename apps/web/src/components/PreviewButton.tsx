import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LivePreviewStatus } from '@r2cloud/contracts/preview';
import { api } from '../lib/api';
import { readQuery } from '../lib/queries';
import { refreshRead } from '../lib/realtime';
import { Button } from './ui';

export function PreviewButton({
  projectId,
  threadId,
  onError,
}: {
  projectId: string;
  threadId: string;
  onError(message: string): void;
}) {
  const path = `/projects/${projectId}/threads/${threadId}/preview`;
  const query = useQuery(readQuery<LivePreviewStatus>(path));
  const preview = query.data?.preview;
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!preview || !['ready', 'starting'].includes(preview.state)) return;
    const remaining = new Date(preview.expiresAt).getTime() - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => void refreshRead(path), remaining + 100);
    return () => clearTimeout(timer);
  }, [path, preview?.expiresAt, preview?.state]);
  if (!preview) return null;
  async function open() {
    if (preview?.state === 'failed') {
      onError(preview.error ?? 'The preview could not start.');
      return;
    }
    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      onError('Allow pop-ups to open the preview.');
      return;
    }
    popup.opener = null;
    popup.document.title = 'Opening preview';
    popup.document.body.textContent = 'Opening your preview…';
    setOpening(true);
    try {
      const { url } = await api<{ url: string }>(
        `/projects/${projectId}/previews/${preview!.id}/open`,
        {},
      );
      if (new URL(url).protocol !== 'https:') throw new Error('The preview address is invalid.');
      if (!popup.closed) popup.location.replace(url);
    } catch (error) {
      popup.close();
      onError((error as Error).message);
      void refreshRead(path);
    } finally {
      setOpening(false);
    }
  }
  const starting = preview.state === 'starting';
  return (
    <Button
      icon={preview.state === 'failed' ? 'attention' : 'globe'}
      busy={opening || starting}
      disabled={preview.state === 'stopped'}
      onClick={() => void open()}
      title="Open the running app in a separate tab"
    >
      {starting
        ? 'Starting preview'
        : preview.state === 'stopped'
          ? 'Preview ended'
          : preview.state === 'failed'
            ? 'Preview unavailable'
            : 'Open preview'}
    </Button>
  );
}
