import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { Fault, requireThat } from '@r2cloud/contracts/domain';
import { previewOrigin } from '@r2cloud/contracts/preview';
import { previewCookie, proxyPreview } from './proxy';

export type PreviewGrant = {
  previewId: string;
  runtimeId: string;
  sandboxName: string;
  configHash: string;
  port: number;
  expiresAt: number;
};
type Dependencies = {
  authorize(id: string, token: string): Promise<PreviewGrant>;
  redeem(id: string, ticket: string): Promise<{ token: string; expiresAt: Date }>;
  connect(grant: PreviewGrant): Promise<Duplex>;
};
const prefix = '/_r2cloud/';
function page(nonce: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening preview</title><body><p id="status">Opening your preview…</p><script nonce="${nonce}">
const ticket=location.hash.slice(1);history.replaceState(null,'',location.pathname);
fetch('/_r2cloud/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})}).then(async response=>{if(!response.ok)throw Error();location.replace('/');}).catch(()=>{document.getElementById('status').textContent='This preview link has expired. Open it again from your project thread.';});
</script></body></html>`;
}
function cookie(req: IncomingMessage) {
  const tokens = (req.headers.cookie ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.split('=', 1)[0].trim() === previewCookie);
  requireThat(tokens.length === 1, 401, 'Open this preview from its project thread.');
  return tokens[0].slice(tokens[0].indexOf('=') + 1).trim();
}
async function ticketBody(req: IncomingMessage) {
  requireThat(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'Use JSON.');
  let body = '';
  for await (const bytes of req) {
    body += bytes.toString();
    requireThat(body.length <= 2048, 413, 'Request too large.');
  }
  try {
    const ticket: unknown = JSON.parse(body)?.ticket;
    requireThat(
      typeof ticket === 'string' && /^[\w-]{43}$/.test(ticket),
      400,
      'Invalid preview ticket.',
    );
    return ticket;
  } catch {
    throw new Fault(400, 'Invalid preview ticket.');
  }
}
export function createPreviewGateway(domain: string, dependencies: Dependencies) {
  previewOrigin(domain, '00000000-0000-0000-0000-000000000000');
  const viewers = new Map<
    string,
    { id: string; token: string; streams: Set<() => void>; checking: boolean }
  >();
  const pending = new Map<string, Promise<PreviewGrant>>();
  function authorize(id: string, token: string) {
    requireThat(/^[\w-]{43}$/.test(token), 401, 'Invalid preview credential.');
    const key = id + ':' + token;
    requireThat(pending.size < 256 || pending.has(key), 503, 'Preview capacity reached.');
    let check = pending.get(key);
    if (!check) {
      check = dependencies.authorize(id, token).finally(() => pending.delete(key));
      pending.set(key, check);
    }
    return check;
  }
  function identity(req: IncomingMessage) {
    const host = req.headers.host ?? '';
    const id = host.slice(0, -(domain.length + 1));
    const origin = previewOrigin(domain, id);
    requireThat(host === new URL(origin).host, 404, 'Preview not found.');
    return { id, origin };
  }
  function sameOrigin(req: IncomingMessage, origin: string, upgrade = false) {
    requireThat(
      !req.headers.origin || req.headers.origin === origin,
      403,
      'Preview origin is not permitted.',
    );
    requireThat(!upgrade || req.headers.origin === origin, 403, 'Preview origin is required.');
    requireThat(
      !req.headers['sec-fetch-site'] ||
        ['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])),
      403,
      'Open this preview directly.',
    );
  }
  function error(target: ServerResponse | Duplex, error: unknown, upgrade: boolean) {
    const status = error instanceof Fault ? error.status : 502;
    const message =
      status === 502
        ? 'The preview is temporarily unavailable.'
        : 'Preview access ended. Open it again from your project thread.';
    if (upgrade) {
      target.end(
        `HTTP/1.1 ${status} Preview unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    } else if (!(target as ServerResponse).headersSent)
      (target as ServerResponse)
        .writeHead(status, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        })
        .end(message);
    else target.destroy();
  }
  async function forward(req: IncomingMessage, target: ServerResponse | Duplex, head?: Buffer) {
    const { id, origin } = identity(req);
    sameOrigin(req, origin, head !== undefined);
    requireThat(
      req.url?.startsWith('/') && !req.url.startsWith('//') && !req.url.startsWith(prefix),
      400,
      'Invalid preview path.',
    );
    requireThat(
      ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method ?? ''),
      405,
      'Method not allowed.',
    );
    const token = cookie(req);
    requireThat(
      viewers.size < 256 || viewers.has(id + ':' + token),
      503,
      'Preview capacity reached.',
    );
    const grant = await authorize(id, token);
    requireThat(grant.expiresAt > Date.now(), 410, 'Preview expired.');
    if (target.destroyed) return;
    const key = id + ':' + token;
    let viewer = viewers.get(key);
    if (!viewer) {
      requireThat(viewers.size < 256, 503, 'Preview capacity reached.');
      viewer = { id, token, streams: new Set(), checking: false };
      viewers.set(key, viewer);
    }
    requireThat(viewer.streams.size < 64, 429, 'Too many preview requests.');
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) req.destroy();
    });
    const close = proxyPreview(req, target, {
      origin,
      port: grant.port,
      connect: () => dependencies.connect(grant),
      head,
    });
    viewer.streams.add(close);
    const expiry = setTimeout(close, Math.max(1, grant.expiresAt - Date.now()));
    target.once('close', () => {
      clearTimeout(expiry);
      viewer!.streams.delete(close);
      if (!viewer!.streams.size) viewers.delete(key);
    });
  }
  const server = createServer(async (req, res) => {
    try {
      const { id, origin } = identity(req);
      if (req.url === prefix + 'open' && req.method === 'GET') {
        const nonce = randomBytes(24).toString('base64');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'cross-origin-opener-policy': 'same-origin',
          'x-content-type-options': 'nosniff',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
        });
        res.end(page(nonce));
        return;
      }
      if (req.url === prefix + 'session' && req.method === 'POST') {
        sameOrigin(req, origin, true);
        const result = await dependencies.redeem(id, await ticketBody(req));
        res.writeHead(204, {
          'cache-control': 'no-store',
          'set-cookie': `${previewCookie}=${result.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${result.expiresAt.toUTCString()}`,
        });
        res.end();
        return;
      }
      await forward(req, res);
    } catch (failure) {
      error(res, failure, false);
    }
  });
  server.on('upgrade', (req, socket, head) => {
    void forward(req, socket, head).catch((failure) => error(socket, failure, true));
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 30000;
  const timer = setInterval(() => {
    for (const viewer of viewers.values()) {
      if (viewer.checking) continue;
      viewer.checking = true;
      void authorize(viewer.id, viewer.token)
        .catch(() => {
          for (const close of viewer.streams) close();
        })
        .finally(() => {
          viewer.checking = false;
        });
    }
  }, 5000);
  timer.unref();
  server.once('close', () => {
    clearInterval(timer);
    for (const viewer of viewers.values()) for (const close of viewer.streams) close();
    viewers.clear();
  });
  return {
    server,
    close() {
      clearInterval(timer);
      for (const viewer of viewers.values()) for (const close of viewer.streams) close();
      viewers.clear();
      server.close();
    },
  };
}
