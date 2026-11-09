import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

export function createDashboard({ snapshot, preview, command }) {
  const clients = new Set();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const host = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== host || !req.url?.startsWith('/')) return res.writeHead(403).end();
    const [pathname] = req.url.split('?');
    try {
      if (req.method === 'GET') {
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
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${host}` || req.headers['x-idlebot'] !== '1') return res.writeHead(403).end();
        const action = pathname.match(/^\/api\/profiles\/([1-4])\/(start|pause|stop|focus)$/);
        if (action) {
          await command(Number(action[1]), action[2]);
          return res.writeHead(204).end();
        }
      }
      res.writeHead(404).end();
    } catch (error) {
      console.error(error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
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
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
