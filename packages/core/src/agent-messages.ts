import type { DB } from '@r2cloud/database';
import type { RunGrant } from '@r2cloud/contracts/adapters';
import { requireThat } from '@r2cloud/contracts/domain';
export async function recordAgentMessage(db: DB, grant: RunGrant, body: string) {
  const bot = await db.users.upsert({
    where: { id: `codex-agent:${grant.projectId}` },
    create: { id: `codex-agent:${grant.projectId}`, name: 'Codex', kind: 'agent' },
    update: {},
  });
  requireThat(bot.kind === 'agent' && !bot.auth_user_id, 409, 'Invalid agent author identity.');
  await db.comments.upsert({
    where: { id: `codex-reply:${grant.runId}` },
    create: {
      id: `codex-reply:${grant.runId}`,
      org_id: grant.orgId,
      project_id: grant.projectId,
      task_id: grant.taskId,
      user_id: bot.id,
      threadId: grant.config.thread?.id,
      body: body.slice(0, 8000),
    },
    update: {},
  });
}
