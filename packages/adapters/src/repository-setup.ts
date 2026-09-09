import { z } from 'zod';
import { executionProfile, type ExecutionProfile } from '@r2cloud/contracts/execution';

export const setupDetectionVersion = 1;
const manifestSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  packageManager: z.string().optional(),
  workspaces: z.unknown().optional(),
});
type Manifest = z.infer<typeof manifestSchema>;
const frameworks = ['next', 'vite', 'astro', '@sveltejs/kit', 'react-scripts'];
function framework(manifest: Manifest) {
  return frameworks.find(
    (name) => manifest.dependencies?.[name] || manifest.devDependencies?.[name],
  );
}
export function detectRepositorySetup(
  files: Record<string, string>,
  directory?: string,
): ExecutionProfile {
  const manifests = Object.entries(files)
    .filter(([path]) => path === 'package.json' || path.endsWith('/package.json'))
    .map(([path, content]) => ({
      directory: path.slice(0, -13) || '.',
      manifest: manifestSchema.parse(JSON.parse(content)),
    }));
  const root = manifests.find((entry) => entry.directory === '.');
  const apps = manifests.filter(
    ({ manifest }) => framework(manifest) && (manifest.scripts?.dev || manifest.scripts?.start),
  );
  const selected = directory
    ? manifests.find((entry) => entry.directory === directory)
    : apps.length === 1
      ? apps[0]
      : apps.length === 0 && (root?.manifest.scripts?.dev || root?.manifest.scripts?.start)
        ? root
        : undefined;
  if (!selected)
    throw new Error(
      apps.length > 1
        ? `Choose an app directory: ${apps.map((app) => app.directory).join(', ')}. Use repository_setup with a directory, or provide explicit commands.`
        : 'No unambiguous web app setup was found. Read the repository instructions and provide commands through repository_setup.',
    );
  const app = selected.manifest;
  if (!app.scripts?.dev && !app.scripts?.start)
    throw new Error(
      'The selected directory has no dev or start script. Provide explicit commands through repository_setup.',
    );
  const installDirectory =
    root?.manifest.workspaces || 'pnpm-workspace.yaml' in files ? '.' : selected.directory;
  const path = (name: string) => (installDirectory === '.' ? name : `${installDirectory}/${name}`);
  const declared = (root?.manifest.packageManager ?? app.packageManager)?.split('+')[0];
  const locks = [
    ['bun', 'bun.lock'],
    ['bun', 'bun.lockb'],
    ['npm', 'package-lock.json'],
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
  ].filter(([, name]) => path(name!) in files);
  const managers = [...new Set(locks.map(([manager]) => manager))];
  const manager =
    declared?.split('@')[0] ??
    (managers.length === 1 ? managers[0] : managers.length === 0 ? 'npm' : undefined);
  if (!manager || !['npm', 'bun', 'pnpm', 'yarn'].includes(manager))
    throw new Error(
      'Package manager is ambiguous. Specify packageManager in package.json or provide explicit setup commands.',
    );
  const pinned = declared?.match(/^(npm|bun|pnpm|yarn)@(\d+\.\d+\.\d+)$/);
  if ((declared || ['pnpm', 'yarn'].includes(manager)) && !pinned)
    throw new Error(
      `Declare an exact ${manager} version in package.json or provide explicit setup commands.`,
    );
  function command(args: string[]) {
    if (pinned && declared !== 'bun@1.4.2') {
      const pkg =
        manager === 'yarn' && Number(pinned[2]!.split('.')[0]) >= 2
          ? `@yarnpkg/cli-dist@${pinned[2]}`
          : declared!;
      return { cmd: 'npm', args: ['exec', '--yes', `--package=${pkg}`, '--', manager!, ...args] };
    }
    return { cmd: manager!, args };
  }
  const kind = framework(app);
  const script = app.scripts?.dev ? 'dev' : 'start';
  const devText = app.scripts?.[script] ?? '';
  const portFlag = devText.match(/--port(?:=|\s+)(\d+)\b/);
  const port = portFlag ? Number(portFlag[1]) : 3000;
  const flags: string[] = [];
  if (kind && kind !== 'react-scripts') {
    if (!/--(?:host|hostname)(?:=|\s|$)/.test(devText))
      flags.push(kind === 'next' ? '--hostname' : '--host', '0.0.0.0');
    if (!portFlag) flags.push('--port', String(port));
  }
  const check = ['build', 'typecheck', 'lint', 'test'].find((name) => app.scripts?.[name]);
  if (!check)
    throw new Error(
      'No build, typecheck, lint or test script was found. Provide a verification command through repository_setup.',
    );
  const checkFlags = check === 'test' && /\bvitest\b/.test(app.scripts!.test!) ? ['--run'] : [];
  const run = (name: string, args: string[]) =>
    command(['run', name, ...(manager === 'npm' && args.length ? ['--'] : []), ...args]);
  const locked = locks.some(([name]) => name === manager);
  const install =
    manager === 'npm'
      ? [locked ? 'ci' : 'install']
      : [
          'install',
          ...(locked
            ? [
                manager === 'yarn' && Number(pinned?.[2]?.split('.')[0]) >= 2
                  ? '--immutable'
                  : '--frozen-lockfile',
              ]
            : []),
        ];
  return executionProfile.parse({
    directory: selected.directory,
    install: { ...command(install), directory: installDirectory },
    dev: run(script, flags),
    tests: [run(check, checkFlags)],
    port,
    healthPath: '/',
    maxMinutes: 10,
    maxBudgetCents: 0,
    vcpus: 2,
  });
}
async function read(response: Response, limit: number) {
  if (!response.ok)
    throw new Error(
      'Repository setup files are unavailable. The pilot supports public repositories.',
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body!.getReader();
  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    size += chunk.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Repository setup metadata is too large. Provide explicit setup commands.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}
export async function discoverRepositorySetup(
  repository: string,
  baseSha: string,
  directory?: string,
) {
  if (!/^[-\w.]+\/[-\w.]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(baseSha))
    throw new Error('Invalid repository identity.');
  const signal = AbortSignal.timeout(10000);
  const response = await fetch(
    `https://api.github.com/repos/${repository}/git/trees/${baseSha}?recursive=1`,
    { signal },
  );
  const tree = JSON.parse(await read(response, 1024 * 1024)) as {
    truncated?: boolean;
    tree: { path: string; type: string }[];
  };
  if (tree.truncated)
    throw new Error('Repository file listing is incomplete. Provide explicit setup commands.');
  const paths = tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path);
  const manifests = paths.filter((path) =>
    directory
      ? path === 'package.json' || path === `${directory}/package.json`
      : /^(?:(?:apps|packages)\/[^/]+\/)?package\.json$/.test(path),
  );
  if (manifests.length > 12)
    throw new Error(
      'Choose an app directory or provide explicit setup commands for this workspace.',
    );
  const files: Record<string, string> = Object.fromEntries(
    paths
      .filter((path) =>
        /(^|\/)(bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pnpm-workspace\.yaml)$/.test(
          path,
        ),
      )
      .map((path) => [path, '']),
  );
  await Promise.all(
    manifests.map(async (path) => {
      files[path] = await read(
        await fetch(
          `https://raw.githubusercontent.com/${repository}/${baseSha}/${path.split('/').map(encodeURIComponent).join('/')}`,
          { signal },
        ),
        64 * 1024,
      );
    }),
  );
  return detectRepositorySetup(files, directory);
}
