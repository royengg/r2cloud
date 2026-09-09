import { readFileSync } from 'node:fs';
import type { Sandbox } from '@vercel/sandbox';
import type { ExecutionProfile } from '@r2cloud/contracts/execution';
import { sandboxPath } from './sandbox-bun';

const supervisor = readFileSync(new URL('./preview-supervisor.ts', import.meta.url), 'utf8');
export class RepositoryPreview {
  private retained = false;
  constructor(
    private sandbox: Sandbox,
    readonly setup: ExecutionProfile,
    private deadline: number,
    private independent = false,
    readonly source?: {
      kind: 'repository-base' | 'task-candidate' | 'task-checkout';
      commit?: string;
    },
  ) {}
  async start(snapshot = this.retained) {
    if (snapshot) this.retained = true;
    const timeout = Math.min(45000, this.deadline - Date.now() - 20000);
    if (timeout < 1000) throw new Error('The sandbox is about to expire.');
    const result = await this.sandbox.currentSession().runCommand({
      cmd: 'bun',
      args: [
        '-e',
        supervisor,
        '--',
        JSON.stringify({
          snapshot,
          independent: this.independent,
          path: sandboxPath,
          directory: this.setup.directory,
          cmd: this.setup.dev.cmd,
          args: this.setup.dev.args,
          port: this.setup.port,
          healthPath: this.setup.healthPath,
          timeout,
        }),
      ],
      sudo: true,
      timeoutMs: timeout + 10000,
      signal: AbortSignal.timeout(timeout + 15000),
    });
    if (result.exitCode !== 0)
      throw new Error(
        `The dev server did not become ready. Check the command, port, health path and required environment variables. ${(await result.stdout()).slice(-4000)}`.trim(),
      );
  }
  async stop() {
    const result = await this.sandbox.currentSession().runCommand({
      cmd: 'bun',
      args: ['-e', supervisor, '--', '{"stop":true}'],
      sudo: true,
      timeoutMs: 10000,
      signal: AbortSignal.timeout(15000),
    });
    if (result.exitCode !== 0) throw new Error('The preview process could not be stopped.');
  }
}
