import express from 'express';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {ZodError} from 'zod';
import {pool} from '../../../packages/core/src/db';
import {hash,id} from '../../../packages/core/src/hash';
import {Fault,requireThat,commandInput,taskInput,type Actor} from '../../../packages/core/src/types';
import {access,addComment,command,createTask,projects,snapshot} from '../../../packages/core/src/service';
import {issuePreview} from '../../../packages/core/src/preview';
function sessionToken(cookie:string|undefined){return cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('r2session='))?.slice(10)??'';}
export async function authenticate(cookie:string|undefined):Promise<Actor>{const user=(await pool.query('SELECT u.id,u.kind FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(sessionToken(cookie))])).rows[0];requireThat(user,401,'Sign in to your workspace.');return user;}
const origins=new Set(['http://127.0.0.1:5173','http://127.0.0.1:4310','http://localhost:5173','http://localhost:4310']);
export function createApp(options:{fixture:boolean}){
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'64kb'}));
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'});if(req.method!=='GET'&&req.method!=='HEAD'){if(req.headers.origin&&!origins.has(req.headers.origin))return next(new Fault(403,'Request origin is not permitted.'));if(!req.is('application/json'))return next(new Fault(415,'Use an application/json request.'));}next();});
 if(options.fixture)app.post('/api/local-session',async(req,res)=>{
  requireThat(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''),403,'Local fixture access only.');
  requireThat(['maya','alex','sam'].includes(req.body.userId),400,'Select a fixture participant.');
  const token=id()+id();await pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '8 hours')",[hash(token),req.body.userId]);
  res.cookie('r2session',token,{httpOnly:true,sameSite:'strict',path:'/',maxAge:8*3600*1000});res.json({fixture:true});
 });
 app.use('/api',async(req,res,next)=>{try{res.locals.actor=await authenticate(req.headers.cookie);next();}catch(e){next(e);}});
 app.get('/api/me',async(req,res)=>{const actor=res.locals.actor;const user=(await pool.query('SELECT id,name,kind FROM users WHERE id=$1',[actor.id])).rows[0];res.json({user,projects:await projects(actor),mode:options.fixture?'fixture':'managed'});});
 app.post('/api/logout',async(req,res)=>{await pool.query('DELETE FROM sessions WHERE token_hash=$1',[hash(sessionToken(req.headers.cookie))]);res.clearCookie('r2session');res.json({ok:true});});
 app.get('/api/projects/:projectId/snapshot',async(req,res)=>{res.json(await snapshot(res.locals.actor,String(req.params.projectId)));});
 app.post('/api/projects/:projectId/tasks',async(req,res)=>{res.status(201).json(await createTask(res.locals.actor,String(req.params.projectId),req.get('Idempotency-Key')??'',taskInput.parse(req.body)));});
 app.post('/api/projects/:projectId/tasks/:taskId/commands',async(req,res)=>{res.json(await command(res.locals.actor,String(req.params.projectId),String(req.params.taskId),req.get('Idempotency-Key')??'',commandInput.parse(req.body)));});
 app.post('/api/projects/:projectId/comments',async(req,res)=>{requireThat(typeof req.body.body==='string'&&(req.body.taskId===null||typeof req.body.taskId==='string'),400,'Message and scope are required.');res.json(await addComment(res.locals.actor,String(req.params.projectId),req.body.taskId,req.get('Idempotency-Key')??'',req.body.body));});
 app.post('/api/projects/:projectId/candidates/:candidateId/preview',async(req,res)=>{res.json(await issuePreview(res.locals.actor,String(req.params.projectId),String(req.params.candidateId)));});
 app.use(express.static('dist/web',{index:'index.html'}));
 app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const status=err instanceof Fault?err.status:err instanceof ZodError?400:500;res.status(status).json({error:status===500?'The request could not be completed.':err instanceof ZodError?'Check the required fields and try again.':err.message});if(status===500)console.error('API error:',err.message);});
 return app;
}
export function createHttpServer(options:{fixture:boolean}){
 const server=createServer(createApp(options));const wss=new WebSocketServer({noServer:true,maxPayload:1024});
 server.on('upgrade',async(req,socket,head)=>{
  try{
   requireThat(origins.has(req.headers.origin??''),403,'Origin denied.');const url=new URL(req.url??'/','http://127.0.0.1');requireThat(url.pathname==='/ws',404,'Not found');
   const projectId=url.searchParams.get('project')??'';const actor=await authenticate(req.headers.cookie);await access(pool,actor,projectId);
   wss.handleUpgrade(req,socket,head,ws=>{
    let cursor='-1',checking=false;
    const update=async()=>{if(checking||ws.readyState!==ws.OPEN)return;checking=true;try{await authenticate(req.headers.cookie);await access(pool,actor,projectId);const latest=(await pool.query('SELECT COALESCE(max(id),0)::text cursor FROM events WHERE project_id=$1',[projectId])).rows[0].cursor;if(latest!==cursor){cursor=latest;ws.send(JSON.stringify({type:'snapshot-required',cursor}));}}catch{ws.close(1008,'Access ended');}finally{checking=false;}};
    void update();const timer=setInterval(()=>void update(),750);ws.on('close',()=>clearInterval(timer));ws.on('error',()=>clearInterval(timer));
   });
  }catch{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();}
 });
 return {server,wss};
}
