import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReviewSnapshot, ReviewIndex, ReviewDiff } from '@r2cloud/contracts/review';
import { readQuery } from '../lib/queries';
import { diffLines } from '../lib/diff';
import { Button, IconButton, Modal } from './ui';
import { Select } from './Select';
import { Icon } from './Icon';

export function ReviewPanel({
  projectId,
  threadId,
  close,
  onFeedback,
  initialSnapshot,
}: {
  projectId: string;
  initialSnapshot?: string;
  threadId?: string;
  close: () => void;
  onFeedback?: (text: string) => void;
}) {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1050px)').matches);
  useEffect(() => {
    const media = matchMedia('(max-width: 1050px)');
    const change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const [snapshotId, setSnapshotId] = useState(initialSnapshot ?? '');
  const [file, setFile] = useState('');
  const [commit, setCommit] = useState('');
  const [tab, setTab] = useState('changes');
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<{ line: number; side: string; text: string } | null>(
    null,
  );
  const params = new URLSearchParams(threadId ? { thread: threadId } : {});
  const endpoint = `/projects/${projectId}/review?`;
  const list = useQuery(readQuery<{ snapshots: ReviewSnapshot[] }>(endpoint + params));
  const snapshots = list.data?.snapshots ?? [];
  const snapshot = snapshots.find((value) => value.id === snapshotId) ?? snapshots[0];
  useEffect(() => {
    if (!snapshotId && snapshot) setSnapshotId(snapshot.id);
  }, [snapshotId, snapshot?.id]);
  params.set('snapshot', snapshot?.id ?? '');
  if (commit) params.set('commit', commit);
  const index = useQuery({
    ...readQuery<ReviewIndex>(endpoint + params),
    enabled: !!snapshot && !snapshot.fixture,
    staleTime: Infinity,
  });
  const selectedFile =
    index.data?.files.find((value) => value.path === file) ?? index.data?.files[0];
  const fileParams = new URLSearchParams(params);
  fileParams.set('file', selectedFile?.path ?? '');
  const diff = useQuery({
    ...readQuery<ReviewDiff>(endpoint + fileParams),
    enabled: !!selectedFile && tab === 'changes',
    staleTime: Infinity,
  });
  useEffect(() => setSelection(null), [snapshot?.id, commit, selectedFile?.path]);
  const lines = diffLines(diff.data?.patch ?? '');
  const failure = list.error ?? index.error ?? diff.error;
  function chooseSnapshot(value: string) {
    setSnapshotId(value);
    setCommit('');
    setFile('');
    setSelection(null);
  }
  const panel = (
    <aside className="review-panel" aria-label="Code review">
      <header className="review-heading">
        <div>
          <Icon name="branch" />
          <strong>{threadId ? 'Review changes' : 'Repository changes'}</strong>
        </div>
        <div>
          {threadId && !narrow && (
            <IconButton
              name="external"
              label={expanded ? 'Reduce review panel' : 'Expand review panel'}
              aria-pressed={expanded}
              onClick={() => setExpanded(!expanded)}
            />
          )}
          <IconButton name="close" label="Close review" onClick={close} />
        </div>
      </header>
      <nav className="review-tabs" aria-label="Review views">
        {[
          ['changes', 'Changes'],
          ['commits', 'Commits'],
          ['pr', 'Pull request'],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value!);
              setSelection(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {snapshots.length > 0 && (
        <div className="review-summary">
          <Select
            label="Saved change"
            value={snapshot!.id}
            options={snapshots.map((value) => ({
              value: value.id,
              label: `${value.title} · ${value.headSha.slice(0, 7)}`,
            }))}
            onChange={chooseSnapshot}
          />
          <p>
            <span>{snapshot!.branch}</span>
            <Icon name="right" size={14} />
            <span>{snapshot!.targetRef}</span>
          </p>
          <small>
            Saved {new Date(snapshot!.createdAt).toLocaleString()} · {snapshot!.headSha.slice(0, 7)}
          </small>
        </div>
      )}
      {failure && (
        <div className="review-notice" role="alert">
          <p>{failure.message}</p>
          <Button
            onClick={() => {
              void list.refetch();
              void index.refetch();
              if (selectedFile) void diff.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {list.isPending ? (
        <p className="review-notice" role="status">
          Loading saved changes…
        </p>
      ) : !snapshot ? (
        <div className="review-empty">
          <Icon name="branch" size={28} />
          <strong>No saved changes yet</strong>
          <p>
            Changes appear here after the agent saves a task revision. Opening this view does not
            start an agent.
          </p>
        </div>
      ) : snapshot.fixture ? (
        <p className="review-notice">
          This is a fixture change. It has no real Git diff or pull request.
        </p>
      ) : (
        <>
          {tab === 'changes' && (
            <>
              {commit && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCommit('');
                    setFile('');
                    setSelection(null);
                  }}
                >
                  ← All changes · viewing {commit.slice(0, 7)}
                </Button>
              )}
              {index.isPending ? (
                <p className="review-notice" role="status">
                  Preparing saved diff…
                </p>
              ) : (
                <div className="review-files" aria-label="Changed files">
                  {index.data?.files.map((value) => (
                    <button
                      key={value.path}
                      title={value.path}
                      aria-pressed={selectedFile?.path === value.path}
                      onClick={() => {
                        setFile(value.path);
                        setSelection(null);
                      }}
                    >
                      <span>{value.path}</span>
                      <span className="review-counts">
                        <span className="review-added">
                          {value.added === null ? 'Binary' : `+${value.added}`}
                        </span>
                        <span className="review-removed">
                          {value.removed === null ? '' : `−${value.removed}`}
                        </span>
                      </span>
                    </button>
                  ))}
                  {index.data?.files.length === 0 && (
                    <p className="review-notice">No file changes in this revision.</p>
                  )}
                </div>
              )}
              {selectedFile && (
                <div className="review-diff" key={`${snapshot.id}:${commit}:${selectedFile.path}`}>
                  <div className="review-file-heading">
                    <strong title={selectedFile.path}>{selectedFile.path}</strong>
                    <small>Unified diff</small>
                  </div>
                  {diff.isPending ? (
                    <p className="review-notice" role="status">
                      Loading file…
                    </p>
                  ) : diff.data?.unavailable ? (
                    <p className="review-notice">{diff.data.unavailable}</p>
                  ) : (
                    <div
                      className="review-code"
                      tabIndex={0}
                      aria-label={`Diff for ${selectedFile.path}`}
                    >
                      {lines.map((line, i) => (
                        <div className={`review-line review-line-${line.kind}`} key={i}>
                          <button
                            className="review-line-number"
                            disabled={!onFeedback || line.kind === 'hunk'}
                            title="Select line for feedback"
                            aria-label={`Select ${line.next === undefined ? 'old' : 'new'} line ${line.next ?? line.old ?? ''}`}
                            onClick={() =>
                              setSelection({
                                line: line.next ?? line.old!,
                                side: line.next === undefined ? 'old' : 'new',
                                text: line.text,
                              })
                            }
                          >
                            {line.old ?? ''}
                            <span>{line.next ?? ''}</span>
                          </button>
                          <code>
                            <span aria-hidden="true">
                              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                            </span>
                            {line.text || ' '}
                          </code>
                        </div>
                      ))}
                      {!lines.length && !diff.error && (
                        <p className="review-notice">Only file metadata changed.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {selection && onFeedback && (
                <div className="review-feedback">
                  <span>
                    {selection.side} line {selection.line}
                  </span>
                  <Button
                    icon="message"
                    onClick={() => {
                      onFeedback(
                        `Review feedback for ${selectedFile!.path}, ${selection.side} line ${selection.line}, revision ${commit || snapshot.headSha} (saved change ${snapshot.id}):\n> ${selection.text.slice(0, 1000)}\n\nPlease `,
                      );
                      setSelection(null);
                    }}
                  >
                    Ask agent to change
                  </Button>
                </div>
              )}
            </>
          )}
          {tab === 'commits' && (
            <div className="review-history">
              <p className="review-notice">
                Commits in this saved change, relative to {snapshot.baseSha.slice(0, 7)}. Recovery
                checkpoints are hidden.
              </p>
              {index.isPending && <p role="status">Loading commits…</p>}
              {index.data?.commits.map((value) => (
                <button
                  key={value.sha}
                  onClick={() => {
                    setCommit(value.sha);
                    setFile('');
                    setSelection(null);
                    setTab('changes');
                  }}
                >
                  <Icon name="branch" size={16} />
                  <span>
                    <strong>{value.subject}</strong>
                    <small>
                      {value.author} · {new Date(value.date).toLocaleDateString()} ·{' '}
                      {value.sha.slice(0, 7)}
                    </small>
                  </span>
                </button>
              ))}
              {index.data?.commits.length === 0 && (
                <p className="review-notice">No authored commits in this snapshot.</p>
              )}
            </div>
          )}
          {tab === 'pr' && (
            <div className="review-pr">
              <Icon name="merge" size={28} />
              <h3>
                {snapshot.publication
                  ? `Pull request #${snapshot.publication.number}`
                  : 'Not published'}
              </h3>
              <p>
                {snapshot.publication
                  ? `${snapshot.publication.merged ? 'Merge recorded' : 'Published'} for this saved change.`
                  : 'This saved change has not been published to GitHub. Live pull request creation is not available yet.'}
              </p>
              {snapshot.publication?.url && (
                <a
                  className="button button-secondary"
                  href={snapshot.publication.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in GitHub <Icon name="external" size={16} />
                </a>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
  return threadId && (narrow || expanded) ? (
    <Modal label="Code review" className="repository-review" close={close}>
      {panel}
    </Modal>
  ) : (
    panel
  );
}
