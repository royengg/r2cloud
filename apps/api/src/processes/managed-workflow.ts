import { randomUUID } from 'node:crypto';
import { Fault } from '@r2cloud/contracts/domain';
import { lockProject } from '@r2cloud/core/project-context';
import { maintainAgentRuntimes } from '@r2cloud/core/agent-runtimes';
import { AgentSession } from '@r2cloud/adapters/agent-session';
import { agentControl, runAgentTurn } from '@r2cloud/core/agent-worker';
import { agentTools } from '@r2cloud/core/agent-tools';
import { resolve, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { prisma } from '@r2cloud/database';
import { CredentialVault } from '@r2cloud/adapters/credential-vault';
import { VercelCodexExecution } from '@r2cloud/adapters/vercel-execution';
import { executionControl, heartbeatExecution } from '@r2cloud/core/managed-execution';
import { PostgresSandboxJournal } from '@r2cloud/core/sandbox-journal';
import { executeOne } from '@r2cloud/core/workflow';
const projectId = process.env.R2_EXECUTION_PROJECT_ID;
const token = process.env.R2_VERCEL_TOKEN;
const teamId = process.env.R2_VERCEL_TEAM_ID;
const vercelProjectId = process.env.R2_VERCEL_PROJECT_ID;
const image = process.env.R2_VERCEL_IMAGE;
if (!projectId || !token || !teamId || !vercelProjectId || !image)
  throw new Error('Configure the project-scoped managed worker.');
const vault = new CredentialVault(
  join(resolve(process.env.R2_CODEX_BROKER_DIR ?? '.local/codex-broker'), 'vault'),
  process.env.R2_CODEX_VAULT_KEY ?? '',
);
const backend = new VercelCodexExecution(
  { token, teamId, projectId: vercelProjectId },
  image,
  resolve('.local/artifacts'),
  new PostgresSandboxJournal(),
  executionControl(projectId, vault),
);
const owner = randomUUID();
const sessionControl = agentControl(projectId, vault, owner);
const sessions = new AgentSession(
  { token, teamId, projectId: vercelProjectId },
  image,
  new PostgresSandboxJournal(owner),
  sessionControl,
  agentTools,
  undefined,
  process.env.R2_VERCEL_SNAPSHOT_ID,
);
let stopping = false;
const abort = new AbortController();
function report(operation: string, error: unknown) {
  const name = error instanceof Error ? error.constructor.name : 'UnknownError';
  const category = [
    'AbortError',
    'TimeoutError',
    'TypeError',
    'PrismaClientKnownRequestError',
    'PrismaClientInitializationError',
    'Fault',
    'Uncertain',
  ].includes(name)
    ? name
    : 'Error';
  console.error(
    JSON.stringify({
      operation,
      category,
      status: error instanceof Fault ? error.status : undefined,
      projectId,
      owner,
    }),
  );
}
let shutdown: Promise<unknown> | undefined;
function stop() {
  if (stopping) return;
  stopping = true;
  abort.abort();
  shutdown = prisma
    .$transaction(async (db) => {
      await lockProject(db, projectId!);
      await db.agentTurn.updateMany({
        where: { projectId, stoppedAt: null, runtime: { owner } },
        data: { stopRequested: true },
      });
    })
    .catch((error) => report('request_shutdown', error));
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
let checking = false;
async function heartbeat() {
  if (checking || stopping) return;
  checking = true;
  try {
    const response = await fetch(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId!)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Fault(response.status, 'Vercel team lookup failed.');
    if ((await response.json()).billing?.plan !== 'hobby')
      throw new Fault(403, 'Vercel pilot requires Hobby capacity.');
    await heartbeatExecution(projectId!);
  } finally {
    checking = false;
  }
}
let maintaining = false;
async function maintain() {
  if (maintaining || stopping) return;
  maintaining = true;
  try {
    await maintainAgentRuntimes(sessions, sessionControl, projectId!, owner);
  } finally {
    maintaining = false;
  }
}
await heartbeat();
await maintain();
const cleanupTimer = setInterval(
  () => void maintain().catch((error) => report('runtime_maintenance', error)),
  5000,
);
const timer = setInterval(
  () => void heartbeat().catch((error) => report('worker_heartbeat', error)),
  10000,
);
console.log('Managed execution worker ready for the configured project');
const processing = new Set<string>();
async function processTurns() {
  while (!stopping) {
    try {
      if (
        !(await runAgentTurn(
          sessions,
          sessionControl,
          projectId!,
          owner,
          processing,
          abort.signal,
        )) &&
        !stopping &&
        !(await executeOne(backend, projectId!))
      )
        await pause(750);
    } catch (error) {
      report('process_turn', error);
      await pause(1000);
    }
  }
}
try {
  await Promise.all([processTurns(), processTurns()]);
} finally {
  await shutdown;
  clearInterval(timer);
  clearInterval(cleanupTimer);
  while (maintaining || checking) await pause(50);
  const idle = await prisma.agentRuntime.findMany({
    where: { projectId, owner, stoppedAt: null },
    include: { turns: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  for (const runtime of idle) {
    const grant = runtime.turns[0]?.grant as unknown as
      import('@r2cloud/contracts/agent').AgentGrant | undefined;
    if (grant)
      await sessions
        .retire({ ...grant, runtimeId: runtime.id })
        .catch((error) => report('retire_runtime', error));
  }
  await prisma.executionRuntime.updateMany({
    where: { projectId },
    data: { expiresAt: new Date(0) },
  });
  await prisma.$disconnect();
}
