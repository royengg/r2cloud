import { z } from 'zod';
import { transaction } from './db';
import { event } from './service';
import { digest, id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
const input = z.object({ name: z.string().trim().min(3).max(80) }).strict();
export async function createProject(actor: Actor, orgId: string, key: string, raw: unknown) {
  const value = input.parse(raw);
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  return transaction(async (db) => {
    await db.query('SELECT id FROM organisations WHERE id=$1 FOR UPDATE', [orgId]);
    const member = (
      await db.query(
        `SELECT m.role,u.kind FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2`,
        [orgId, actor.id],
      )
    ).rows[0];
    requireThat(
      member?.kind === 'human' && ['owner', 'admin'].includes(member.role),
      403,
      'A workspace owner or administrator must create projects.',
    );
    // Share the actor's onboarding receipt namespace, with an action-scoped payload digest.
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [actor.id]);
    const payload = digest({ action: 'create-project', orgId, ...value });
    const previous = (
      await db.query('SELECT * FROM onboarding_receipts WHERE "userId"=$1 AND key=$2', [
        actor.id,
        key,
      ])
    ).rows[0];
    if (previous) {
      requireThat(
        previous.digest === payload,
        409,
        'This command key was used with different content.',
      );
      return previous.result;
    }
    const projectId = id();
    await db.query('INSERT INTO projects(id,org_id,name,repo_id) VALUES($1,$2,$3,NULL)', [
      projectId,
      orgId,
      value.name,
    ]);
    await db.query(
      'INSERT INTO project_access(org_id,project_id,user_id,contribute,review,merge) VALUES($1,$2,$3,true,true,true)',
      [orgId, projectId, actor.id],
    );
    await event(db, projectId, null, actor.id, 'Project created', { initialReviewer: actor.id });
    const result = { projectId };
    await db.query('INSERT INTO onboarding_receipts VALUES($1,$2,$3,$4)', [
      actor.id,
      key,
      payload,
      JSON.stringify(result),
    ]);
    return result;
  });
}
