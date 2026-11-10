import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { rejectUpgrade } from './remote-desktop.mjs';
import { qrSvg, serveAsset } from './web-assets.mjs';

const files = new Map([
  ['/', ['mobile.html', 'text/html; charset=utf-8']],
  ['/mobile.js', ['mobile.js', 'text/javascript; charset=utf-8']],
  ['/remote.js', ['remote.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const digest = (value) => createHash('sha256').update(value).digest();
const secret = () => randomBytes(32).toString('base64url');
const screenAvailable = (profile) => profile?.active && !profile.paused && profile.control === 'automatic'
  && ['hunting', 'ready', 'waiting'].includes(profile.status);

export function createMobileMonitor({ snapshot, desktop }) {
  let access = null;
  const viewers = new Map();
  const disconnectViewers = () => { for (const socket of viewers.keys()) socket.destroy(); };
  const acceptsCookie = (request) => access && (request.headers.cookie ?? '').split(';')
    .some((part) => part.trim() === access.cookie);

  const server = createServer(async (request, response) => {
    if (!access || request.headers.host !== access.origin.host) return response.writeHead(403).end();
    if (request.method !== 'GET') return response.writeHead(405, { Allow: 'GET' }).end();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', `default-src 'self'; connect-src 'self' ${access.origin.origin.replace('https:', 'wss:')}; img-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    const [path] = request.url.split('?');
    if (path === '/health') return response.writeHead(204).end();
    if (path === '/api/state') {
      if (!acceptsCookie(request)) {
        if (!timingSafeEqual(digest(request.headers.authorization ?? ''), access.bearer)) return response.writeHead(401).end();
        response.setHeader('Set-Cookie', `${access.cookie}; Secure; HttpOnly; SameSite=Strict; Path=/`);
      }
      const profiles = snapshot().profiles.map((profile) => ({
        id: profile.id, status: profile.status, hunt: profile.hunt, mission: profile.mission,
        captures: profile.metrics?.captures ?? 0, screen: Boolean(screenAvailable(profile)),
      }));
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ profiles }));
    }
    try {
      if (await serveAsset(response, path, files, Boolean(desktop))) return;
      response.writeHead(404).end();
    } catch {
      response.writeHead(404).end();
    }
  });

  server.on('upgrade', (request, socket, head) => {
    const route = request.url.match(/^\/api\/profiles\/([1-4])\/screen$/);
    if (!desktop || !access || !route || request.headers.host !== access.origin.host
      || request.headers.origin !== access.origin.origin || !acceptsCookie(request)
      || !screenAvailable(snapshot().profiles.find(({ id }) => id === Number(route[1])))) {
      return rejectUpgrade(socket, 403, 'Forbidden');
    }
    viewers.set(socket, Number(route[1]));
    socket.once('close', () => viewers.delete(socket));
    desktop.upgrade(request, socket, head);
  });

  return {
    server,
    setOrigin(origin) {
      if (access?.origin.origin === origin?.origin) return;
      disconnectViewers();
      if (!origin) { access = null; return; }
      const token = secret();
      const link = `${origin.origin}/#${token}`;
      access = { origin, link, qr: qrSvg(link), bearer: digest(`Bearer ${token}`), cookie: `idlebot_view=${secret()}` };
    },
    link: () => access?.link ?? null,
    qr: () => access?.qr ?? null,
    syncScreens() {
      if (!viewers.size) return;
      const profiles = snapshot().profiles;
      for (const [socket, id] of viewers) {
        if (!screenAvailable(profiles.find((profile) => profile.id === id))) socket.destroy();
      }
    },
    close() {
      disconnectViewers();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
