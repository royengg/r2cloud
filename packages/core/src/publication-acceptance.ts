import type { DB } from '@r2cloud/database';
import { requireThat, type Evidence } from '@r2cloud/contracts/domain';

export async function requirePublicationAcceptance(
  db: DB,
  candidate: { id: string; digest: string; evidence: unknown },
  confirmed: boolean,
) {
  const checks = (candidate.evidence as Evidence).checks;
  requireThat(
    checks.length > 0 && checks.every((check) => ['passed', 'unknown'].includes(check.status)),
    409,
    'Resolve failed validation and prepare a new saved change before publication.',
  );
  if (checks.every((check) => check.status === 'passed') || confirmed) return;
  const acceptedPublication = await db.publications.count({
    where: {
      candidate_id: candidate.id,
      jobs: {
        approvals: {
          candidate_id: candidate.id,
          digest: candidate.digest,
          action: 'publish',
          acceptance_confirmed_at: { not: null },
        },
      },
    },
  });
  requireThat(
    acceptedPublication > 0,
    409,
    'Verify the acceptance criteria for this saved change and confirm them before publication.',
  );
}
