import { prisma, json, type DB } from '@r2cloud/database';
import { access, lockProject } from './project-context';
import { digest } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
export async function receipt<T>(
  actor: Actor,
  projectId: string,
  key: string,
  payload: unknown,
  fn: (db: DB) => Promise<T>,
): Promise<T> {
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid idempotency key is required.');
  return prisma.$transaction(async (db) => {
    await access(db, actor, projectId);
    await lockProject(db, projectId);
    const prev = await db.receipts.findUnique({
      where: { user_id_project_id_key: { user_id: actor.id, project_id: projectId, key } },
    });
    const d = digest(payload);
    if (prev) {
      requireThat(
        prev.payload_hash === d,
        409,
        'This request key was already used for different content.',
      );
      return prev.response as T;
    }
    const result = await fn(db);
    await db.receipts.create({
      data: {
        user_id: actor.id,
        project_id: projectId,
        key,
        payload_hash: d,
        response: json(result),
      },
    });
    return result;
  });
}
