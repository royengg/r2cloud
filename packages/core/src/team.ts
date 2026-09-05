import { z } from 'zod';
import { pool, transaction, type DB } from './db';
import { access, lockProject, event } from './service';
import { digest, id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
const permissions = z
  .object({ contribute: z.boolean(), review: z.boolean(), merge: z.boolean() })
  .strict();
const inviteInput = permissions.extend({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
});
export async function projectAdministrator(db: DB, actor: Actor, projectId: string) {
  const project = await access(db, actor, projectId);
  const membership = (
    await db.query(
      'SELECT m.role,u.kind FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2',
      [project.org_id, actor.id],
    )
  ).rows[0];
  requireThat(
    membership?.kind === 'human' && ['owner', 'admin'].includes(membership.role),
    403,
    'A workspace owner or administrator must manage project access.',
  );
  return project;
}
async function checked<T>(
  actor: Actor,
  projectId: string,
  key: string,
  payload: unknown,
  work: (db: DB) => Promise<T>,
) {
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  return transaction(async (db) => {
    await lockProject(db, projectId);
    await projectAdministrator(db, actor, projectId);
    const previous = (
      await db.query('SELECT * FROM receipts WHERE user_id=$1 AND project_id=$2 AND key=$3', [
        actor.id,
        projectId,
        key,
      ])
    ).rows[0];
    const hash = digest(payload);
    if (previous) {
      requireThat(
        previous.payload_hash === hash,
        409,
        'Command key was used with different content.',
      );
      return previous.response as T;
    }
    const result = await work(db);
    await db.query('INSERT INTO receipts VALUES($1,$2,$3,$4,$5)', [
      actor.id,
      projectId,
      key,
      hash,
      JSON.stringify(result),
    ]);
    return result;
  });
}
export async function team(actor: Actor, projectId: string) {
  await projectAdministrator(pool, actor, projectId);
  const members = (
    await pool.query(
      `SELECT u.id,u.name,a.contribute,a.review,a.merge,a.version FROM project_access a JOIN users u ON u.id=a.user_id WHERE a.project_id=$1 ORDER BY u.name`,
      [projectId],
    )
  ).rows;
  const invitations = (
    await pool.query(
      `SELECT id,email,contribute,review,merge,expires_at FROM project_invitations WHERE project_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
      [projectId],
    )
  ).rows;
  return { members, invitations };
}
export async function invite(actor: Actor, projectId: string, key: string, raw: unknown) {
  const input = inviteInput.parse(raw);
  return checked(actor, projectId, key, { action: 'invite', ...input }, async (db) => {
    const project = await projectAdministrator(db, actor, projectId);
    const member = (
      await db.query(
        `SELECT 1 FROM project_access a JOIN users u ON u.id=a.user_id JOIN auth_users au ON au.id=u.auth_user_id WHERE a.project_id=$1 AND lower(au.email)=$2`,
        [projectId, input.email],
      )
    ).rowCount;
    requireThat(
      !member,
      409,
      'This person already has project access. Edit their permissions instead.',
    );
    await db.query(
      `UPDATE project_invitations SET revoked_at=now() WHERE project_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()`,
      [projectId, input.email],
    );
    requireThat(
      !(
        await db.query(
          `SELECT 1 FROM project_invitations WHERE project_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
          [projectId, input.email],
        )
      ).rowCount,
      409,
      'An invitation is already pending for this email.',
    );
    const invitationId = id();
    await db.query(
      `INSERT INTO project_invitations(id,org_id,project_id,inviter_id,email,contribute,review,merge) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        invitationId,
        project.org_id,
        projectId,
        actor.id,
        input.email,
        input.contribute,
        input.review,
        input.merge,
      ],
    );
    await event(db, projectId, null, actor.id, 'Project invitation created', {
      invitationId,
      contribute: input.contribute,
      review: input.review,
      merge: input.merge,
    });
    return { id: invitationId };
  });
}
export async function revokeInvitation(
  actor: Actor,
  projectId: string,
  key: string,
  invitationId: string,
) {
  return checked(
    actor,
    projectId,
    key,
    { action: 'revoke-invitation', invitationId },
    async (db) => {
      const updated = await db.query(
        `UPDATE project_invitations SET revoked_at=now() WHERE id=$1 AND project_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
        [invitationId, projectId],
      );
      requireThat(updated.rowCount, 409, 'This invitation is no longer pending.');
      await event(db, projectId, null, actor.id, 'Project invitation revoked', { invitationId });
      return { revoked: true };
    },
  );
}
export async function invitationInbox(actor: Actor) {
  return (
    await pool.query(
      `SELECT i.id,p.name project_name,o.name workspace_name,u.name inviter_name,i.contribute,i.review,i.merge,i.expires_at FROM project_invitations i JOIN projects p ON p.id=i.project_id JOIN organisations o ON o.id=i.org_id JOIN users u ON u.id=i.inviter_id JOIN users recipient ON recipient.id=$1 JOIN auth_users au ON au.id=recipient.auth_user_id WHERE recipient.kind='human' AND au."emailVerified"=true AND lower(au.email)=i.email AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() ORDER BY i.created_at`,
      [actor.id],
    )
  ).rows;
}
export async function acceptInvitation(actor: Actor, invitationId: string) {
  return transaction(async (db) => {
    const pending = (
      await db.query('SELECT project_id FROM project_invitations WHERE id=$1', [invitationId])
    ).rows[0];
    requireThat(pending, 404, 'Invitation not found.');
    await lockProject(db, pending.project_id);
    const invitation = (
      await db.query('SELECT * FROM project_invitations WHERE id=$1 FOR UPDATE', [invitationId])
    ).rows[0];
    const person = (
      await db.query(
        `SELECT u.kind,au.email,au."emailVerified" verified FROM users u JOIN auth_users au ON au.id=u.auth_user_id WHERE u.id=$1`,
        [actor.id],
      )
    ).rows[0];
    requireThat(
      person?.kind === 'human' &&
        person.verified &&
        person.email.toLowerCase() === invitation.email,
      403,
      'Sign in with the GitHub account for this invitation.',
    );
    if (invitation.accepted_by === actor.id) {
      await access(db, actor, invitation.project_id);
      return { projectId: invitation.project_id };
    }
    requireThat(
      !invitation.accepted_at &&
        !invitation.revoked_at &&
        new Date(invitation.expires_at) > new Date(),
      409,
      'This invitation is no longer available.',
    );
    await projectAdministrator(
      db,
      { id: invitation.inviter_id, kind: 'human' },
      invitation.project_id,
    );
    await db.query(
      `INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,
      [invitation.org_id, actor.id],
    );
    requireThat(
      !(
        await db.query('SELECT 1 FROM project_access WHERE project_id=$1 AND user_id=$2', [
          invitation.project_id,
          actor.id,
        ])
      ).rowCount,
      409,
      'You already have project access. Ask an administrator to change permissions.',
    );
    await db.query(
      'INSERT INTO project_access(org_id,project_id,user_id,contribute,review,merge) VALUES($1,$2,$3,$4,$5,$6)',
      [
        invitation.org_id,
        invitation.project_id,
        actor.id,
        invitation.contribute,
        invitation.review,
        invitation.merge,
      ],
    );
    await db.query('UPDATE project_invitations SET accepted_by=$2,accepted_at=now() WHERE id=$1', [
      invitationId,
      actor.id,
    ]);
    await event(db, invitation.project_id, null, actor.id, 'Project invitation accepted', {
      invitationId,
    });
    return { projectId: invitation.project_id };
  });
}
export async function updateMember(
  actor: Actor,
  projectId: string,
  key: string,
  userId: string,
  raw: unknown,
) {
  const input = permissions
    .extend({ version: z.number().int().positive(), remove: z.boolean().default(false) })
    .parse(raw);
  return checked(actor, projectId, key, { action: 'member', userId, ...input }, async (db) => {
    const current = (
      await db.query('SELECT * FROM project_access WHERE project_id=$1 AND user_id=$2 FOR UPDATE', [
        projectId,
        userId,
      ])
    ).rows[0];
    requireThat(
      current?.version === input.version,
      409,
      'Project access changed. Refresh and try again.',
    );
    const user = (await db.query('SELECT kind FROM users WHERE id=$1', [userId])).rows[0];
    requireThat(
      user.kind === 'human' || (!input.review && !input.merge),
      403,
      'Agents cannot approve publication or merge.',
    );
    if (current.review && (!input.review || input.remove)) {
      requireThat(
        (
          await db.query(
            `SELECT 1 FROM project_access a JOIN users u ON u.id=a.user_id WHERE a.project_id=$1 AND a.user_id<>$2 AND a.review=true AND u.kind='human'`,
            [projectId, userId],
          )
        ).rowCount,
        409,
        'Keep at least one human project reviewer.',
      );
    }
    if (input.remove)
      await db.query('DELETE FROM project_access WHERE project_id=$1 AND user_id=$2', [
        projectId,
        userId,
      ]);
    else
      await db.query(
        'UPDATE project_access SET contribute=$3,review=$4,merge=$5,version=version+1 WHERE project_id=$1 AND user_id=$2',
        [projectId, userId, input.contribute, input.review, input.merge],
      );
    await event(
      db,
      projectId,
      null,
      actor.id,
      input.remove ? 'Project access removed' : 'Project permissions updated',
      { userId, contribute: input.contribute, review: input.review, merge: input.merge },
    );
    return { updated: true };
  });
}
