import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ManagedSkill, SkillCatalogue } from '@r2cloud/contracts/skills';
import { api } from '../lib/api';
import { readQuery } from '../lib/queries';
import { refreshRead } from '../lib/realtime';
import { Button, IconButton, Modal } from './ui';

type Draft = Omit<ManagedSkill, 'version'> & { version: string | null };

export function SkillsPanel({
  projectId,
  projectName,
  close,
}: {
  projectId: string;
  projectName: string;
  close: () => void;
}) {
  const path = `/projects/${projectId}/skills`;
  const query = useQuery(readQuery<SkillCatalogue>(path));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const editable = query.data?.manage && draft?.source === 'project';

  function open(skill: Draft | null) {
    setDraft(skill);
    setError('');
    setDeleting(false);
  }

  async function save(skill: Draft, remove = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(
        path,
        remove
          ? { action: 'delete', name: skill.name, version: skill.version }
          : {
              action: 'save',
              name: skill.name,
              description: skill.description,
              instructions: skill.instructions,
              version: skill.version,
              enabled: skill.enabled,
            },
      );
      await Promise.all([refreshRead(path), refreshRead(`/projects/${projectId}/threads`)]);
      open(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label="Project skills" close={() => !busy && close()} className="skills-modal">
      <header className="skills-header">
        <div>
          <p className="skills-project">{projectName}</p>
          <h2>{draft ? (draft.version ? `/${draft.name}` : 'New skill') : 'Skills'}</h2>
        </div>
        <IconButton name="close" label="Close skills" disabled={busy} onClick={close} />
      </header>
      <p className="skills-intro">
        {draft
          ? 'Instructions the agent follows when you use this skill in a conversation.'
          : 'Reusable instructions for your project. Type / in a conversation to use a skill.'}
      </p>
      {(error || query.error) && (
        <p className="inline-error" role="alert">
          {error || query.error?.message}
        </p>
      )}
      {query.isPending && <p role="status">Loading skills…</p>}
      {query.isError && <Button onClick={() => void query.refetch()}>Retry</Button>}
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (editable) void save(draft);
          }}
        >
          <fieldset disabled={busy} className="skills-fields">
            <label>
              Command name
              <input
                required
                readOnly={!editable || !!draft.version}
                pattern={'[a-z][a-z0-9\\-]{0,63}'}
                maxLength={64}
                value={draft.name}
                placeholder="brand-voice"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label>
              Description
              <input
                required
                readOnly={!editable}
                maxLength={500}
                value={draft.description}
                placeholder="When should the agent use this skill?"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>
            <label>
              Instructions
              <textarea
                required
                readOnly={!editable}
                rows={10}
                maxLength={28000}
                value={draft.instructions}
                placeholder="Describe the approach, conventions, and checks to follow…"
                onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
              />
            </label>
            {editable && (
              <label className="skills-enabled">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />
                Available in conversations
              </label>
            )}
          </fieldset>
          {deleting && (
            <div className="skills-delete" role="alert">
              <p>
                Delete /{draft.name}? Existing conversations keep the instructions they already
                used.
              </p>
              <Button type="button" busy={busy} onClick={() => void save(draft, true)}>
                Delete skill
              </Button>
              <Button type="button" disabled={busy} onClick={() => setDeleting(false)}>
                Keep skill
              </Button>
            </div>
          )}
          <footer className="skills-actions">
            {editable && draft.version && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                Delete
              </Button>
            )}
            <div>
              <Button type="button" disabled={busy} onClick={() => open(null)}>
                {editable ? 'Cancel' : 'Back'}
              </Button>
              {editable && (
                <Button variant="primary" type="submit" busy={busy}>
                  {busy ? 'Saving…' : 'Save skill'}
                </Button>
              )}
            </div>
          </footer>
        </form>
      ) : (
        query.data && (
          <>
            {query.data.manage && (
              <div className="skills-toolbar">
                <Button
                  variant="primary"
                  icon="add"
                  disabled={busy}
                  onClick={() =>
                    open({
                      name: '',
                      description: '',
                      instructions: '',
                      source: 'project',
                      enabled: true,
                      version: null,
                    })
                  }
                >
                  New skill
                </Button>
                <Button disabled={busy} onClick={() => file.current?.click()}>
                  {busy ? 'Importing…' : 'Import SKILL.md'}
                </Button>
                <input
                  hidden
                  ref={file}
                  type="file"
                  accept=".md,text/markdown"
                  aria-label="Import skill file"
                  onChange={async (event) => {
                    const selected = event.target.files?.[0];
                    event.target.value = '';
                    if (!selected) return;
                    setBusy(true);
                    setError('');
                    try {
                      if (selected.size > 128000)
                        throw new Error('Choose a SKILL.md file smaller than 128 KB.');
                      const definition = await api<{
                        name: string;
                        description: string;
                        instructions: string;
                      }>(`${path}/import`, { content: await selected.text() });
                      open({ ...definition, source: 'project', enabled: true, version: null });
                    } catch (cause) {
                      setError((cause as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </div>
            )}
            {!query.data.manage && (
              <p className="subtle">Workspace owners and admins can manage project skills.</p>
            )}
            {(['project', 'built-in'] as const).map((source) => {
              const skills = query.data.skills.filter((skill) => skill.source === source);
              return (
                <section className="skills-section" key={source}>
                  <h3>
                    {source === 'project' ? 'Project skills' : 'Built-in skills'}{' '}
                    <span>{skills.length}</span>
                  </h3>
                  {!skills.length && (
                    <p className="skills-empty">
                      Add your team’s conventions or import an instruction file to get started.
                    </p>
                  )}
                  <div className="skills-list">
                    {skills.map((skill) => (
                      <button
                        className="skills-row"
                        key={skill.name}
                        disabled={busy}
                        onClick={() => open(skill)}
                      >
                        <div>
                          <strong>/{skill.name}</strong>
                          <p>{skill.description}</p>
                        </div>
                        <span className="skills-state">
                          {source === 'built-in'
                            ? 'Built-in'
                            : skill.enabled
                              ? 'Enabled'
                              : 'Disabled'}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {query.data.manage && (
              <p className="skills-footnote">
                Imports include SKILL.md instructions only. Supporting scripts and other files
                aren’t uploaded.
              </p>
            )}
          </>
        )
      )}
    </Modal>
  );
}
