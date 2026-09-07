import {
  request,
  type IncomingMessage,
  type ServerResponse,
  type OutgoingHttpHeaders,
} from 'node:http';
import type { Duplex } from 'node:stream';

export const previewCookie = '__Host-r2-preview';
const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
function cleanHeaders(headers: IncomingMessage['headers']) {
  const excluded = new Set([
    ...hopHeaders,
    ...(headers.connection ?? '')
      .toLowerCase()
      .split(',')
      .map((value) => value.trim()),
  ]);
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        !excluded.has(name) &&
        !name.startsWith('x-forwarded-') &&
        !name.startsWith('x-r2-') &&
        name !== 'forwarded',
    ),
  );
}
function responseHeaders(headers: IncomingMessage['headers'], origin: string, port: number) {
  const cleaned: OutgoingHttpHeaders = cleanHeaders(headers);
  delete cleaned['content-security-policy-report-only'];
  delete cleaned['clear-site-data'];
  delete cleaned['service-worker-allowed'];
  cleaned['cache-control'] = 'no-store';
  cleaned['referrer-policy'] = 'no-referrer';
  cleaned['x-content-type-options'] = 'nosniff';
  cleaned['cross-origin-opener-policy'] = 'same-origin';
  cleaned['cross-origin-resource-policy'] = 'same-origin';
  cleaned['x-frame-options'] = 'DENY';
  cleaned['content-security-policy'] =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' " +
    origin.replace('https:', 'wss:') +
    "; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
  cleaned['permissions-policy'] = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
  if (headers['set-cookie'])
    cleaned['set-cookie'] = headers['set-cookie']
      .filter((cookie) => cookie.split('=', 1)[0].trim() !== previewCookie)
      .map((cookie) => cookie.replace(/;\s*domain=[^;]*/gi, ''));
  if (headers.location) {
    let destination: URL;
    try {
      destination = new URL(headers.location, origin);
    } catch {
      delete cleaned.location;
      return cleaned;
    }
    if (
      ['localhost', '127.0.0.1'].includes(destination.hostname) &&
      Number(destination.port || 80) === port
    )
      cleaned.location = origin + destination.pathname + destination.search + destination.hash;
  }
  return cleaned;
}
export function proxyPreview(
  req: IncomingMessage,
  target: ServerResponse | Duplex,
  options: { origin: string; port: number; connect: () => Promise<Duplex>; head?: Buffer },
) {
  const upgrade = options.head !== undefined;
  const headers = cleanHeaders(req.headers);
  headers.host = `127.0.0.1:${options.port}`;
  headers.cookie = req.headers.cookie
    ?.split(';')
    .filter((cookie) => cookie.split('=', 1)[0].trim() !== previewCookie)
    .join(';');
  if (!headers.cookie) delete headers.cookie;
  if (headers.origin === options.origin) headers.origin = `http://127.0.0.1:${options.port}`;
  if (upgrade) {
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
  }
  const upstream = request({
    method: req.method,
    path: req.url,
    host: '127.0.0.1',
    port: options.port,
    headers,
    createConnection: (_options, done) => {
      void options.connect().then(
        (stream) => done(null, stream),
        (error) => done(error, undefined!),
      );
      return undefined;
    },
  });
  const fail = () => {
    if (!upgrade && !(target as ServerResponse).headersSent)
      (target as ServerResponse)
        .writeHead(502, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        .end('The preview app is not responding.');
    else target.destroy();
  };
  const timer = setTimeout(() => upstream.destroy(new Error('Preview response timed out.')), 30000);
  upstream.on('error', fail);
  upstream.on('close', () => clearTimeout(timer));
  target.on('close', () => {
    upstream.destroy();
    clearTimeout(timer);
  });
  req.on('aborted', () => upstream.destroy());
  upstream.on('response', (response) => {
    clearTimeout(timer);
    if (upgrade) {
      response.destroy();
      target.destroy();
      return;
    }
    (target as ServerResponse).writeHead(
      response.statusCode ?? 502,
      responseHeaders(response.headers, options.origin, options.port),
    );
    response.on('error', () => target.destroy());
    response.pipe(target);
  });
  upstream.on('upgrade', (response, socket, head) => {
    clearTimeout(timer);
    if (!upgrade || response.statusCode !== 101) {
      socket.destroy();
      target.destroy();
      return;
    }
    const headers = responseHeaders(response.headers, options.origin, options.port);
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
    const lines = Object.entries(headers).flatMap(([key, value]) =>
      value === undefined
        ? []
        : (Array.isArray(value) ? value : [value]).map((entry) => `${key}: ${entry}`),
    );
    target.write('HTTP/1.1 101 Switching Protocols\r\n' + lines.join('\r\n') + '\r\n\r\n');
    if (head.length) target.write(head);
    if (options.head?.length) socket.write(options.head);
    socket.on('error', () => target.destroy());
    target.on('error', () => socket.destroy());
    target.on('close', () => socket.destroy());
    socket.on('close', () => target.destroy());
    target.pipe(socket).pipe(target);
  });
  req.pipe(upstream);
  return () => {
    upstream.destroy();
    target.destroy();
    clearTimeout(timer);
  };
}
