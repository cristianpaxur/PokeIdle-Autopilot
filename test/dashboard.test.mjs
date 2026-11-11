import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createDashboard } from '../src/dashboard.mjs';

test('the dashboard exposes state and denies control requests from outside its own page', async () => {
  const commands = [];
  const dashboard = createDashboard({
    snapshot: () => ({ profiles: [{ id: 1, status: 'offline' }] }),
    preview: () => null,
    command: async (...args) => { commands.push(args); },
  });
  dashboard.server.listen(0, '127.0.0.1');
  await once(dashboard.server, 'listening');
  const url = `http://127.0.0.1:${dashboard.server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(`${url}/api/state`)).json(), { profiles: [{ id: 1, status: 'offline' }] });
    const path = `${url}/api/profiles/1/start`;
    const foreign = await fetch(path, { method: 'POST', headers: { Origin: 'https://example.org', 'X-IdleBot': '1' } });
    assert.equal(foreign.status, 403);
    const local = await fetch(path, { method: 'POST', headers: { Origin: url, 'X-IdleBot': '1' } });
    assert.equal(local.status, 204);
    const mode = await fetch(`${url}/api/profiles/1/mode/shiny`, {
      method: 'POST', headers: { Origin: url, 'X-IdleBot': '1' },
    });
    assert.equal(mode.status, 204);
    assert.deepEqual(commands, [[1, 'start'], [1, 'mode', 'shiny']]);
    assert.equal((await fetch(`${url}/`)).status, 200);
    assert.equal((await fetch(`${url}/mobile-qr.svg`)).status, 404);
  } finally {
    await dashboard.close();
  }
});

test('serves the mobile QR code only on the authenticated HTTPS dashboard', async (t) => {
  const origin = new URL('https://idlebot.example.ts.net:8443');
  const password = 'docker-test-password';
  const dashboard = createDashboard({
    snapshot: () => ({ remote: true }),
    preview: () => null,
    command: async () => {},
    remote: { origin, password, desktop: { close() {} } },
  });
  t.after(() => dashboard.close());
  dashboard.server.listen(0, '127.0.0.1');
  await once(dashboard.server, 'listening');
  const port = dashboard.server.address().port;
  const qrRequest = (headers = {}) => new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/mobile-qr.svg`, { headers: { Host: origin.host, ...headers } }, resolve)
      .on('error', reject);
  });
  const anonymous = await qrRequest();
  anonymous.resume();
  assert.equal(anonymous.statusCode, 401);
  const authorization = `Basic ${Buffer.from(`idlebot:${password}`).toString('base64')}`;
  const response = await qrRequest({ Authorization: authorization });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^image\/svg\+xml/);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  assert.match(Buffer.concat(chunks).toString(), /^<svg[\s\S]*<path[\s\S]*<\/svg>$/);
});

test('the Docker dashboard protects both its HTTP API and WebSocket upgrades', async () => {
  const origin = new URL('http://127.0.0.1:4097');
  const password = 'docker-test-password';
  let phoneQr = null;
  const desktop = {
    upgrade(_req, socket) { socket.end('HTTP/1.1 418 Test\r\nContent-Length: 0\r\n\r\n'); },
    close() {},
  };
  const dashboard = createDashboard({
    snapshot: () => ({ remote: true }),
    preview: () => null,
    command: async () => {},
    remote: { origin, password, desktop },
    mobileQr: () => phoneQr,
  });
  dashboard.server.listen(0, '127.0.0.1');
  await once(dashboard.server, 'listening');
  origin.port = dashboard.server.address().port;
  const url = origin.origin;
  try {
    const response = await fetch(`${url}/api/state`);
    assert.equal(response.status, 401);
    const login = await fetch(`${url}/api/state`, {
      headers: { Authorization: `Basic ${Buffer.from(`idlebot:${password}`).toString('base64')}` },
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${url}/mobile-qr.svg`)).status, 401);
    assert.equal((await fetch(`${url}/mobile-qr.svg`, { headers: { Cookie: cookie } })).status, 503);
    phoneQr = '<svg>paired-monitor</svg>';
    const qr = await fetch(`${url}/mobile-qr.svg`, { headers: { Cookie: cookie } });
    assert.equal(qr.status, 200);
    assert.equal(await qr.text(), phoneQr);
    const checkUpgrade = async (headers, status) => {
      const ws = new WebSocket(url.replace('http', 'ws') + '/api/profiles/1/screen', { headers });
      assert.match((await once(ws, 'error'))[0].message, new RegExp(String(status)));
    };
    await checkUpgrade({ Origin: origin.origin }, 403);
    await checkUpgrade({ Origin: 'https://example.org', Cookie: cookie }, 403);
    await checkUpgrade({ Origin: origin.origin, Cookie: cookie }, 418);
  } finally {
    await dashboard.close();
  }
});
