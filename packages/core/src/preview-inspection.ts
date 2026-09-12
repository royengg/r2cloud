import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, rm, statfs } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { prisma, json } from '@r2cloud/database';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import type { AgentGrant } from '@r2cloud/contracts/agent';
import { access, lockProject, event } from './project-context';
import { activeAgentTurn } from './agent-turns';

const root = resolve('.local/artifacts/previews');
export async function savePreviewInspection(
  grant: AgentGrant,
  callId: string,
  inspection: {
    path: string;
    snapshot: string;
    errors: string[];
    screenshot: string;
    status?: number;
  },
) {
  await activeAgentTurn(grant);
  const bytes = Buffer.from(inspection.screenshot, 'base64');
  const digest = createHash('sha256').update(bytes).digest('hex');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const disk = await statfs(root);
  requireThat(disk.bavail * disk.bsize >= 21 * 1024 ** 3, 507, 'Screenshot storage is full.');
  const temporary = join(root, randomUUID() + '.tmp');
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, join(root, digest + '.png'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return prisma.$transaction(async (db) => {
    await lockProject(db, grant.projectId);
    await access(db, { id: grant.actorId } as Actor, grant.projectId, 'contribute');
    requireThat(
      await db.agentTurn.count({
        where: { id: grant.id, projectId: grant.projectId, stoppedAt: null, stopRequested: false },
      }),
      409,
      'This turn has ended.',
    );
    const item = await db.agentItem.upsert({
      where: { turnId_sourceId: { turnId: grant.id, sourceId: 'preview:' + callId } },
      create: {
        id: randomUUID(),
        turnId: grant.id,
        sourceId: 'preview:' + callId,
        kind: 'previewInspection',
        status: 'completed',
        text: inspection.snapshot,
        detail: json({
          digest,
          path: inspection.path,
          capturedAt: new Date().toISOString(),
          errors: inspection.errors,
          status: inspection.status,
        }),
      },
      update: {},
    });
    await event(
      db,
      grant.projectId,
      grant.taskId ?? null,
      grant.actorId,
      'Agent timeline updated',
      { threadId: grant.threadId },
    );
    return item.id;
  });
}
export async function readPreviewScreenshot(actor: Actor, projectId: string, itemId: string) {
  await access(prisma, actor, projectId);
  const item = await prisma.agentItem.findFirst({
    where: { id: itemId, kind: 'previewInspection', turn: { projectId } },
  });
  requireThat(item, 404, 'Screenshot not found.');
  const digest = (item.detail as { digest?: string }).digest;
  requireThat(digest && /^[a-f0-9]{64}$/.test(digest), 404, 'Screenshot not found.');
  const bytes = await readFile(join(root, digest + '.png')).catch(
    (error: NodeJS.ErrnoException) => {
      requireThat(error.code !== 'ENOENT', 404, 'Screenshot not found.');
      throw error;
    },
  );
  requireThat(
    createHash('sha256').update(bytes).digest('hex') === digest,
    409,
    'Screenshot integrity check failed.',
  );
  return bytes;
}
