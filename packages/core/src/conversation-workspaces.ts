import { z } from 'zod';
import { id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { receipt } from './receipt';
import { access, event } from './project-context';

const workspaceInput = z.object({ title: z.string().trim().min(1).max(80) }).strict();

export function createConversationWorkspace(
  actor: Actor,
  projectId: string,
  key: string,
  raw: unknown,
) {
  const input = workspaceInput.parse(raw);
  return receipt(actor, projectId, key, { action: 'create_workspace', input }, async (db) => {
    await access(db, actor, projectId, 'contribute');
    requireThat(
      (await db.conversationWorkspace.count({ where: { projectId, createdBy: actor.id } })) < 100,
      409,
      'Workspace limit reached.',
    );
    const workspace = await db.conversationWorkspace.create({
      data: { id: id(), projectId, createdBy: actor.id, title: input.title },
    });
    await event(db, projectId, null, actor.id, 'Conversation workspace created', {
      workspaceId: workspace.id,
    });
    return workspace;
  });
}
