import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { collectionProfile, marketPage, ownedPokemon, pokemonAtlas, pokemonPortrait, SPRITE_SOURCES } from './catalog.mjs';
import { rejectUpgrade } from './remote-desktop.mjs';
import { qrSvg, serveAsset } from './web-assets.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/planner.js', ['planner.js', 'text/javascript; charset=utf-8']],
  ['/profile-summary.js', ['profile-summary.js', 'text/javascript; charset=utf-8']],
  ['/colecao', ['catalog.html', 'text/html; charset=utf-8']],
  ['/mercado', ['catalog.html', 'text/html; charset=utf-8']],
  ['/catalog.js', ['catalog.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/pokedex.css', ['pokedex.css', 'text/css; charset=utf-8']],
  ['/pokedex.js', ['pokedex.js', 'text/javascript; charset=utf-8']],
  ['/remote.js', ['remote.js', 'text/javascript; charset=utf-8']],
]);

const digest = (value) => createHash('sha256').update(value).digest();
const json = (res, value, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
const pokemonPath = /^\/pokemon\/[1-4]\/[1-9]\d{0,15}$/;

export function createDashboard({ snapshot, preview, command, remote, mobileQr, sessions = [] }) {
  const clients = new Set();
  const cookie = remote ? `idlebot_session=${randomBytes(32).toString('base64url')}` : '';
  const basic = remote ? digest(`Basic ${Buffer.from(`idlebot:${remote.password}`).toString('base64')}`) : null;
  const configuredQr = !mobileQr && remote?.origin.protocol === 'https:' ? qrSvg(remote.origin.origin) : null;
  const acceptsCookie = (req) => (req.headers.cookie ?? '').split(';').some((part) => part.trim() === cookie);
  const acceptsBasic = (req) => timingSafeEqual(digest(req.headers.authorization ?? ''), basic);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const localHost = `127.0.0.1:${server.address().port}`;
    const host = remote?.origin.host ?? localHost;
    const origin = remote?.origin.origin ?? `http://${host}`;
    const websocket = remote ? ` ${origin.replace(/^http/, 'ws')}` : '';
    res.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data: blob: ${SPRITE_SOURCES}; connect-src 'self'${websocket}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
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
        if (pathname === '/api/collection') return json(res, { profiles: sessions.map(collectionProfile) });
        if (pathname === '/api/pokemon-atlas') return json(res, await pokemonAtlas());
        const portrait = pathname.match(/^\/api\/pokemon-sprite\/([1-9]\d{0,6})$/);
        if (portrait) return json(res, await pokemonPortrait(portrait[1]));
        if (pathname === '/api/market') {
          const query = new URLSearchParams(req.url.split('?')[1]);
          return json(res, await marketPage(sessions, query));
        }
        const detail = pathname.match(/^\/api\/profiles\/([1-4])\/pokemon\/([1-9]\d{0,15})$/);
        if (detail) {
          const session = sessions.find(({ config }) => config.id === Number(detail[1]));
          const pokemon = ownedPokemon(session, Number(detail[2]));
          return pokemon ? json(res, pokemon) : json(res, { error: 'Exemplar indisponível. Confira se o perfil está conectado e se o Pokémon ainda pertence à conta.' }, 404);
        }
        if (pathname === '/mobile-qr.svg' && (mobileQr || configuredQr)) {
          const qr = mobileQr?.() ?? configuredQr;
          if (!qr) return res.writeHead(503).end();
          return res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }).end(qr);
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
        if (await serveAsset(res, pokemonPath.test(pathname) ? '/colecao' : pathname, files, Boolean(remote))) return;
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['x-idlebot'] !== '1') return res.writeHead(403).end();
        const planner = pathname.match(/^\/api\/profiles\/([1-4])\/planner$/);
        if (planner) {
          if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
            return json(res, { error: 'Envie as opções em JSON.' }, 415);
          }
          const chunks = [];
          let bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 8192) return json(res, { error: 'Opções muito extensas.' }, 413);
            chunks.push(chunk);
          }
          let value;
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { return json(res, { error: 'Opções inválidas.' }, 400); }
          return json(res, await command(Number(planner[1]), 'planner', value));
        }
        const mode = pathname.match(/^\/api\/profiles\/([1-4])\/mode\/(farm|shiny)$/);
        if (mode) {
          await command(Number(mode[1]), 'mode', mode[2]);
          return res.writeHead(204).end();
        }
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
