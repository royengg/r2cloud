import { readPreview } from '@r2cloud/core/preview';
if (process.env.R2_MODE !== 'fixture')
  throw new Error('A separate-site managed preview gateway is required.');
const headers = {
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'nonce-r2-fixture'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
};
const html = `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R2Cloud · Fixture preview</title><style>body{margin:0;background:#F8F7F4;color:#35333E;font:16px system-ui;padding:8vw}small{color:#52715B}h1{font-size:clamp(30px,5vw,64px);max-width:900px;letter-spacing:-.04em}section{max-width:800px;padding:32px;background:#FFFFFF;border:1px solid #D9D7D2;border-radius:24px}li{margin:18px 0}p{line-height:1.7;color:#686572}</style><small>R2CLOUD / FIXTURE PREVIEW</small><h1>A place to review the outcome.</h1><section id="content">Checking private preview access…</section><script nonce="r2-fixture">const token=location.hash.slice(1);history.replaceState(null,'','/view');fetch('/snapshot',{headers:{Authorization:'Bearer '+token}}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);const box=document.getElementById('content');box.replaceChildren();const p=document.createElement('p');p.textContent='This is a simulated review artifact, not a running repository application.';box.append(p);const title=document.createElement('h2');title.textContent=data.manifest.summary;box.append(title);const ul=document.createElement('ul');for(const check of data.evidence.checks){const li=document.createElement('li');li.textContent=check.name+' · fixture result';ul.append(li)}box.append(ul);const note=document.createElement('p');note.textContent='Snapshot '+data.manifest.artifactDigest.slice(0,12);box.append(note)}).catch(e=>document.getElementById('content').textContent=e.message);</script></html>`;
// Fixed fixture content uses native Bun HTTP.
// This serves only fixed fixture content; the product API continues to use Express.
Bun.serve({
  hostname: '127.0.0.1',
  port: 4311,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET')
      return new Response('Method not allowed', { status: 405, headers });
    if (path === '/view')
      return new Response(html, {
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
      });
    if (path === '/snapshot') {
      try {
        return Response.json(
          await readPreview((request.headers.get('authorization') ?? '').replace(/^Bearer /, '')),
          { headers },
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'Access denied' },
          { status: 403, headers },
        );
      }
    }
    return new Response('Not found', { status: 404, headers });
  },
});
console.log('Private fixture preview · http://127.0.0.1:4311');
