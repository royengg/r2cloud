import { readdirSync, readFileSync } from 'node:fs';
import { YAML } from 'bun';
import { prisma, type DB } from '@r2cloud/database';
import { hash, id } from '@r2cloud/contracts/hash';
import { requireThat, type Actor } from '@r2cloud/contracts/domain';
import {
  skillMentions,
  skillDefinition,
  skillCommand,
  type PinnedSkill,
  type SkillCatalogue,
} from '@r2cloud/contracts/skills';
import { access, event } from './project-context';
import { projectAdministrator } from './team';
import { receipt } from './receipt';

export function parseSkillFile(content: string) {
  requireThat(content.length <= 32000, 400, 'Skill files must be at most 32,000 characters.');
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  requireThat(match, 400, 'Use a SKILL.md file with name and description in YAML frontmatter.');
  let metadata;
  try {
    metadata = YAML.parse(match[1]!);
  } catch {
    requireThat(false, 400, 'Invalid skill frontmatter.');
  }
  requireThat(
    metadata && typeof metadata === 'object' && !Array.isArray(metadata),
    400,
    'Invalid skill frontmatter.',
  );
  return skillDefinition.parse({
    name: 'name' in metadata ? metadata.name : undefined,
    description: 'description' in metadata ? metadata.description : undefined,
    instructions: match[2],
  });
}

function definition(name: string, instructions: string) {
  const plain = { name, description: `Project instructions for ${name}`, instructions };
  if (/^\uFEFF?---\r?\n/.test(instructions)) {
    try {
      return { ...parseSkillFile(instructions), name };
    } catch {
      return plain;
    }
  }
  return plain;
}

const root = new URL('../skills/', import.meta.url);

const bundled: PinnedSkill[] = readdirSync(root).map((name) => {
  const content = readFileSync(new URL(`${name}/SKILL.md`, root), 'utf8');
  const { description } = YAML.parse(content.split('---')[1]!) as { description: string };
  return { name, description, source: 'built-in', version: '1', digest: hash(content), content };
});

export async function availableSkills(db: DB, projectId: string): Promise<PinnedSkill[]> {
  const rows = await db.skills.findMany({
    where: { project_id: projectId, enabled: true },
    orderBy: [{ id: 'asc' }, { version: 'desc' }],
  });
  const skills = new Map(bundled.map((skill) => [skill.name, skill]));
  for (const row of rows) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(row.id) ||
      skills.has(row.id) ||
      row.instructions.length > 32000
    )
      continue;
    const { description, instructions } = definition(row.id, row.instructions);
    const content = `---\nname: ${row.id}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}\n`;
    skills.set(row.id, {
      name: row.id,
      description,
      source: 'project',
      version: row.version,
      content,
      digest: hash(content),
    });
  }
  return [...skills.values()];
}

export async function readSkills(actor: Actor, projectId: string): Promise<SkillCatalogue> {
  const project = await access(prisma, actor, projectId);
  const rows = await prisma.skills.findMany({
    where: { project_id: projectId },
    orderBy: [{ enabled: 'desc' }, { version: 'desc' }],
  });
  const skills = new Map(
    bundled.map((skill) => [
      skill.name,
      {
        ...parseSkillFile(skill.content),
        source: skill.source,
        enabled: true,
        version: skill.version,
      },
    ]),
  );
  for (const row of rows)
    if (!skills.has(row.id))
      skills.set(row.id, {
        ...definition(row.id, row.instructions),
        source: 'project',
        enabled: row.enabled,
        version: row.version,
      });
  return {
    manage: project.actor_kind === 'human' && ['owner', 'admin'].includes(project.workspace_role),
    skills: [...skills.values()],
  };
}

export async function importSkill(actor: Actor, projectId: string, content: string) {
  await projectAdministrator(prisma, actor, projectId);
  return parseSkillFile(content);
}

export async function changeSkill(actor: Actor, projectId: string, key: string, raw: unknown) {
  const input = skillCommand.parse(raw);
  await projectAdministrator(prisma, actor, projectId);
  return receipt(actor, projectId, key, input, async (db) => {
    const project = await projectAdministrator(db, actor, projectId);
    requireThat(
      !bundled.some((skill) => skill.name === input.name),
      409,
      'Built-in skills cannot be changed. Choose a different name.',
    );
    const previous = await db.skills.findFirst({
      where: { project_id: projectId, id: input.name },
      orderBy: [{ enabled: 'desc' }, { version: 'desc' }],
    });
    requireThat(
      (previous?.version ?? null) === input.version,
      409,
      'This skill changed. Reload the list before saving.',
    );
    if (!previous)
      requireThat(
        (await db.skills.count({ where: { project_id: projectId } })) < 100,
        409,
        'A project can have up to 100 custom skills.',
      );
    await db.skills.deleteMany({ where: { project_id: projectId, id: input.name } });
    if (input.action === 'save') {
      const content = `---\nname: ${input.name}\ndescription: ${JSON.stringify(input.description)}\n---\n\n${input.instructions}\n`;
      await db.skills.create({
        data: {
          id: input.name,
          version: id(),
          project_id: projectId,
          org_id: project.org_id,
          instructions: content,
          digest: hash(content),
          enabled: input.enabled,
        },
      });
    }
    await event(
      db,
      projectId,
      null,
      actor.id,
      input.action === 'save' ? 'Project skill saved' : 'Project skill deleted',
      { name: input.name },
    );
    return { saved: true };
  });
}

export async function resolveSkills(db: DB, projectId: string, message: string) {
  const names = skillMentions(message);
  if (!names.length) return [];
  const catalogue = await availableSkills(db, projectId);
  const selected = names.flatMap((name) => {
    const skill = catalogue.find((item) => item.name === name);
    requireThat(
      skill || !message.trimStart().toLowerCase().startsWith(`/${name}`),
      400,
      `Skill /${name} is not available in this project.`,
    );
    return skill ? [skill] : [];
  });
  requireThat(selected.length <= 8, 400, 'Use at most eight skills in one message.');
  requireThat(
    selected.reduce((size, skill) => size + skill.content.length, 0) <= 64000,
    400,
    'The selected skills are too large for one message.',
  );
  return selected;
}
