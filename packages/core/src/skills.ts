import { readdirSync, readFileSync } from 'node:fs';
import { YAML } from 'bun';
import type { DB } from '@r2cloud/database';
import { hash } from '@r2cloud/contracts/hash';
import { requireThat } from '@r2cloud/contracts/domain';
import { skillMentions, type PinnedSkill } from '@r2cloud/contracts/skills';

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
    const description = `Project instructions for ${row.id}`;
    const content = `---\nname: ${row.id}\ndescription: ${description}\n---\n\n${row.instructions}\n`;
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
