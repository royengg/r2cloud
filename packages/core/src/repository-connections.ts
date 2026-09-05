import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { pool, transaction } from './db';
import { access, event, lockProject } from './service';
import { projectAdministrator } from './team';
import { id, hash, digest } from '@r2cloud/contracts/hash';
import { requireThat, Fault, type Actor } from '@r2cloud/contracts/domain';
import type { RepositoryDiscovery, DiscoveredRepository } from '@r2cloud/adapters/github-discovery';
export type ConnectionConfig = { clientId: string; callbackURL: string; appSlug: string };
export async function connectionStatus(actor: Actor, projectId: string, config?: ConnectionConfig) {
  const project = await access(pool, actor, projectId);
  const repository = project.repo_id
    ? (
        await pool.query('SELECT full_name,target_ref FROM repositories WHERE id=$1', [
          project.repo_id,
        ])
      ).rows[0]
    : null;
  let manage = false;
  try {
    await projectAdministrator(pool, actor, projectId);
    manage = true;
  } catch (error) {
    if (!(error instanceof Fault) || error.status !== 403) throw error;
  }
  const pending = manage
    ? ((
        await pool.query(
          `SELECT id,status,repositories,error,expires_at FROM repository_connections WHERE project_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 1`,
          [projectId, actor.id],
        )
      ).rows[0] ?? null)
    : null;
  if (pending && new Date(pending.expires_at) <= new Date() && pending.status !== 'attached') {
    pending.status = 'failed';
    pending.repositories = null;
    pending.error = 'Authorization expired. Reconnect GitHub.';
  }
  return {
    repository,
    manage,
    githubAvailable: Boolean(config),
    installationURL: config ? `https://github.com/apps/${config.appSlug}/installations/new` : null,
    pending,
  };
}
export async function beginRepositoryConnection(
  actor: Actor,
  projectId: string,
  key: string,
  config?: ConnectionConfig,
) {
  requireThat(config, 503, 'GitHub repository connections are not configured yet.');
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  const state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url');
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackURL,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return transaction(async (db) => {
    await lockProject(db, projectId);
    const project = await projectAdministrator(db, actor, projectId);
    const payloadHash = digest({ action: 'repository-authorization', config });
    const previous = (
      await db.query('SELECT * FROM receipts WHERE user_id=$1 AND project_id=$2 AND key=$3', [
        actor.id,
        projectId,
        key,
      ])
    ).rows[0];
    if (previous) {
      requireThat(
        previous.payload_hash === payloadHash,
        409,
        'Command key was used with different content.',
      );
      return previous.response as { url: string };
    }
    requireThat(!project.repo_id, 409, 'This project already has a repository.');
    await db.query(
      `INSERT INTO repository_connections(id,org_id,project_id,actor_id,state_hash,verifier,status) VALUES($1,$2,$3,$4,$5,$6,'authorizing')`,
      [id(), project.org_id, projectId, actor.id, hash(state), verifier],
    );
    const result = { url: url.href };
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
export async function queueRepositoryCallback(actor: Actor, state: string, code: string) {
  requireThat(
    state.length >= 32 && state.length <= 128 && code.length > 0 && code.length <= 512,
    400,
    'Invalid repository authorization callback.',
  );
  return transaction(async (db) => {
    const row = (
      await db.query('SELECT * FROM repository_connections WHERE state_hash=$1', [hash(state)])
    ).rows[0];
    requireThat(
      row?.actor_id === actor.id,
      403,
      'This repository authorization belongs to another session.',
    );
    await lockProject(db, row.project_id);
    await projectAdministrator(db, actor, row.project_id);
    const updated = await db.query(
      `UPDATE repository_connections SET status='queued',code=$2 WHERE id=$1 AND status='authorizing' AND expires_at>now() RETURNING project_id`,
      [row.id, code],
    );
    requireThat(
      updated.rowCount,
      409,
      'This repository authorization expired or was already used.',
    );
    return { projectId: row.project_id };
  });
}
export async function discoverOne(backend: RepositoryDiscovery) {
  const request = await transaction(async (db) => {
    await db.query(
      `UPDATE repository_connections SET status='failed',code=NULL,verifier=NULL,error='Authorization expired. Reconnect GitHub.' WHERE status IN ('authorizing','queued') AND expires_at<=now()`,
    );
    await db.query(
      `UPDATE repository_connections SET status='failed',code=NULL,verifier=NULL,error='Authorization was interrupted. Reconnect GitHub.' WHERE status='checking' AND lease_until<now()`,
    );
    const row = (
      await db.query(
        `SELECT * FROM repository_connections WHERE status='queued' AND expires_at>now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
    ).rows[0];
    if (!row) return null;
    await db.query(
      `UPDATE repository_connections SET status='checking',lease_until=now()+interval '8 minutes',code=NULL,verifier=NULL WHERE id=$1`,
      [row.id],
    );
    return row;
  });
  if (!request) return false;
  try {
    const actor = { id: request.actor_id, kind: 'human' as const };
    await projectAdministrator(pool, actor, request.project_id);
    const account = (
      await pool.query(
        `SELECT a."accountId" FROM auth_accounts a JOIN users u ON u.auth_user_id=a."userId" WHERE u.id=$1 AND a."providerId"='github'`,
        [actor.id],
      )
    ).rows[0];
    requireThat(account, 403, 'A verified GitHub identity is required.');
    const repositories = await backend.discover({
      code: request.code,
      verifier: request.verifier,
      githubUserId: account.accountId,
    });
    await transaction(async (db) => {
      await lockProject(db, request.project_id);
      await projectAdministrator(db, actor, request.project_id);
      const updated = await db.query(
        `UPDATE repository_connections SET status='ready',repositories=$2,expires_at=now()+interval '10 minutes' WHERE id=$1 AND status='checking' AND lease_until>now() RETURNING id`,
        [request.id, JSON.stringify(repositories)],
      );
      requireThat(updated.rowCount, 409, 'Repository discovery was superseded.');
      await event(db, request.project_id, null, actor.id, 'Repository choices verified');
    });
  } catch {
    await pool.query(
      `UPDATE repository_connections SET status='failed',error='Repository access could not be verified. Reconnect GitHub and use the same account you signed in with.' WHERE id=$1 AND status='checking'`,
      [request.id],
    );
  }
  return true;
}
export async function attachRepository(actor: Actor, projectId: string, raw: unknown) {
  const input = z
    .object({ connectionId: z.string().min(1), repositoryId: z.number().int().positive() })
    .strict()
    .parse(raw);
  return transaction(async (db) => {
    await lockProject(db, projectId);
    const project = await projectAdministrator(db, actor, projectId);
    const connection = (
      await db.query(
        'SELECT * FROM repository_connections WHERE id=$1 AND project_id=$2 AND actor_id=$3 FOR UPDATE',
        [input.connectionId, projectId, actor.id],
      )
    ).rows[0];
    requireThat(connection, 403, 'Repository choices are not available to this account.');
    if (connection.status === 'attached') {
      const existing = (
        await db.query('SELECT github_id FROM repositories WHERE id=$1', [project.repo_id])
      ).rows[0];
      requireThat(
        String(existing?.github_id) === String(input.repositoryId),
        409,
        'A different repository is already connected.',
      );
      return { connected: true };
    }
    requireThat(
      connection.status === 'ready' && new Date(connection.expires_at) > new Date(),
      409,
      'Repository choices expired. Reconnect GitHub.',
    );
    requireThat(!project.repo_id, 409, 'This project already has a repository.');
    const repository = (connection.repositories as DiscoveredRepository[]).find(
      (r) => r.id === input.repositoryId,
    );
    requireThat(repository, 403, 'Select a repository verified for your GitHub account.');
    let saved = (
      await db.query('SELECT * FROM repositories WHERE org_id=$1 AND github_id=$2', [
        project.org_id,
        repository.id,
      ])
    ).rows[0];
    if (!saved) {
      saved = { id: id() };
      await db.query(
        'INSERT INTO repositories(id,org_id,full_name,target_ref,base_sha,github_id,installation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          saved.id,
          project.org_id,
          repository.fullName,
          repository.defaultBranch,
          repository.baseSha,
          repository.id,
          repository.installationId,
        ],
      );
    }
    await db.query('UPDATE projects SET repo_id=$2 WHERE id=$1', [projectId, saved.id]);
    await db.query("UPDATE repository_connections SET status='attached' WHERE id=$1", [
      connection.id,
    ]);
    await event(db, projectId, null, actor.id, 'Repository connected', {
      repository: repository.fullName,
      baseSha: repository.baseSha,
    });
    return { connected: true };
  });
}
