import { z } from 'zod';
import { prisma, json, type DB } from '@r2cloud/database';
import { access, lockProject, event } from './project-context';
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
export async function projectAdministrator(db: DB, actor: Pick<Actor, 'id'>, projectId: string) {
  const project = await access(db, actor, projectId);
  const membership = await db.memberships.findUnique({
    where: { org_id_user_id: { org_id: project.org_id, user_id: actor.id } },
    include: { users: true },
  });
  requireThat(
    membership?.users.kind === 'human' && ['owner', 'admin'].includes(membership.role),
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
  return prisma.$transaction(async (db) => {
    await lockProject(db, projectId);
    await projectAdministrator(db, actor, projectId);
    const previous = await db.receipts.findUnique({
      where: { user_id_project_id_key: { user_id: actor.id, project_id: projectId, key } },
    });
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
    await db.receipts.create({
      data: {
        user_id: actor.id,
        project_id: projectId,
        key,
        payload_hash: hash,
        response: json(result),
      },
    });
    return result;
  });
}
export async function team(actor: Actor, projectId: string) {
  await projectAdministrator(prisma, actor, projectId);
  const grants = await prisma.project_access.findMany({
    where: { project_id: projectId },
    include: { memberships: { include: { users: true } } },
    orderBy: { memberships: { users: { name: 'asc' } } },
  });
  const members = grants.map((g) => ({
    id: g.user_id,
    name: g.memberships.users.name,
    contribute: g.contribute,
    review: g.review,
    merge: g.merge,
    version: g.version,
  }));
  const rows = await prisma.projectInvitation.findMany({
    where: { projectId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  const invitations = rows.map((i) => ({
    id: i.id,
    email: i.email,
    contribute: i.contribute,
    review: i.review,
    merge: i.merge,
    expires_at: i.expiresAt,
  }));
  return { members, invitations };
}
export async function invite(actor: Actor, projectId: string, key: string, raw: unknown) {
  const input = inviteInput.parse(raw);
  return checked(actor, projectId, key, { action: 'invite', ...input }, async (db) => {
    const project = await projectAdministrator(db, actor, projectId);
    const member = await db.project_access.count({
      where: {
        project_id: projectId,
        memberships: {
          users: { authUser: { email: { equals: input.email, mode: 'insensitive' } } },
        },
      },
    });
    requireThat(
      !member,
      409,
      'This person already has project access. Edit their permissions instead.',
    );
    await db.projectInvitation.updateMany({
      where: {
        projectId,
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { lte: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    requireThat(
      !(await db.projectInvitation.count({
        where: { projectId, email: input.email, acceptedAt: null, revokedAt: null },
      })),
      409,
      'An invitation is already pending for this email.',
    );
    const invitationId = id();
    await db.projectInvitation.create({
      data: { id: invitationId, orgId: project.org_id, projectId, inviterId: actor.id, ...input },
    });
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
      const updated = await db.projectInvitation.updateMany({
        where: { id: invitationId, projectId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      requireThat(updated.count, 409, 'This invitation is no longer pending.');
      await event(db, projectId, null, actor.id, 'Project invitation revoked', { invitationId });
      return { revoked: true };
    },
  );
}
export async function invitationInbox(actor: Actor) {
  const recipient = await prisma.users.findUnique({
    where: { id: actor.id },
    include: { authUser: true },
  });
  if (recipient?.kind !== 'human' || !recipient.authUser?.emailVerified) return [];
  const invitations = await prisma.projectInvitation.findMany({
    where: {
      email: recipient.authUser.email.toLowerCase(),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { project: { include: { organisations: true } }, inviter: true },
    orderBy: { createdAt: 'asc' },
  });
  return invitations.map((i) => ({
    id: i.id,
    project_name: i.project.name,
    workspace_name: i.project.organisations.name,
    inviter_name: i.inviter.name,
    contribute: i.contribute,
    review: i.review,
    merge: i.merge,
    expires_at: i.expiresAt,
  }));
}
export async function acceptInvitation(actor: Actor, invitationId: string) {
  return prisma.$transaction(async (db) => {
    const pending = await db.projectInvitation.findUnique({
      where: { id: invitationId },
      select: { projectId: true },
    });
    requireThat(pending, 404, 'Invitation not found.');
    await lockProject(db, pending.projectId);
    // All invitation mutations hold the project lock.
    const invitation = await db.projectInvitation.findUniqueOrThrow({
      where: { id: invitationId },
    });
    const person = await db.users.findUnique({
      where: { id: actor.id },
      include: { authUser: true },
    });
    requireThat(
      person?.kind === 'human' &&
        person.authUser?.emailVerified &&
        person.authUser.email.toLowerCase() === invitation.email,
      403,
      'Sign in with the GitHub account for this invitation.',
    );
    if (invitation.acceptedBy === actor.id) {
      await access(db, actor, invitation.projectId);
      return { projectId: invitation.projectId };
    }
    requireThat(
      !invitation.acceptedAt && !invitation.revokedAt && invitation.expiresAt > new Date(),
      409,
      'This invitation is no longer available.',
    );
    await projectAdministrator(db, { id: invitation.inviterId }, invitation.projectId);
    await db.memberships.createMany({
      data: [{ org_id: invitation.orgId, user_id: actor.id, role: 'member' }],
      skipDuplicates: true,
    });
    requireThat(
      !(await db.project_access.count({
        where: { project_id: invitation.projectId, user_id: actor.id },
      })),
      409,
      'You already have project access. Ask an administrator to change permissions.',
    );
    await db.project_access.create({
      data: {
        org_id: invitation.orgId,
        project_id: invitation.projectId,
        user_id: actor.id,
        contribute: invitation.contribute,
        review: invitation.review,
        merge: invitation.merge,
      },
    });
    await db.projectInvitation.update({
      where: { id: invitationId },
      data: { acceptedBy: actor.id, acceptedAt: new Date() },
    });
    await event(db, invitation.projectId, null, actor.id, 'Project invitation accepted', {
      invitationId,
    });
    return { projectId: invitation.projectId };
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
    const where = { project_id_user_id: { project_id: projectId, user_id: userId } };
    const current = await db.project_access.findUnique({
      where,
      include: { memberships: { include: { users: true } } },
    });
    requireThat(
      current?.version === input.version,
      409,
      'Project access changed. Refresh and try again.',
    );
    requireThat(
      current.memberships.users.kind === 'human' || (!input.review && !input.merge),
      403,
      'Agents cannot approve publication or merge.',
    );
    if (current.review && (!input.review || input.remove)) {
      requireThat(
        await db.project_access.count({
          where: {
            project_id: projectId,
            user_id: { not: userId },
            review: true,
            memberships: { users: { kind: 'human' } },
          },
        }),
        409,
        'Keep at least one human project reviewer.',
      );
    }
    if (input.remove) await db.project_access.delete({ where });
    else
      await db.project_access.update({
        where,
        data: {
          contribute: input.contribute,
          review: input.review,
          merge: input.merge,
          version: { increment: 1 },
        },
      });
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
