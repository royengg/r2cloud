import type { Invitation } from '../lib/types';
import { Button } from './ui';
import { Icon } from './Icon';
export function InvitationInbox({
  invitations,
  busy,
  error,
  accept,
  close,
}: {
  invitations: Invitation[];
  busy: boolean;
  error: string;
  accept: (id: string) => void;
  close: () => void;
}) {
  return (
    <main className="sign-in-page">
      <section className="sign-in-card auth-card invitation-inbox">
        <span className="brand sign-in-brand">
          <Icon name="cloud" size={26} />
          r2cloud.
        </span>
        <h1>Your team is here.</h1>
        <p>Choose a project invitation to get started.</p>
        {invitations.map((invitation) => (
          <article className="invitation-card" key={invitation.id}>
            <span className="field-overline">{invitation.workspace_name}</span>
            <h2>{invitation.project_name}</h2>
            <p>Invited by {invitation.inviter_name}</p>
            <ul>
              <li>View this project</li>
              {invitation.contribute && <li>Create tasks and start work</li>}
              {invitation.review && <li>Approve changes for code review</li>}
              {invitation.merge && <li>Authorise merging approved changes</li>}
            </ul>
            <Button variant="primary" busy={busy} onClick={() => accept(invitation.id)}>
              Join {invitation.project_name}
            </Button>
          </article>
        ))}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="ghost" onClick={close}>
          Not now
        </Button>
      </section>
    </main>
  );
}
