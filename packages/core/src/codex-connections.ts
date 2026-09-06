import { prisma } from '@r2cloud/database';
import { lockRow } from '@r2cloud/database/locking';
import { access, event, lockProject } from './project-context';
import { digest, id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
const active = ['queued', 'starting', 'awaiting', 'connected'];
export async function codexConnection(actor: Actor, projectId: string, available: boolean) {
  const project = await access(prisma, actor, projectId);
  const row = await prisma.codexConnection.findFirst({
    where: { projectId, userId: actor.id },
    orderBy: { createdAt: 'desc' },
  });
  const expired = row && row.state !== 'connected' && row.expiresAt <= new Date();
  return {
    available: available && project.contribute && project.actor_kind === 'human',
    connection: row && {
      id: row.id,
      state: expired && active.includes(row.state) ? 'failed' : row.state,
      userCode: !expired && row.state === 'awaiting' ? row.userCode : null,
      verificationUrl:
        !expired && row.state === 'awaiting' ? 'https://auth.openai.com/codex/device' : null,
      expiresAt: row.expiresAt,
      plan: row.plan,
      error: expired && active.includes(row.state) ? 'Sign-in expired. Try again.' : row.error,
    },
  };
}
export async function beginCodexConnection(
  actor: Actor,
  projectId: string,
  key: string,
  available: boolean,
) {
  requireThat(available, 503, 'Codex sign-in is not configured yet.');
  requireThat(key.length >= 8 && key.length <= 128, 400, 'A valid command key is required.');
  return prisma.$transaction(async (db) => {
    await lockProject(db, projectId);
    const project = await access(db, actor, projectId, 'contribute');
    requireThat(project.actor_kind === 'human', 403, 'Only a person can connect an account.');
    await lockRow(db, 'users', actor.id);
    const where = { user_id_project_id_key: { user_id: actor.id, project_id: projectId, key } };
    const hash = digest({ action: 'connect-codex' });
    const previous = await db.receipts.findUnique({ where });
    if (previous) {
      requireThat(
        previous.payload_hash === hash,
        409,
        'Command key was used with different content.',
      );
      return previous.response;
    }
    await db.codexConnection.updateMany({
      where: {
        userId: actor.id,
        state: { in: ['queued', 'starting', 'awaiting'] },
        expiresAt: { lte: new Date() },
      },
      data: { state: 'failed', userCode: null, error: 'Sign-in expired. Try again.' },
    });
    const existing = await db.codexConnection.findFirst({
      where: { userId: actor.id, projectId, state: { in: active } },
    });
    requireThat(
      existing ||
        !(await db.codexConnection.count({
          where: { userId: actor.id, state: { in: ['queued', 'starting', 'awaiting'] } },
        })),
      409,
      'Finish or cancel your existing Codex sign-in first.',
    );
    const connection =
      existing ??
      (await db.codexConnection.create({
        data: { id: id(), orgId: project.org_id, projectId, userId: actor.id, state: 'queued' },
      }));
    const result = { id: connection.id };
    await db.receipts.create({
      data: { user_id: actor.id, project_id: projectId, key, payload_hash: hash, response: result },
    });
    if (!existing) await event(db, projectId, null, actor.id, 'Personal Codex sign-in requested');
    return result;
  });
}
export async function disconnectCodex(actor: Actor, projectId: string, connectionId: string) {
  return prisma.$transaction(async (db) => {
    await lockProject(db, projectId);
    await access(db, actor, projectId);
    await lockRow(db, 'users', actor.id);
    const connection = await db.codexConnection.findFirst({
      where: { id: connectionId, projectId, userId: actor.id },
    });
    requireThat(connection, 404, 'Codex connection not found.');
    if (!active.includes(connection.state)) return { disconnected: true };
    await db.codexConnection.update({
      where: { id: connectionId },
      data: {
        state: connection.state === 'connected' ? 'disconnected' : 'cancelled',
        userCode: null,
        plan: null,
      },
    });
    await db.provider_connections.updateMany({
      where: { user_id: actor.id, project_id: projectId, secret_ref: connectionId },
      data: { enabled: false, secret_ref: null },
    });
    await event(db, projectId, null, actor.id, 'Personal Codex connection removed');
    return { disconnected: true };
  });
}
