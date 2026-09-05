import pg from 'pg';
import { resolve } from 'node:path';
export const pool = new pg.Pool(process.env.DATABASE_URL ? {connectionString:process.env.DATABASE_URL,max:16} : {host:resolve('.local/pgsocket'),port:55439,database:'postgres',max:16});
export type DB = Pick<pg.PoolClient,'query'>;
export async function transaction<T>(fn:(db:DB)=>Promise<T>):Promise<T> {
 const db=await pool.connect();
 try {await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;} catch(e){await db.query('ROLLBACK');throw e;} finally {db.release();}
}
