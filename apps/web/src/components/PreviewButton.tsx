import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LivePreviewStatus } from '@r2cloud/contracts/preview';
import { api } from '../lib/api';
import { readQuery } from '../lib/queries';
import { refreshRead } from '../lib/realtime';
import { IconButton } from './ui';

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

  async function open() {
    if (preview?.state !== 'ready' || opening) return;
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
  const label = opening
    ? 'Opening preview'
    : query.isPending
      ? 'Loading preview'
      : !preview
        ? 'Ask Codex to start a preview'
        : preview.state === 'starting'
          ? 'Starting preview'
          : preview.state === 'stopped'
            ? 'Preview ended. Ask Codex to restart it.'
            : preview.state === 'failed'
              ? (preview.error ?? 'Preview unavailable')
              : 'Open preview in a separate tab';
  const disabled = opening || preview?.state !== 'ready';
  return (
    <span
      className="preview-button-hint"
      title={label}
      tabIndex={disabled ? 0 : undefined}
      aria-label={disabled ? label : undefined}
    >
      <IconButton
        name={opening || preview?.state === 'starting' ? 'loading' : 'globe'}
        label={label}
        disabled={disabled}
        onClick={() => void open()}
      />
    </span>
  );
}
