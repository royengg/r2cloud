export type ReviewFile = { path: string; added: number | null; removed: number | null };
export type ReviewCommit = { sha: string; author: string; date: string; subject: string };
export type ReviewIndex = { files: ReviewFile[]; commits: ReviewCommit[] };
export type ReviewSnapshot = {
  id: string;
  taskId: string;
  title: string;
  headSha: string;
  baseSha: string;
  branch: string;
  targetRef: string;
  createdAt: string;
  fixture: boolean;
  publication: { number: number; url: string | null; merged: boolean } | null;
};
export type ReviewDiff = { patch: string; unavailable: string | null };
