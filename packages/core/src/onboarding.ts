import { z } from 'zod';
import { transaction } from './db';
import { event } from './service';
import { digest, id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
const workspaceInput = z
  .object({ name: z.string().trim().min(3).max(80), projectName: z.string().trim().min(3).max(80) })
  .strict();
export async function createWorkspace(actor: Actor, key: string, input: unknown) {
  const value = workspaceInput.parse(input);
  requireThat(key.length >= 8 && key.length <= 200, 400, 'A valid command key is required.');
  return transaction(async (db) => {
    const user = (await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [actor.id])).rows[0];
    requireThat(
      user?.kind === 'human' && user.auth_user_id,
      403,
      'Sign in with a verified account to create a workspace.',
    );
    const previous = (
      await db.query('SELECT * FROM onboarding_receipts WHERE "userId"=$1 AND key=$2', [
        actor.id,
        key,
      ])
    ).rows[0];
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
    await db.query('INSERT INTO organisations(id,name) VALUES($1,$2)', [orgId, value.name]);
    await db.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [
      orgId,
      actor.id,
    ]);
    await db.query('INSERT INTO projects(id,org_id,name,repo_id) VALUES($1,$2,$3,NULL)', [
      projectId,
      orgId,
      value.projectName,
    ]);
    await db.query(
      'INSERT INTO project_access(org_id,project_id,user_id,contribute,review,merge) VALUES($1,$2,$3,true,true,true)',
      [orgId, projectId, actor.id],
    );
    await event(db, projectId, null, actor.id, 'Workspace and first project created', {
      initialReviewer: actor.id,
    });
    const result = { orgId, projectId };
    await db.query('INSERT INTO onboarding_receipts VALUES($1,$2,$3,$4)', [
      actor.id,
      key,
      hash,
      JSON.stringify(result),
    ]);
    return result;
  });
}
