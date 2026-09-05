import {pool,transaction,type DB} from './db';
import {access,event,lockProject} from './service';
import {digest,id} from './hash';
import {requireThat} from './types';
import {SetupRequired,Uncertain,type ExecutionBackend,type PublisherBackend,type RunGrant,type RunResult,type PublicationGrant,type PublicationResult,type MergeResult} from '../../adapters/src/contracts';
async function reserve(kinds:string[]){return transaction(async db=>{
 const job=(await db.query(`SELECT * FROM jobs WHERE kind=ANY($1) AND available_at<=now() AND (state IN ('ready','uncertain') OR (state='processing' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,[kinds])).rows[0];
 if(!job)return null;
 const token=id();await db.query("UPDATE jobs SET state='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '90 seconds' WHERE id=$1",[job.id,token]);
 return {...job,lease_token:token,recovery:job.state!=='ready'};
 });}
async function assertJob(db:DB,job:any){requireThat((await db.query("SELECT 1 FROM jobs WHERE id=$1 AND lease_token=$2 AND state='processing' FOR UPDATE",[job.id,job.lease_token])).rowCount,409,'Worker lease was superseded.');}
async function executionGrant(job:any):Promise<RunGrant>{return transaction(async db=>{
 await lockProject(db,job.project_id);await assertJob(db,job);
 const r=(await db.query('SELECT r.*,t.outcome,t.criteria,t.generation current_generation,c.owner_id FROM runs r JOIN tasks t ON t.id=r.task_id JOIN claims c ON c.id=r.claim_id WHERE r.id=$1 AND c.released_at IS NULL',[job.run_id])).rows[0];
 requireThat(r&&r.generation===r.current_generation&&!r.stopped_at,409,'Stale execution generation.');
 const actor=(await db.query('SELECT id,kind FROM users WHERE id=$1',[r.owner_id])).rows[0];await access(db,actor,job.project_id,'contribute');
 requireThat((await db.query('SELECT 1 FROM provider_connections WHERE id=$1 AND user_id=$2 AND project_id=$3 AND enabled=true',[r.manifest.connectionId,r.owner_id,job.project_id])).rowCount,403,'AI account access has been revoked.');
 const feedback=(await db.query('SELECT body FROM comments WHERE task_id=$1 ORDER BY created_at',[job.task_id])).rows.map(x=>x.body);
 await db.query("UPDATE runs SET state='running',heartbeat_at=now() WHERE id=$1",[r.id]);
 return {operationId:job.id,runId:r.id,taskId:job.task_id,projectId:job.project_id,orgId:job.org_id,generation:r.generation,outcome:r.outcome,criteria:r.criteria,feedback,config:r.manifest};
 });}
async function finishRun(job:any,grant:RunGrant,result:RunResult){return transaction(async db=>{
 await lockProject(db,job.project_id);await assertJob(db,job);
 const t=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[job.task_id])).rows[0];
 const m=result.manifest;
 requireThat(t.generation===grant.generation&&m.generation===t.generation&&m.runId===grant.runId&&m.taskId===t.id&&m.projectId===t.project_id&&m.orgId===t.org_id,409,'Rejecting a stale or mis-scoped result.');
 requireThat(m.repository===grant.config.repository&&m.baseSha===grant.config.baseSha&&m.targetRef===grant.config.targetRef&&m.fixture===(grant.config.mode==='fixture'),409,'Execution result does not match its grant.');
 requireThat(result.stopProof&&result.evidence.snapshotDigest===m.artifactDigest,409,'Snapshot evidence and confirmed execution stop are required.');
 requireThat(/^[a-f0-9]{40}$/.test(m.headSha)&&/^[a-f0-9]{64}$/.test(m.artifactDigest),409,'Invalid immutable artifact identity.');
 const candidateId=id();await db.query('INSERT INTO candidates(id,org_id,project_id,task_id,run_id,generation,digest,manifest,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[candidateId,t.org_id,t.project_id,t.id,grant.runId,t.generation,digest(m),JSON.stringify(m),JSON.stringify(result.evidence)]);
 await db.query("UPDATE runs SET state='stopped',stopped_at=now(),stop_proof=$2 WHERE id=$1 AND stopped_at IS NULL",[grant.runId,result.stopProof]);
 const passed=result.evidence.checks.length===grant.criteria.length&&result.evidence.checks.every((x,i)=>x.status==='passed'&&x.name===grant.criteria[i]);
 await db.query('UPDATE tasks SET candidate_id=$2,state=$3,version=version+1 WHERE id=$1',[t.id,candidateId,passed?'review':'blocked']);
 await db.query("UPDATE jobs SET state='done',lease_until=NULL,error=NULL WHERE id=$1",[job.id]);
 await event(db,t.project_id,t.id,null,passed?'Ready for your review':'Acceptance checks need attention',{candidateId,fixture:m.fixture});
 });}
async function publicationGrant(job:any,reconcile=false):Promise<PublicationGrant>{return transaction(async db=>{
 await lockProject(db,job.project_id);await assertJob(db,job);
 const a=(await db.query('SELECT a.*,u.kind FROM approvals a JOIN users u ON u.id=a.approver_id WHERE a.id=$1',[job.approval_id])).rows[0];
 const t=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[job.task_id])).rows[0];
 const c=(await db.query('SELECT * FROM candidates WHERE id=$1',[a?.candidate_id])).rows[0];
 requireThat(a&&c&&a.action===job.kind&&a.task_id===job.task_id&&a.project_id===job.project_id&&a.org_id===job.org_id,409,'Publication intent does not match approval.');
 requireThat(t.candidate_id===c.id&&t.generation===c.generation&&a.digest===c.digest&&digest(c.manifest)===c.digest,409,'Approval no longer matches the current immutable candidate.');
 requireThat((await db.query('SELECT 1 FROM claims WHERE task_id=$1 AND released_at IS NULL',[t.id])).rowCount,409,'The task is no longer owned.');
 // Read-only reconciliation is permitted after expiry/revocation, so a completed external
 // operation is still recorded truthfully. New writes ALWAYS require fresh validation.
 if(!reconcile){
  await access(db,{id:a.approver_id,kind:a.kind},job.project_id,job.kind==='merge'?'merge':'review');
  requireThat(!a.revoked_at&&new Date(a.expires_at)>new Date()&&a.policy_version==='v1',403,'Approval expired or was revoked.');
  await db.query('UPDATE approvals SET consumed_at=COALESCE(consumed_at,now()) WHERE id=$1',[a.id]);
 }
 const pub=(await db.query('SELECT * FROM publications WHERE candidate_id=$1 LIMIT 1',[c.id])).rows[0];
 return {operationId:job.id,candidate:c.manifest,digest:c.digest,action:job.kind,publication:pub?{prNumber:pub.pr_number,url:pub.url,headSha:pub.head_sha,repository:c.manifest.repository,targetRef:c.manifest.targetRef,branch:c.manifest.branch}:undefined};
 });}
async function finishPublication(job:any,g:PublicationGrant,result:PublicationResult|MergeResult){return transaction(async db=>{
 await lockProject(db,job.project_id);await assertJob(db,job);
 const t=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[job.task_id])).rows[0];
 requireThat(t.generation===g.candidate.generation,409,'Stale publication generation.');
 requireThat(result.headSha===g.candidate.headSha&&result.repository===g.candidate.repository&&result.targetRef===g.candidate.targetRef&&result.branch===g.candidate.branch,409,'Repository facts do not match the approved changes.');
 if(job.kind==='publish'){
  await db.query('INSERT INTO publications(operation_id,org_id,project_id,task_id,candidate_id,pr_number,url,head_sha) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[job.id,t.org_id,t.project_id,t.id,t.candidate_id,result.prNumber,result.url,result.headSha]);
  await db.query("UPDATE tasks SET state='code_review',version=version+1 WHERE id=$1",[t.id]);
 }else{
  const merged=result as MergeResult;
  requireThat(g.publication&&merged.prNumber===g.publication.prNumber&&merged.merged&&merged.requiredChecksPassed&&merged.mergeSha&&/^[a-f0-9]{40}$/.test(merged.mergeSha),409,'A separately authorised, verified merge with required checks is needed for completion.');
  await db.query('UPDATE publications SET merged_sha=$2 WHERE candidate_id=$1',[t.candidate_id,merged.mergeSha]);
  await db.query("UPDATE tasks SET state='completed',merged_sha=$2,completed_at=now(),version=version+1 WHERE id=$1",[t.id,merged.mergeSha]);
  await db.query('UPDATE claims SET released_at=now() WHERE task_id=$1 AND released_at IS NULL',[t.id]);
 }
 await db.query("UPDATE jobs SET state='done',lease_until=NULL,error=NULL WHERE id=$1",[job.id]);
 await event(db,t.project_id,t.id,null,job.kind==='publish'?'Pull request verified':'Merge verified',{fixture:g.candidate.fixture,operationId:job.id});
 });}
async function failure(job:any,error:unknown){
 const setup=error instanceof SetupRequired;const message=error instanceof Error?error.message:'External outcome is uncertain.';
 await transaction(async db=>{
  await lockProject(db,job.project_id);
  if(!(await db.query("SELECT 1 FROM jobs WHERE id=$1 AND lease_token=$2 AND state='processing' FOR UPDATE",[job.id,job.lease_token])).rowCount)return;
  await db.query('UPDATE jobs SET state=$2,error=$3,available_at=now()+interval \'10 seconds\',lease_until=NULL WHERE id=$1',[job.id,setup?'blocked':'uncertain',message.slice(0,500)]);
  if(job.run_id)await db.query("UPDATE runs SET state='unknown' WHERE id=$1 AND stopped_at IS NULL",[job.run_id]);
  await db.query("UPDATE tasks SET state='blocked',version=version+1 WHERE id=$1 AND state<>'completed'",[job.task_id]);
  await event(db,job.project_id,job.task_id,null,setup?'Connection setup required':'Outcome uncertain; ownership retained',{message:message.slice(0,500)});
 });
}
export async function executeOne(backend:ExecutionBackend){
 const job=await reserve(['execute']);if(!job)return false;
 try{
  const grant=await executionGrant(job);
  requireThat((grant.config.mode==='fixture')===(backend.mode==='fixture'),409,'Fixture and managed execution cannot be mixed.');
  const observation=await backend.observe(job.id);
  if(observation.state==='unknown'||observation.state==='running')throw new Uncertain('Previous execution is not confirmed stopped. Replacement is blocked.');
  const result=observation.state==='finished'?observation.result:await backend.start(grant);
  await finishRun(job,grant,result);
 }catch(e){await failure(job,e);}return true;
}
export async function publishOne(backend:PublisherBackend){
 const job=await reserve(['publish','merge']);if(!job)return false;
 try{
  let grant=await publicationGrant(job,true);
  requireThat(grant.candidate.fixture===(backend.mode==='fixture'),409,'Fixture candidates cannot reach a real publisher.');
  const observation=await backend.observe(grant);
  if(observation.state==='running'||observation.state==='unknown')throw new Uncertain('GitHub outcome is uncertain; reconcile before another write.');
  let result:PublicationResult|MergeResult;
  if(observation.state==='finished')result=observation.result;
  else{grant=await publicationGrant(job);result=job.kind==='publish'?await backend.publish(grant):await backend.merge(grant);}
  await finishPublication(job,grant,result);
 }catch(e){await failure(job,e);}return true;
}
