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
const sessionControl = agentControl(projectId, vault);
const sessions = new AgentSession(
  { token, teamId, projectId: vercelProjectId },
  image,
  new PostgresSandboxJournal(),
  sessionControl,
  agentTools,
);
let stopping = false;
process.on('SIGTERM', () => (stopping = true));
process.on('SIGINT', () => (stopping = true));
let checking = false;
async function heartbeat() {
  if (checking || stopping) return;
  checking = true;
  try {
    const response = await fetch(`https://api.vercel.com/v2/teams/${encodeURIComponent(teamId!)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok && (await response.json()).billing?.plan === 'hobby')
      await heartbeatExecution(projectId!);
  } finally {
    checking = false;
  }
}
await heartbeat();
const timer = setInterval(() => void heartbeat().catch(() => {}), 10000);
console.log('Managed execution worker ready for the configured project');
try {
  while (!stopping) {
    try {
      if (
        !(await runAgentTurn(sessions, sessionControl, projectId)) &&
        !(await executeOne(backend, projectId))
      )
        await pause(750);
    } catch {
      console.error('Managed execution processing deferred.');
      await pause(1000);
    }
  }
} finally {
  clearInterval(timer);
  await prisma.executionRuntime.updateMany({
    where: { projectId },
    data: { expiresAt: new Date(0) },
  });
  await prisma.$disconnect();
}
