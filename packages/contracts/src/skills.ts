import { z } from 'zod';

export const skillDefinition = z
  .object({
    name: z
      .string()
      .trim()
      .regex(
        /^[a-z][a-z0-9-]{0,63}$/,
        'Use lowercase letters, numbers and hyphens, starting with a letter.',
      ),
    description: z.string().trim().min(1).max(500),
    instructions: z.string().trim().min(1).max(28000),
  })
  .strict();

export const skillCommand = z.discriminatedUnion('action', [
  skillDefinition.extend({
    action: z.literal('save'),
    version: z.string().max(100).nullable(),
    enabled: z.boolean(),
  }),
  z
    .object({
      action: z.literal('delete'),
      name: skillDefinition.shape.name,
      version: z.string().min(1).max(100),
    })
    .strict(),
]);

export type ManagedSkill = Skill & { instructions: string; version: string; enabled: boolean };
export type SkillCatalogue = { manage: boolean; skills: ManagedSkill[] };

export type Skill = {
  name: string;
  description: string;
  source: 'built-in' | 'project';
};

export type PinnedSkill = Skill & { version: string; digest: string; content: string };

export function skillMentions(text: string) {
  const prose = text.replace(
    /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*(?:`|(?=\n)|$)/g,
    ' ',
  );
  return [
    ...new Set(
      Array.from(prose.matchAll(/(?:^|\s)\/([a-z][a-z0-9-]{0,63})(?=\s|$|[,.!?](?:\s|$))/gi), (m) =>
        m[1]!.toLowerCase(),
      ),
    ),
  ];
}
