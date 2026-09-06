import { z } from 'zod';
import { prisma } from '@r2cloud/database';
import { lockRow } from '@r2cloud/database/locking';
import { event } from './project-context';
import { digest, id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
const workspaceInput = z
  .object({ name: z.string().trim().min(3).max(80), projectName: z.string().trim().min(3).max(80) })
  .strict();
export async function createWorkspace(actor: Actor, key: string, input: unknown) {
  const value = workspaceInput.parse(input);
  requireThat(key.length >= 8 && key.length <= 200, 400, 'A valid command key is required.');
  return prisma.$transaction(async (db) => {
    await lockRow(db, 'users', actor.id);
    const user = await db.users.findUnique({ where: { id: actor.id } });
    requireThat(
      user?.kind === 'human' && user.auth_user_id,
      403,
      'Sign in with a verified account to create a workspace.',
    );
    const previous = await db.onboardingReceipt.findUnique({
      where: { userId_key: { userId: actor.id, key } },
    });
    const hash = digest(value);
    if (previous) {
      requireThat(
        previous.digest === hash,
        409,
        'This command key was used with different content.',
      );
      return previous.result;
    }
    const orgId = id(),
      projectId = id();
    await db.organisations.create({ data: { id: orgId, name: value.name } });
    await db.memberships.create({ data: { org_id: orgId, user_id: actor.id, role: 'owner' } });
    await db.projects.create({ data: { id: projectId, org_id: orgId, name: value.projectName } });
    await db.project_access.create({
      data: {
        org_id: orgId,
        project_id: projectId,
        user_id: actor.id,
        contribute: true,
        review: true,
        merge: true,
      },
    });
    await event(db, projectId, null, actor.id, 'Workspace and first project created', {
      initialReviewer: actor.id,
    });
    const result = { orgId, projectId };
    await db.onboardingReceipt.create({ data: { userId: actor.id, key, digest: hash, result } });
    return result;
  });
}
