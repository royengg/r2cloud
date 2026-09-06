import { prisma, json } from '@r2cloud/database';
import type { AgentGrant } from '@r2cloud/contracts/agent';
import { requireThat } from '@r2cloud/contracts/domain';
import { id } from '@r2cloud/contracts/hash';
import { event, lockProject } from './project-context';

export type ProviderEvent = {
  seq: number;
  message: { method?: string; id?: string | number; params?: Record<string, any> };
};
export async function recordAgentEvents(grant: AgentGrant, events: ProviderEvent[]) {
  await prisma.$transaction(async (db) => {
    await lockProject(db, grant.projectId);
    const turn = await db.agentTurn.findUniqueOrThrow({ where: { id: grant.id } });
    requireThat(
      !turn.stoppedAt &&
        ['running', 'waiting'].includes(turn.state) &&
        turn.projectId === grant.projectId &&
        turn.threadId === grant.threadId &&
        turn.actorId === grant.actorId,
      409,
      'The agent turn has stopped.',
    );
    let cursor = turn.lastSequence;
    for (const { seq, message } of events) {
      if (seq <= cursor) continue;
      requireThat(seq === cursor + 1, 409, 'Provider event sequence has a gap.');
      const p = message.params ?? {};
      const rawItem = p.item ?? {};
      const item =
        rawItem.type === 'reasoning'
          ? {
              id: rawItem.id,
              type: rawItem.type,
              summary: rawItem.summary,
              text: Array.isArray(rawItem.summary) ? rawItem.summary.join('\n') : '',
            }
          : rawItem;
      const sourceId = String(
        p.itemId ?? item.id ?? (message.method === 'turn/plan/updated' ? 'plan' : ''),
      );
      const method = message.method ?? '';
      if (
        sourceId &&
        (method.startsWith('item/') || method === 'turn/plan/updated') &&
        message.id === undefined &&
        method !== 'item/reasoning/textDelta'
      ) {
        const existing = await db.agentItem.findUnique({
          where: { turnId_sourceId: { turnId: grant.id, sourceId } },
        });
        const kind = method.includes('reasoning')
          ? 'reasoning'
          : method.includes('plan')
            ? 'plan'
            : (item.type ??
              existing?.kind ??
              (method.includes('agentMessage') ? 'agentMessage' : 'tool'));
        const delta = typeof p.delta === 'string' ? p.delta : '';
        const full =
          typeof item.text === 'string'
            ? item.text
            : typeof item.aggregatedOutput === 'string'
              ? item.aggregatedOutput
              : undefined;
        const text = (full ?? (existing?.text ?? '') + delta).slice(0, 64000);
        const status = method === 'item/completed' ? (item.status ?? 'completed') : 'running';
        await db.agentItem.upsert({
          where: { turnId_sourceId: { turnId: grant.id, sourceId } },
          create: {
            id: id(),
            turnId: grant.id,
            sourceId,
            kind,
            text,
            status,
            detail: json(item.id ? item : method === 'turn/plan/updated' ? p : {}),
          },
          update: {
            kind,
            text,
            status,
            ...(item.id || method === 'turn/plan/updated'
              ? { detail: json(item.id ? item : p) }
              : {}),
          },
        });
      }
      cursor = seq;
    }
    await db.agentTurn.update({
      where: { id: grant.id },
      data: { lastSequence: cursor, heartbeatAt: new Date() },
    });
    if (cursor !== turn.lastSequence)
      await event(db, grant.projectId, grant.taskId, null, 'Agent timeline updated', {
        threadId: grant.threadId,
        turnId: grant.id,
      });
  });
}
