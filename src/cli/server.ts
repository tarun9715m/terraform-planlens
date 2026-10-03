import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CSP } from './page';

export interface Viewer {
  url: string;
  server: Server;
  close(): Promise<void>;
}

/**
 * Serve one page on 127.0.0.1. The URL carries a random token, and requests are refused unless the
 * Host header is this loopback address, so other local processes and websites (DNS rebinding) can't
 * read the plan.
 */
export async function serve(html: string, port = 0): Promise<Viewer> {
  const token = randomBytes(16).toString('hex');
  const body = Buffer.from(html, 'utf8');
  const server = createServer((req, res) => {
    const { port: p } = server.address() as AddressInfo;
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const path = (req.url ?? '/').split('?')[0];
    if (path !== `/${token}/`) {
      res.writeHead(path === '/favicon.ico' ? 204 : 404, { 'content-type': 'text/plain' }).end(path === '/favicon.ico' ? undefined : 'Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'content-security-policy': `${CSP}; frame-ancestors 'none'`,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const { port: p } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${p}/${token}/`,
    server,
    close: () => new Promise(r => server.close(() => r())),
  };
}
