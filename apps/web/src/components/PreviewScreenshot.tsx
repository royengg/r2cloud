import { useState } from 'react';
import type { AgentItem } from '@r2cloud/contracts/agent';
import { IconButton, Modal } from './ui';

export function PreviewScreenshot({ projectId, item }: { projectId: string; item: AgentItem }) {
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const path = String(item.detail.path ?? '/');
  const src = `/api/projects/${encodeURIComponent(projectId)}/preview-screenshots/${encodeURIComponent(item.id)}`;
  const capturedAt =
    typeof item.detail.capturedAt === 'string' ? new Date(item.detail.capturedAt) : null;
  const caption = (
    <>
      <span>Preview · {path}</span>
      {capturedAt && !Number.isNaN(capturedAt.getTime()) && (
        <time dateTime={capturedAt.toISOString()} title={capturedAt.toLocaleString()}>
          {capturedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      )}
    </>
  );
  return (
    <figure className="preview-screenshot">
      {failed ? (
        <p className="subtle" role="status">
          Screenshot unavailable.
        </p>
      ) : (
        <button
          type="button"
          className="preview-screenshot-thumbnail"
          aria-label={`Enlarge screenshot of ${path}`}
          onClick={() => setExpanded(true)}
        >
          <img
            src={src}
            alt={`Preview of ${path}`}
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </button>
      )}
      <figcaption>{caption}</figcaption>
      {item.text && (
        <details className="agent-activity">
          <summary>Inspection details</summary>
          <pre>{item.text}</pre>
        </details>
      )}
      {expanded && (
        <Modal
          label={`Screenshot of ${path}`}
          close={() => setExpanded(false)}
          className="preview-screenshot-dialog"
        >
          <header>
            <div>{caption}</div>
            <IconButton name="close" label="Close screenshot" onClick={() => setExpanded(false)} />
          </header>
          {failed ? (
            <p className="subtle" role="status">
              Screenshot unavailable.
            </p>
          ) : (
            <img src={src} alt={`Preview of ${path}`} onError={() => setFailed(true)} />
          )}
        </Modal>
      )}
    </figure>
  );
}
