import { recordAgentMessage } from './agent-messages';
import { codexModels } from '@r2cloud/contracts/threads';
import { prisma, json } from '@r2cloud/database';
import { access, event, lockProject } from './project-context';
import { requireThat, type CandidateManifest } from '@r2cloud/contracts/domain';
import type { ExecutionControl } from '@r2cloud/adapters/vercel-execution';
import type { RunGrant, RunResult } from '@r2cloud/contracts/adapters';
import type { CredentialVault } from '@r2cloud/adapters/credential-vault';

export function executionControl(projectId: string, vault: CredentialVault): ExecutionControl {
  return {
    async reply(grant, message) {
      requireThat(grant.projectId === projectId, 403, 'This worker is scoped to another project.');
      await prisma.$transaction(async (db) => {
        await lockProject(db, projectId);
        requireThat(
          await db.runs.count({
            where: {
              id: grant.runId,
              project_id: projectId,
              generation: grant.generation,
              stopped_at: null,
              claims: { released_at: null, tasks: { generation: grant.generation } },
            },
          }),
          409,
          'Execution generation changed.',
        );
        await recordAgentMessage(db, grant, message);
        await event(db, projectId, grant.taskId, null, 'Codex replied', {
          threadId: grant.config.thread?.id,
        });
      });
    },
    async models(grant, models) {
      requireThat(grant.projectId === projectId, 403, 'This worker is scoped to another project.');
      await prisma.executionRuntime.updateMany({
        where: { projectId },
        data: { models: json(codexModels.parse(models)), modelsUpdatedAt: new Date() },
      });
    },
    async authorize(grant) {
      requireThat(grant.projectId === projectId, 403, 'This worker is scoped to another project.');
      const run = await prisma.runs.findFirst({
        where: {
          id: grant.runId,
          generation: grant.generation,
          stopped_at: null,
          claims: { released_at: null, tasks: { generation: grant.generation } },
        },
        include: { claims: true },
      });
      requireThat(run, 409, 'Execution identity is no longer active.');
      await access(prisma, { id: run.claims.owner_id }, projectId, 'contribute');
      const manifest = run.manifest as { connectionId: string };
      const connection = await prisma.provider_connections.findFirst({
        where: {
          id: manifest.connectionId,
          project_id: projectId,
          user_id: run.claims.owner_id,
          enabled: true,
          mode: 'managed',
        },
      });
      requireThat(
        connection?.secret_ref,
        403,
        'The personal Codex connection is no longer available.',
      );
      const linked = await prisma.codexConnection.findFirst({
        where: {
          id: connection.secret_ref,
          userId: run.claims.owner_id,
          projectId,
          state: 'connected',
        },
      });
      requireThat(linked, 403, 'The personal Codex connection was disconnected.');
      const bytes = await vault.read(connection.secret_ref);
      try {
        const auth = JSON.parse(bytes.toString());
        const token = auth.tokens?.access_token;
        const accountId = auth.tokens?.account_id;
        requireThat(
          typeof token === 'string' && typeof accountId === 'string',
          409,
          'Reconnect your Codex account.',
        );
        const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
        requireThat(
          typeof payload.exp === 'number',
          409,
          'Codex credential expiration is unavailable.',
        );
        return {
          accessToken: token,
          accountId,
          plan: linked.plan ?? 'unknown',
          expiresAt: payload.exp * 1000,
        };
      } finally {
        bytes.fill(0);
      }
    },
    async recover(operationId) {
      const allocation = await prisma.sandboxAllocation.findFirst({
        where: { operationId, run: { project_id: projectId } },
        include: { steps: { where: { key: 'result', state: 'finished' } } },
      });
      if (!allocation) return null;
      return {
        identity: { operationId, runId: allocation.runId, generation: allocation.generation },
        result: (allocation.steps[0]?.result as unknown as RunResult) ?? null,
      };
    },
    async previousArtifact(grant) {
      const candidate = await prisma.candidates.findFirst({
        where: {
          id: grant.config.previousCandidate,
          project_id: projectId,
          task_id: grant.taskId,
          generation: { lt: grant.generation },
        },
      });
      requireThat(candidate, 409, 'The previous candidate is unavailable.');
      const manifest = candidate.manifest as unknown as CandidateManifest;
      requireThat(
        !manifest.fixture &&
          manifest.repository === grant.config.repository &&
          manifest.baseSha === grant.config.baseSha &&
          /^[a-f0-9]{64}$/.test(manifest.artifactDigest) &&
          /^[a-f0-9]{40}$/.test(manifest.headSha),
        409,
        'Previous candidate identity is invalid.',
      );
      return { digest: manifest.artifactDigest, headSha: manifest.headSha };
    },
    async progress(grant: RunGrant, message: string) {
      await prisma.$transaction(async (db) => {
        const current = await db.runs.updateMany({
          where: {
            id: grant.runId,
            generation: grant.generation,
            stopped_at: null,
            claims: { released_at: null, tasks: { generation: grant.generation } },
          },
          data: { heartbeat_at: new Date() },
        });
        requireThat(current.count, 409, 'Execution generation changed.');
        await event(db, projectId, grant.taskId, null, message);
      });
    },
  };
}
export async function heartbeatExecution(projectId: string) {
  const expiresAt = new Date(Date.now() + 30000);
  await prisma.executionRuntime.upsert({
    where: { projectId },
    create: { projectId, expiresAt },
    update: { expiresAt },
  });
  const connections = await prisma.codexConnection.findMany({
    where: { projectId, state: 'connected' },
    select: { id: true, userId: true },
  });
  for (const connection of connections) {
    const permitted = await prisma.project_access.count({
      where: { project_id: projectId, user_id: connection.userId, contribute: true },
    });
    if (permitted)
      await prisma.provider_connections.updateMany({
        where: { id: connection.id, project_id: projectId, secret_ref: connection.id },
        data: { enabled: true },
      });
  }
}
