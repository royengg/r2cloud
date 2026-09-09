import { prisma } from '@r2cloud/database';
import { requireThat, type Actor, type CandidateManifest } from '@r2cloud/contracts/domain';
import type { ReviewSnapshot } from '@r2cloud/contracts/review';
import { digest } from '@r2cloud/contracts/hash';
import { savedGitReview } from '@r2cloud/adapters/git-review';
import { access } from './project-context';

export async function readReview(
  actor: Actor,
  projectId: string,
  input: { thread?: string; snapshot?: string; file?: string; commit?: string },
) {
  await access(prisma, actor, projectId);
  const thread = input.thread
    ? await prisma.conversationThread.findFirst({
        where: { id: input.thread, projectId, archivedAt: null },
      })
    : null;
  requireThat(!input.thread || thread, 404, 'Thread not found.');
  const scope = {
    project_id: projectId,
    ...(input.thread ? { task_id: thread?.taskId ?? '' } : {}),
  };
  if (!input.snapshot) {
    const rows = await prisma.candidates.findMany({
      where: scope,
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true,
        task_id: true,
        manifest: true,
        created_at: true,
        publications: { select: { url: true, pr_number: true, merged_sha: true } },
        runs: { select: { claims: { select: { tasks: { select: { title: true } } } } } },
      },
    });
    const snapshots: ReviewSnapshot[] = rows.map((row) => {
      const manifest = row.manifest as unknown as CandidateManifest;
      const publication = row.publications[0];
      const url =
        publication &&
        !manifest.fixture &&
        publication.url ===
          `https://github.com/${manifest.repository}/pull/${publication.pr_number}`
          ? publication.url
          : null;
      return {
        id: row.id,
        taskId: row.task_id,
        title: row.runs.claims.tasks.title,
        headSha: manifest.headSha,
        baseSha: manifest.baseSha,
        branch: manifest.branch,
        targetRef: manifest.targetRef,
        createdAt: row.created_at.toISOString(),
        fixture: manifest.fixture,
        publication: publication
          ? { number: publication.pr_number, url, merged: !!publication.merged_sha }
          : null,
      };
    });
    return { snapshots };
  }
  const candidate = await prisma.candidates.findFirst({ where: { ...scope, id: input.snapshot } });
  requireThat(candidate, 404, 'Saved change not found.');
  const manifest = candidate.manifest as unknown as CandidateManifest;
  requireThat(!manifest.fixture, 409, 'Fixture changes have no Git artifact.');
  requireThat(
    digest(manifest) === candidate.digest,
    409,
    'Saved change failed its integrity check.',
  );
  const review = await savedGitReview(manifest, input.commit);
  await access(prisma, actor, projectId);
  if (input.file !== undefined) {
    requireThat(Object.hasOwn(review.diffs, input.file), 404, 'File not found in this revision.');
    return review.diffs[input.file];
  }
  return { files: review.files, commits: review.commits };
}
