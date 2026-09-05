import { z } from 'zod';
import { pool, transaction, type DB } from './db';
import { access, event, lockProject } from './service';
import { projectAdministrator } from './team';
import { digest } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { executionProfile } from '@r2cloud/contracts/execution';
export { executionProfile } from '@r2cloud/contracts/execution';
export async function readExecutionSetup(actor: Actor, projectId: string) {
  const project = await access(pool, actor, projectId);
  const profile =
    (
      await pool.query(
        'SELECT version,config,updated_at FROM execution_profiles WHERE project_id=$1',
        [projectId],
      )
    ).rows[0] ?? null;
  const connection =
    (
      await pool.query(
        'SELECT provider,mode,enabled FROM provider_connections WHERE project_id=$1 AND user_id=$2',
        [projectId, actor.id],
      )
    ).rows[0] ?? null;
  return {
    repositoryConnected: !!project.repo_id,
    profile,
    provider: connection,
    sandbox: { provider: 'vercel', status: 'supervisor_setup_required' },
    subscription: {
      method: 'codex_app_server_device_code',
      scope: 'personal_project',
      status: 'broker_setup_required',
    },
    ready: false,
  };
}
export async function saveExecutionSetup(
  actor: Actor,
  projectId: string,
  key: string,
  input: unknown,
) {
  const parsed = z
    .object({ version: z.number().int().min(0), config: executionProfile })
    .strict()
    .parse(input);
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  return transaction(async (db) => {
    await lockProject(db, projectId);
    const project = await projectAdministrator(db, actor, projectId);
    requireThat(project.repo_id, 409, 'Connect a repository before configuring execution.');
    const payloadHash = digest({ action: 'execution-setup', ...parsed });
    const prior = (
      await db.query(
        'SELECT payload_hash,response FROM receipts WHERE user_id=$1 AND project_id=$2 AND key=$3',
        [actor.id, projectId, key],
      )
    ).rows[0];
    if (prior) {
      requireThat(
        prior.payload_hash === payloadHash,
        409,
        'Command key was used with different content.',
      );
      return prior.response;
    }
    const previous = (
      await db.query('SELECT version FROM execution_profiles WHERE project_id=$1', [projectId])
    ).rows[0];
    requireThat(
      (previous?.version ?? 0) === parsed.version,
      409,
      'Execution setup changed. Reload before saving.',
    );
    const version = parsed.version + 1;
    await db.query(
      'INSERT INTO execution_profiles(project_id,org_id,version,config,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id) DO UPDATE SET version=$3,config=$4,updated_by=$5,updated_at=now()',
      [projectId, project.org_id, version, JSON.stringify(parsed.config), actor.id],
    );
    await event(db, projectId, null, actor.id, 'Execution setup updated', {
      version,
      digest: digest(parsed.config),
    });
    const result = { version };
    await db.query('INSERT INTO receipts VALUES($1,$2,$3,$4,$5)', [
      actor.id,
      projectId,
      key,
      payloadHash,
      JSON.stringify(result),
    ]);
    return result;
  });
}
/** Called while the task's authoritative project lock is held. Never runs commands. */
export async function pinExecutionSetup(
  db: DB,
  projectId: string,
  minutes: number,
  budgetCents: number,
) {
  const profile = (
    await db.query('SELECT version,config FROM execution_profiles WHERE project_id=$1', [projectId])
  ).rows[0];
  requireThat(profile, 409, 'Configure repository setup and sandbox limits before starting work.');
  const config = executionProfile.parse(profile.config);
  requireThat(
    minutes <= config.maxMinutes && budgetCents <= config.maxBudgetCents,
    409,
    'The run exceeds this project’s execution limits.',
  );
  return { version: profile.version, digest: digest(config), config };
}
