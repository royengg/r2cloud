import {
  executionProfile,
  ensureExecutionSetup,
  readExecutionSetup,
  saveExecutionSetup,
} from './execution-setup';
import { z } from 'zod';
import { previewInspection } from '@r2cloud/contracts/preview-inspection';
import { prisma, json } from '@r2cloud/database';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import { agentWorkDeadline, type AgentGrant } from '@r2cloud/contracts/agent';
import { access, lockProject, event } from './project-context';
import { activeAgentTurn } from './agent-turns';
import { id, digest } from '@r2cloud/contracts/hash';
import { setTimeout as pause } from 'node:timers/promises';

const definitions = {
  repository_setup: {
    description:
      'Call with {} to inspect or automatically detect repository startup settings; do not supply config unless detection or startup has failed, or the user requested an override. Supply a repository-relative directory to resolve an ambiguous monorepo. To change commands, supply config and obtain inline user approval. Saved command overrides apply to subsequent runs; existing implementation checks remain pinned. Read repository instructions and environment examples when detection or startup fails. Never invent secret values.',
    schema: z
      .object({ directory: z.string().max(200).optional(), config: executionProfile.optional() })
      .strict(),
  },
  inspect_preview: {
    description:
      'Inspect a path in the running project preview. Returns an accessibility snapshot, JavaScript errors and a screenshot from an isolated browser. External websites and product login sessions are unavailable.',
    schema: previewInspection,
  },
  start_preview: {
    description:
      'Start or restart the project preview without claiming an implementation task. Automatically detects missing setup; call this first for preview requests rather than configuring commands yourself. Uses the current task checkout when available; otherwise restores the task’s saved candidate when available, or the connected repository base commit. The response identifies which source is served; merging is not required to preview a candidate. Returns readiness for the project preview button; never invent a URL.',
    schema: z.object({}).strict(),
  },
  ask_user: {
    description: 'Ask a focused question inline and wait for the user’s answer in this thread.',
    schema: z.object({ question: z.string().min(1).max(2000) }).strict(),
  },
  read_repository: {
    description:
      'Read a file or list a directory at the connected repository’s pinned base commit without claiming implementation. Public repositories are supported in the pilot.',
    schema: z.object({ path: z.string().max(300).default('') }).strict(),
  },
  project_context: {
    description:
      'Read the current project, selected task and board summary. Refresh facts before planning or acting.',
    schema: z.object({}).strict(),
  },
  list_tasks: {
    description:
      'Search tasks on this project board. Returns authoritative states, priorities and ownership.',
    schema: z
      .object({
        query: z.string().max(200).optional(),
        state: z.string().max(30).optional(),
        offset: z.number().int().min(0).max(10000).default(0),
      })
      .strict(),
  },
  read_task: {
    description: 'Read one project task, acceptance criteria, dependencies and current owner.',
    schema: z.object({ taskId: z.string().min(1).max(100) }).strict(),
  },
  create_task: {
    description:
      'Create a task the user requested. This saves it immediately; identical requests in this thread return the existing task. Use the returned task ID and version to start implementation, which requires separate approval.',
    schema: z
      .object({
        title: z.string().trim().min(1).max(160),
        outcome: z.string().trim().min(1).max(8000),
        criteria: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
        priority: z.enum(['High', 'Medium', 'Low']).default('Medium'),
      })
      .strict(),
  },
  start_task: {
    description:
      'Request exclusive implementation of a specific task. Obtain the task version first. The checked service grants the isolated checkout after confirmation.',
    schema: z
      .object({
        taskId: z.string().min(1).max(100),
        version: z.number().int().positive(),
        summary: z.string().trim().min(1).max(2000),
      })
      .strict(),
  },
};
export const agentTools = Object.entries(definitions).map(([name, d]) => ({
  type: 'function',
  name,
  description: d.description,
  inputSchema: z.toJSONSchema(d.schema),
}));
export async function waitForAgentResponse(
  grant: AgentGrant,
  sourceId: string,
  kind: string,
  prompt: string,
  detail: unknown,
) {
  await activeAgentTurn(grant);
  const request = await prisma.$transaction(async (db) => {
    await lockProject(db, grant.projectId);
    requireThat(
      await db.agentTurn.count({
        where: {
          id: grant.id,
          stoppedAt: null,
          stopRequested: false,
          state: { in: ['running', 'waiting'] },
        },
      }),
      409,
      'This turn is no longer accepting requests.',
    );
    const request = await db.agentRequest.upsert({
      where: { turnId_sourceId: { turnId: grant.id, sourceId } },
      create: { id: id(), turnId: grant.id, sourceId, kind, prompt, detail: json(detail) },
      update: {},
    });
    requireThat(
      request.kind === kind &&
        request.prompt === prompt &&
        digest(request.detail) === digest(detail),
      409,
      'The agent request changed. A new approval is required.',
    );
    await db.agentTurn.update({ where: { id: grant.id }, data: { state: 'waiting' } });
    await event(db, grant.projectId, grant.taskId, null, 'Agent needs your response', {
      threadId: grant.threadId,
    });
    return request;
  });
  const deadline = agentWorkDeadline(grant);
  while (Date.now() < deadline) {
    const turn = await activeAgentTurn(grant);
    if (turn.stopRequested) throw new Error('Turn stopped while waiting for a response.');
    const current = await prisma.agentRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (current.response) {
      await prisma.$transaction(async (db) => {
        await db.agentTurn.update({ where: { id: grant.id }, data: { state: 'running' } });
        await event(db, grant.projectId, grant.taskId, null, 'Agent turn resumed', {
          threadId: grant.threadId,
        });
      });
      return current.response as { approved?: boolean; answers?: Record<string, string[]> };
    }
    await pause(500);
  }
  throw new Error('The response window expired. Continue in this thread to try again.');
}
export async function callAgentTool(
  grant: AgentGrant,
  callId: string,
  name: string,
  args: unknown,
) {
  await activeAgentTurn(grant);
  const def = definitions[name as keyof typeof definitions];
  requireThat(def, 400, 'This tool is not available.');
  const input = def.schema.parse(args) as Record<string, any>;
  const actor = { id: grant.actorId } as Actor;
  const project = await access(prisma, actor, grant.projectId, 'contribute');
  if (name === 'repository_setup') {
    if (input.config) {
      const previous = await prisma.execution_profiles.findUnique({
        where: { project_id: grant.projectId },
        select: { version: true },
      });
      const response = await waitForAgentResponse(
        grant,
        callId,
        'approval',
        'Use these repository setup commands?',
        { config: input.config },
      );
      requireThat(response.approved, 403, 'Repository setup was not approved.');
      await saveExecutionSetup(actor, grant.projectId, `setup:${grant.id}:${callId}`, {
        version: previous?.version ?? 0,
        config: input.config,
      });
    } else await ensureExecutionSetup(actor, grant.projectId, input.directory);
    const setup = await readExecutionSetup(actor, grant.projectId);
    return {
      profile: setup.profile,
      note: 'Settings apply to new runs. Existing implementation checks remain pinned. Supply missing app secrets explicitly; setup does not create them.',
    };
  }
  if (name === 'ask_user') {
    const response = await waitForAgentResponse(grant, callId, 'question', input.question, {
      questions: [{ id: 'answer', question: input.question }],
    });
    return { answer: response.answers?.answer ?? [] };
  }
  if (name === 'read_repository') {
    requireThat(project.repo_id, 409, 'Connect a repository first.');
    const repository = await prisma.repositories.findUniqueOrThrow({
      where: { id: project.repo_id },
    });
    requireThat(
      !input.path.split('/').some((part: string) => part === '..') && !input.path.startsWith('/'),
      400,
      'Use a relative repository path.',
    );
    const path = input.path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(
      `https://api.github.com/repos/${repository.full_name}/contents/${path}?ref=${encodeURIComponent(repository.base_sha)}`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) },
    );
    requireThat(
      response.ok,
      409,
      'The file is unavailable. The pilot supports public repository reads.',
    );
    const body = await response.text();
    requireThat(body.length < 1024 * 1024, 400, 'Choose a smaller file or directory.');
    const content = JSON.parse(body);
    if (Array.isArray(content))
      return {
        baseSha: repository.base_sha,
        entries: content
          .slice(0, 200)
          .map(({ name, path, type }: { name: string; path: string; type: string }) => ({
            name,
            path,
            type,
          })),
        truncated: content.length > 200,
      };
    requireThat(
      content.type === 'file' && content.encoding === 'base64' && content.size <= 128000,
      400,
      'Choose a text file smaller than 128 KB.',
    );
    return {
      baseSha: repository.base_sha,
      path: content.path,
      text: Buffer.from(content.content, 'base64').toString('utf8'),
    };
  }
  if (name === 'start_preview') return { preview: true };
  if (name === 'inspect_preview') return input;
  if (name === 'project_context')
    return {
      projectId: project.id,
      name: project.name,
      selectedTaskId: grant.taskId,
      states: await prisma.tasks.groupBy({
        by: ['state'],
        where: { project_id: project.id },
        _count: true,
      }),
      capturedAt: new Date().toISOString(),
    };
  if (name === 'list_tasks')
    return prisma.tasks.findMany({
      where: {
        project_id: project.id,
        ...(input.query ? { title: { contains: input.query, mode: 'insensitive' as const } } : {}),
        ...(input.state ? { state: input.state } : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: input.offset,
      take: 30,
      select: {
        id: true,
        title: true,
        state: true,
        priority: true,
        version: true,
        claims: {
          where: { released_at: null },
          select: { owner_id: true, users: { select: { name: true } } },
        },
      },
    });
  if (name === 'read_task') {
    const task = await prisma.tasks.findFirst({
      where: { id: input.taskId, project_id: project.id },
      include: {
        claims: {
          where: { released_at: null },
          select: { owner_id: true, users: { select: { name: true } } },
        },
      },
    });
    requireThat(task, 404, 'Task not found in this project.');
    return {
      ...task,
      dependencies: await prisma.dependencies.findMany({
        where: { project_id: project.id, task_id: task.id },
        select: { depends_on: true },
      }),
    };
  }
  if (name === 'create_task') {
    return prisma.$transaction(async (db) => {
      await lockProject(db, project.id);
      await access(db, actor, project.id, 'contribute');
      requireThat(
        await db.agentTurn.count({
          where: {
            id: grant.id,
            stoppedAt: null,
            stopRequested: false,
            state: { in: ['running', 'waiting'] },
          },
        }),
        409,
        'This turn is no longer accepting work.',
      );
      const taskId = digest({
        projectId: project.id,
        threadId: grant.threadId,
        actorId: actor.id,
        action: 'create_task',
        input,
      }).slice(0, 40);
      const saved = await db.tasks.findUnique({
        where: { id: taskId },
        select: { id: true, title: true, version: true },
      });
      if (saved) return saved;
      const matches = await db.tasks.findMany({
        where: {
          project_id: project.id,
          title: input.title,
          outcome: input.outcome,
          criteria: { equals: input.criteria },
          priority: input.priority,
        },
        select: { id: true, title: true, version: true },
      });
      if (matches.length) {
        const created = await db.events.findFirst({
          where: {
            project_id: project.id,
            actor_id: actor.id,
            kind: 'Task created',
            task_id: { in: matches.map((task) => task.id) },
            detail: { path: ['threadId'], equals: grant.threadId },
          },
          orderBy: { id: 'asc' },
          select: { task_id: true },
        });
        const existing = matches.find((task) => task.id === created?.task_id);
        if (existing) return existing;
      }
      const task = await db.tasks.upsert({
        where: { id: taskId },
        create: {
          id: taskId,
          org_id: project.org_id,
          project_id: project.id,
          title: input.title,
          outcome: input.outcome,
          criteria: json(input.criteria),
          priority: input.priority,
        },
        update: {},
      });
      await event(db, project.id, task.id, actor.id, 'Task created', { threadId: grant.threadId });
      return { id: task.id, title: task.title, version: task.version };
    });
  }
  return { implementation: input };
}
