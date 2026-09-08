import { prisma, json, Prisma, schema } from '@r2cloud/database';
import type { AgentGrant } from '@r2cloud/contracts/agent';
import { requireThat } from '@r2cloud/contracts/domain';
import { id } from '@r2cloud/contracts/hash';
import { lockProject } from './project-context';

export type ProviderEvent = {
  seq: number;
  message: { method?: string; id?: string | number; params?: Record<string, any> };
};
export async function recordAgentEvents(grant: AgentGrant, events: ProviderEvent[]) {
  await prisma.$transaction(async (db) => {
    const project = await lockProject(db, grant.projectId);
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
    const sourceIds = events.map(({ message }) =>
      String(
        message.params?.itemId ??
          message.params?.item?.id ??
          (message.method === 'turn/plan/updated' ? 'plan' : ''),
      ),
    );
    const existingItems = await db.agentItem.findMany({
      where: { turnId: grant.id, sourceId: { in: sourceIds } },
    });
    const items = new Map(existingItems.map((item) => [item.sourceId, item]));
    const changed = new Set<string>();
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
          : rawItem.tool === 'inspect_preview' && Array.isArray(rawItem.contentItems)
            ? {
                ...rawItem,
                contentItems: rawItem.contentItems.filter(
                  (content: { type?: string }) => content.type !== 'inputImage',
                ),
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
        const existing = items.get(sourceId);
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
        items.set(sourceId, {
          id: existing?.id ?? id(),
          turnId: grant.id,
          sourceId,
          kind,
          text,
          status,
          detail:
            item.id || method === 'turn/plan/updated'
              ? item.id
                ? item
                : p
              : (existing?.detail ?? {}),
          revision: existing?.revision ?? 0n,
        });
        changed.add(sourceId);
      }
      cursor = seq;
    }
    if (changed.size) {
      const rows = [...changed].map((sourceId) => {
        const item = items.get(sourceId)!;
        return Prisma.sql`(${item.id}, ${item.turnId}, ${item.sourceId}, ${item.kind}, ${item.text}, ${item.status}, ${JSON.stringify(item.detail)}::jsonb)`;
      });
      await db.$executeRaw(Prisma.sql`
        INSERT INTO ${Prisma.raw(`"${schema}"."agent_items"`)} (id, turn_id, source_id, kind, text, status, detail)
        VALUES ${Prisma.join(rows)}
        ON CONFLICT (turn_id, source_id) DO UPDATE SET
          kind = EXCLUDED.kind, text = EXCLUDED.text, status = EXCLUDED.status, detail = EXCLUDED.detail
      `);
    }
    await db.agentTurn.update({
      where: { id: grant.id },
      data: { lastSequence: cursor, heartbeatAt: new Date() },
    });
    if (cursor !== turn.lastSequence)
      await db.events.create({
        data: {
          org_id: project.org_id,
          project_id: grant.projectId,
          task_id: grant.taskId,
          kind: 'Agent timeline updated',
          detail: json({
            threadId: grant.threadId,
            turnId: grant.id,
            itemIds: [...changed].map((sourceId) => items.get(sourceId)!.id),
          }),
        },
      });
  });
}
