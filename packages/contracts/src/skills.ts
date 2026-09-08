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
