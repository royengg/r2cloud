export type DiffLine = {
  kind: 'context' | 'added' | 'removed' | 'hunk';
  text: string;
  old?: number;
  next?: number;
};
export function diffLines(patch: string): DiffLine[] {
  let old = 0,
    next = 0,
    started = false;
  const rows: DiffLine[] = [];
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      old = Number(hunk[1]);
      next = Number(hunk[2]);
      started = true;
      rows.push({ kind: 'hunk', text });
    } else if (started && text.startsWith('+'))
      rows.push({ kind: 'added', text: text.slice(1), next: next++ });
    else if (started && text.startsWith('-'))
      rows.push({ kind: 'removed', text: text.slice(1), old: old++ });
    else if (started && text.startsWith(' '))
      rows.push({ kind: 'context', text: text.slice(1), old: old++, next: next++ });
    else if (started && text.startsWith('\\')) rows.push({ kind: 'hunk', text });
  }
  return rows;
}
