import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Avatar, Button, IconButton, Modal } from './ui';
type Permissions = { contribute: boolean; review: boolean; merge: boolean };
type Member = Permissions & { id: string; name: string; version: number };
type Invite = Permissions & { id: string; email: string; expires_at: string };
function PermissionFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Permissions;
  onChange: (next: Permissions) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="permission-fields" disabled={disabled}>
      <legend>Project permissions</legend>
      {(
        [
          ['contribute', 'Start work'],
          ['review', 'Approve publication'],
          ['merge', 'Authorise merge'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
function MemberRow({
  member,
  busy,
  save,
}: {
  member: Member;
  busy: boolean;
  save: (input: Permissions & { version: number; remove: boolean }) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false),
    [value, setValue] = useState<Permissions>(member),
    [removing, setRemoving] = useState(false);
  return (
    <article className="team-member">
      <div className="person-row">
        <Avatar name={member.name} />
        <div>
          <strong>{member.name}</strong>
          <span>
            {member.review ? 'Reviewer' : member.contribute ? 'Contributor' : 'Viewer'}
            {member.merge ? ' · Can authorise merge' : ''}
          </span>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setValue(member);
            setEditing(!editing);
            setRemoving(false);
          }}
          aria-expanded={editing}
        >
          Edit access
        </Button>
      </div>
      {editing && (
        <div className="member-editor">
          <PermissionFields value={value} onChange={setValue} disabled={busy} />
          <div className="modal-actions">
            <Button
              busy={busy}
              onClick={() =>
                void save({ ...value, version: member.version, remove: false }).then((ok) => {
                  if (ok) setEditing(false);
                })
              }
            >
              Save permissions
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              Remove access
            </Button>
          </div>
          {removing && (
            <div className="state-notice notice-warning">
              <div>
                <p>
                  Remove {member.name} from this project? Existing task ownership stays reserved.
                </p>
                <Button
                  busy={busy}
                  onClick={() => void save({ ...value, version: member.version, remove: true })}
                >
                  Confirm removal
                </Button>
                <Button variant="ghost" onClick={() => setRemoving(false)}>
                  Keep access
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
export function TeamPanel({ projectId, close }: { projectId: string; close: () => void }) {
  const [data, setData] = useState<{ members: Member[]; invitations: Invite[] } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(''),
    [permission, setPermission] = useState<Permissions>({
      contribute: true,
      review: false,
      merge: false,
    }),
    [notice, setNotice] = useState('');
  async function reload() {
    setData(await api(`/projects/${projectId}/team`));
  }
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [projectId]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(path, body);
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      await reload().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal label="Manage project access" close={close} className="team-modal">
      <div className="modal-topline">
        <h2>Your project team</h2>
        <IconButton name="close" label="Close team settings" onClick={close} />
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading team…</p>}
      {!data && error && (
        <Button onClick={() => void reload().catch((e) => setError(e.message))}>Try again</Button>
      )}
      {data && (
        <>
          <section>
            <h3>Invite a teammate</h3>
            <p className="subtle">
              They’ll see the invitation when they sign in with this GitHub email.
            </p>
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(`/projects/${projectId}/invitations`, { email, ...permission }).then(
                  (ok) => {
                    if (ok) {
                      setEmail('');
                      setNotice('Invitation ready. Ask your teammate to sign in to accept it.');
                    }
                  },
                );
              }}
            >
              <label>
                GitHub email
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <PermissionFields value={permission} onChange={setPermission} disabled={busy} />
              <Button variant="primary" icon="add" busy={busy}>
                Create invitation
              </Button>
            </form>
            {notice && (
              <p role="status" className="subtle">
                {notice}
              </p>
            )}
          </section>
          {data.invitations.length > 0 && (
            <section>
              <h3>Pending invitations</h3>
              {data.invitations.map((invitation) => (
                <div className="pending-invite" key={invitation.id}>
                  <span>
                    {invitation.email}
                    <small>Expires {new Date(invitation.expires_at).toLocaleDateString()}</small>
                  </span>
                  <Button
                    variant="ghost"
                    busy={busy}
                    onClick={() =>
                      void act(`/projects/${projectId}/invitations/${invitation.id}/revoke`, {})
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </section>
          )}
          <section>
            <h3>People with access</h3>
            {data.members.map((member) => (
              <MemberRow
                key={`${member.id}:${member.version}`}
                member={member}
                busy={busy}
                save={(input) => act(`/projects/${projectId}/members/${member.id}`, input)}
              />
            ))}
          </section>
        </>
      )}
    </Modal>
  );
}
