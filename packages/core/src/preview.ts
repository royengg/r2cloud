import {pool,transaction} from './db';
import {hash,id} from './hash';
import {access} from './service';
import {requireThat,type Actor} from './types';
export async function issuePreview(actor:Actor,projectId:string,candidateId:string){return transaction(async db=>{
 await access(db,actor,projectId);
 const c=(await db.query('SELECT * FROM candidates WHERE id=$1 AND project_id=$2',[candidateId,projectId])).rows[0];
 requireThat(c?.evidence.preview.available,404,'This preview is not available.');
 requireThat(c.manifest.fixture,503,'The managed preview gateway has not been configured.');
 const token=id()+id();await db.query("INSERT INTO preview_grants VALUES($1,$2,$3,now()+interval '5 minutes')",[hash(token),actor.id,c.id]);
 return {url:`http://127.0.0.1:4311/view#${token}`,expiresInSeconds:300,fixture:true};
 });}
export async function readPreview(token:string){return transaction(async db=>{
 const g=(await db.query('SELECT g.*,u.kind,c.project_id,c.manifest,c.evidence FROM preview_grants g JOIN users u ON u.id=g.user_id JOIN candidates c ON c.id=g.candidate_id WHERE g.token_hash=$1 AND g.expires_at>now()',[hash(token)])).rows[0];
 requireThat(g,403,'Preview access expired. Open it again from the task.');await access(db,{id:g.user_id,kind:g.kind},g.project_id);
 return {manifest:g.manifest,evidence:g.evidence};
 });}
