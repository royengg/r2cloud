import { z } from 'zod';
import { prisma } from '@r2cloud/database';
import { lockRow } from '@r2cloud/database/locking';
import { event } from './project-context';
import { digest, id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
const input = z.object({ name: z.string().trim().min(3).max(80) }).strict();
export async function createProject(actor: Actor, orgId: string, key: string, raw: unknown) {
  const value = input.parse(raw);
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  return prisma.$transaction(async (db) => {
    await lockRow(db, 'organisations', orgId);
    const member = await db.memberships.findUnique({
      where: { org_id_user_id: { org_id: orgId, user_id: actor.id } },
      include: { users: true },
    });
    requireThat(
      member?.users.kind === 'human' && ['owner', 'admin'].includes(member.role),
      403,
      'A workspace owner or administrator must create projects.',
    );
    await lockRow(db, 'users', actor.id);
    const payload = digest({ action: 'create-project', orgId, ...value });
    const previous = await db.onboardingReceipt.findUnique({
      where: { userId_key: { userId: actor.id, key } },
    });
    if (previous) {
      requireThat(
        previous.digest === payload,
        409,
        'This command key was used with different content.',
      );
      return previous.result;
    }
    const projectId = id();
    await db.projects.create({ data: { id: projectId, org_id: orgId, name: value.name } });
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
    await event(db, projectId, null, actor.id, 'Project created', { initialReviewer: actor.id });
    const result = { projectId };
    await db.onboardingReceipt.create({ data: { userId: actor.id, key, digest: payload, result } });
    return result;
  });
}
