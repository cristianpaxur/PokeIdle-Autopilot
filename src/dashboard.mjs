import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { qrcode } from 'qrcode-generator';
import { rejectUpgrade } from './remote-desktop.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/remote.js', ['remote.js', 'text/javascript; charset=utf-8']],
]);

const digest = (value) => createHash('sha256').update(value).digest();

export function createDashboard({ snapshot, preview, command, remote }) {
  const clients = new Set();
  const cookie = remote ? `idlebot_session=${randomBytes(32).toString('base64url')}` : '';
  const basic = remote ? digest(`Basic ${Buffer.from(`idlebot:${remote.password}`).toString('base64')}`) : null;
  let mobileQr;
  if (remote?.origin.protocol === 'https:') {
    const code = qrcode(0, 'M');
    code.addData(remote.origin.origin);
    code.make();
    mobileQr = code.createSvgTag(8);
  }
  const acceptsCookie = (req) => (req.headers.cookie ?? '').split(';').some((part) => part.trim() === cookie);
  const acceptsBasic = (req) => timingSafeEqual(digest(req.headers.authorization ?? ''), basic);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const localHost = `127.0.0.1:${server.address().port}`;
    const host = remote?.origin.host ?? localHost;
    const origin = remote?.origin.origin ?? `http://${host}`;
    const websocket = remote ? ` ${origin.replace(/^http/, 'ws')}` : '';
    res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data: blob:; connect-src 'self'${websocket}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    if (req.method === 'GET' && req.url === '/health' && req.headers.host === localHost) return res.writeHead(204).end();
    if (req.headers.host !== host || !req.url?.startsWith('/')) return res.writeHead(403).end();
    if (remote && !acceptsCookie(req)) {
      if (!acceptsBasic(req)) return res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="IdleBot", charset="UTF-8"' }).end();
      const secure = remote.origin.protocol === 'https:' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${cookie}; HttpOnly; SameSite=Strict; Path=/${secure}`);
    }
    const [pathname] = req.url.split('?');
    try {
      if (req.method === 'GET') {
        if (pathname === '/mobile-qr.svg' && mobileQr) {
          return res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }).end(mobileQr);
        }
        if (pathname === '/api/state') {
          return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(snapshot()));
        }
        if (pathname === '/api/live') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
          clients.add(res);
          res.on('close', () => clients.delete(res));
          return;
        }
        const image = pathname.match(/^\/api\/profiles\/([1-4])\/preview$/);
        if (image) {
          const buffer = preview(Number(image[1]));
          return buffer ? res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(buffer) : res.writeHead(404).end();
        }
        const file = files.get(pathname);
        if (file) {
          const data = await readFile(new URL(`../web/${file[0]}`, import.meta.url));
          return res.writeHead(200, { 'Content-Type': file[1] }).end(data);
        }
        if (remote && /^\/novnc\/(?:core|vendor)\/(?:[\w-]+\/)*[\w.-]+\.js$/.test(pathname)) {
          const data = await readFile(join('/usr/share/novnc', pathname.slice('/novnc/'.length)));
          return res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=3600' }).end(data);
        }
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['x-idlebot'] !== '1') return res.writeHead(403).end();
        const action = pathname.match(/^\/api\/profiles\/([1-4])\/(start|pause|stop|focus|take|release)$/);
        if (action && (remote || !['take', 'release'].includes(action[2]))) {
          const result = await command(Number(action[1]), action[2]);
          if (result) return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
          return res.writeHead(204).end();
        }
      }
      res.writeHead(404).end();
    } catch (error) {
      if (error.status) {
        return res.writeHead(error.status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
      }
      console.error(error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  if (remote) server.on('upgrade', (req, socket, head) => {
    if (req.headers.host !== remote.origin.host || req.headers.origin !== remote.origin.origin
      || (!acceptsCookie(req) && !acceptsBasic(req))) return rejectUpgrade(socket, 403, 'Forbidden');
    remote.desktop.upgrade(req, socket, head);
  });

  return {
    server,
    publish() {
      if (!clients.size) return;
      const event = `data: ${JSON.stringify(snapshot())}\n\n`;
      for (const client of clients) {
        if (!client.write(event)) client.end();
      }
    },
    close() {
      for (const client of clients) client.end();
      remote?.desktop.close();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
