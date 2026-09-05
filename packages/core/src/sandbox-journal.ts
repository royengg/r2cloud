import { transaction, type DB } from './db';
import { requireThat } from '@r2cloud/contracts/domain';
import type { SandboxJournal, VercelIdentity, Allocation } from '@r2cloud/adapters/vercel';
async function fence(db: DB, identity: VercelIdentity) {
  const run = (
    await db.query(
      `SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id JOIN claims c ON c.id=r.claim_id JOIN jobs j ON j.run_id=r.id
    WHERE r.id=$1 AND j.id=$2 AND r.generation=$3 AND t.generation=$3 AND c.released_at IS NULL AND r.stopped_at IS NULL AND r.manifest->>'mode'='managed' FOR UPDATE OF t,r`,
      [identity.runId, identity.operationId, identity.generation],
    )
  ).rows[0];
  requireThat(run, 409, 'Stale or unauthorised sandbox execution.');
}
const map = (row: any): Allocation => ({
  operationId: row.operation_id,
  runId: row.run_id,
  generation: row.generation,
  name: row.name,
  configHash: row.config_hash,
  state: row.state,
  stopProof: row.stop_proof,
});
export class PostgresSandboxJournal implements SandboxJournal {
  async reserve(identity: VercelIdentity, name: string, configHash: string, minutes: number) {
    return transaction(async (db) => {
      await fence(db, identity);
      const grant = (await db.query('SELECT manifest FROM runs WHERE id=$1', [identity.runId]))
        .rows[0].manifest;
      requireThat(
        Number.isFinite(grant.minutes) && minutes <= grant.minutes,
        403,
        'Sandbox duration exceeds the authorised run limit.',
      );
      const inserted = await db.query(
        `INSERT INTO sandbox_allocations(operation_id,run_id,generation,name,config_hash,state) VALUES($1,$2,$3,$4,$5,'creating') ON CONFLICT DO NOTHING RETURNING *`,
        [identity.operationId, identity.runId, identity.generation, name, configHash],
      );
      const row =
        inserted.rows[0] ??
        (
          await db.query('SELECT * FROM sandbox_allocations WHERE operation_id=$1', [
            identity.operationId,
          ])
        ).rows[0];
      requireThat(
        row && row.config_hash === configHash,
        409,
        'Execution already has a different sandbox allocation.',
      );
      return { fresh: inserted.rowCount === 1, allocation: map(row) };
    });
  }
  async get(identity: VercelIdentity) {
    return transaction(async (db) => {
      await fence(db, identity);
      const row = (
        await db.query(
          'SELECT * FROM sandbox_allocations WHERE operation_id=$1 AND run_id=$2 AND generation=$3',
          [identity.operationId, identity.runId, identity.generation],
        )
      ).rows[0];
      return row ? map(row) : null;
    });
  }
  async mark(identity: VercelIdentity, state: string, stopProof?: string) {
    await transaction(async (db) => {
      await fence(db, identity);
      const row = await db.query(
        `UPDATE sandbox_allocations SET state=$2,stop_proof=COALESCE($3,stop_proof) WHERE operation_id=$1 AND state <> 'stopped' AND (state <> 'stopping' OR $2='stopped') RETURNING *`,
        [identity.operationId, state, stopProof ?? null],
      );
      requireThat(row.rowCount, 409, 'Sandbox lifecycle was superseded.');
    });
  }
  async beginStep(identity: VercelIdentity, key: string, payloadHash: string) {
    return transaction(async (db) => {
      await fence(db, identity);
      const allocation = (
        await db.query('SELECT * FROM sandbox_allocations WHERE operation_id=$1 FOR UPDATE', [
          identity.operationId,
        ])
      ).rows[0];
      requireThat(allocation?.state === 'running', 409, 'Sandbox is not accepting commands.');
      const inserted = await db.query(
        `INSERT INTO sandbox_steps VALUES($1,$2,$3,'pending',NULL) ON CONFLICT DO NOTHING RETURNING *`,
        [identity.operationId, key, payloadHash],
      );
      const row =
        inserted.rows[0] ??
        (
          await db.query('SELECT * FROM sandbox_steps WHERE operation_id=$1 AND key=$2', [
            identity.operationId,
            key,
          ])
        ).rows[0];
      requireThat(
        row.payload_hash === payloadHash,
        409,
        'Command key was reused with different content.',
      );
      return {
        fresh: inserted.rowCount === 1,
        ...(row.state === 'finished' ? { result: row.result } : {}),
      };
    });
  }
  async finishStep(identity: VercelIdentity, key: string, result: unknown) {
    await transaction(async (db) => {
      await fence(db, identity);
      await db.query(
        `UPDATE sandbox_steps SET state='finished',result=$3 WHERE operation_id=$1 AND key=$2 AND state='pending'`,
        [identity.operationId, key, JSON.stringify(result)],
      );
    });
  }
}
