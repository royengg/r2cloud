import { prisma } from '@r2cloud/database';
import { hash, id } from '@r2cloud/contracts/hash';
import { access } from './project-context';
import {
  requireThat,
  type Actor,
  type CandidateManifest,
  type Evidence,
} from '@r2cloud/contracts/domain';
export async function issuePreview(actor: Actor, projectId: string, candidateId: string) {
  return prisma.$transaction(async (db) => {
    await access(db, actor, projectId);
    const c = await db.candidates.findFirst({ where: { id: candidateId, project_id: projectId } });
    const evidence = c?.evidence as unknown as Evidence | undefined;
    requireThat(c && evidence?.preview.available, 404, 'This preview is not available.');
    const manifest = c.manifest as unknown as CandidateManifest;
    requireThat(manifest.fixture, 503, 'The managed preview gateway has not been configured.');
    const token = id() + id();
    await db.preview_grants.create({
      data: {
        token_hash: hash(token),
        user_id: actor.id,
        candidate_id: c.id,
        expires_at: new Date(Date.now() + 5 * 60_000),
      },
    });
    const origin =
      process.env.R2_MODE === 'fixture' && process.env.R2_PREVIEW_ORIGIN
        ? new URL(process.env.R2_PREVIEW_ORIGIN).origin
        : 'http://127.0.0.1:4311';
    requireThat(
      origin === 'http://127.0.0.1:4311' || origin.startsWith('https://'),
      500,
      'Preview origin must use HTTPS.',
    );
    return { url: `${origin}/view#${token}`, expiresInSeconds: 300, fixture: true };
  });
}
export async function readPreview(token: string) {
  return prisma.$transaction(async (db) => {
    const g = await db.preview_grants.findFirst({
      where: { token_hash: hash(token), expires_at: { gt: new Date() } },
      include: { candidates: true },
    });
    requireThat(g, 403, 'Preview access expired. Open it again from the task.');
    await access(db, { id: g.user_id }, g.candidates.project_id);
    return { manifest: g.candidates.manifest, evidence: g.candidates.evidence };
  });
}
