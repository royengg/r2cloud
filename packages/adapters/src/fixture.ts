import {pool} from '../../core/src/db';
import {digest} from '../../core/src/hash';
import type {ExecutionBackend,PublisherBackend,RunGrant,RunResult,Observation,PublicationGrant,PublicationResult,MergeResult} from './contracts';
async function observe<T>(operationId:string):Promise<Observation<T>>{const row=(await pool.query('SELECT result FROM fixture_external WHERE operation_id=$1',[operationId])).rows[0];return row?{state:'finished',result:row.result}:{state:'absent'};}
async function save<T>(operationId:string,kind:string,result:T):Promise<T>{return (await pool.query('INSERT INTO fixture_external VALUES($1,$2,$3) ON CONFLICT(operation_id) DO UPDATE SET operation_id=EXCLUDED.operation_id RETURNING result',[operationId,kind,JSON.stringify(result)])).rows[0].result;}
export class FixtureExecution implements ExecutionBackend {
 readonly mode='fixture' as const;
 observe=observe<RunResult>;
 async start(g:RunGrant):Promise<RunResult>{
  const artifactDigest=digest({fixture:true,run:g.runId,feedback:g.feedback});
  return save(g.operationId,'execute',{manifest:{orgId:g.orgId,projectId:g.projectId,taskId:g.taskId,runId:g.runId,generation:g.generation,repository:g.config.repository,targetRef:g.config.targetRef,branch:`r2/task-${g.taskId}/${g.generation}`,baseSha:g.config.baseSha,headSha:digest(g).slice(0,40),artifactDigest,summary:g.feedback.length?'Fixture correction prepared from the latest feedback.':'Fixture candidate prepared for product review.',limitations:['Simulated execution: no repository was cloned, no AI model was called, and these checks did not run against an application.'],fixture:true},evidence:{checks:g.criteria.map(name=>({name,status:'passed' as const})),snapshotDigest:artifactDigest,preview:{available:true,fixture:true}},stopProof:`fixture:${g.runId}:stopped`});
 }
}
export class FixturePublisher implements PublisherBackend {
 readonly mode='fixture' as const;
 observe(g:PublicationGrant){return observe<PublicationResult|MergeResult>(g.operationId);}
 async publish(g:PublicationGrant):Promise<PublicationResult>{return save(g.operationId,'publish',{prNumber:parseInt(g.digest.slice(0,6),16),url:`https://fixture.invalid/review/${g.operationId}`,headSha:g.candidate.headSha,repository:g.candidate.repository,targetRef:g.candidate.targetRef,branch:g.candidate.branch});}
 async merge(g:PublicationGrant):Promise<MergeResult>{if(!g.publication)throw new Error('Missing publication');return save(g.operationId,'merge',{...g.publication,merged:true,mergeSha:digest({operation:g.operationId}).slice(0,40),requiredChecksPassed:true});}
}
