import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createMobileMonitor } from '../src/mobile-monitor.mjs';

test('a QR opens the read-only monitor and protects status, screens, and robot controls', async (t) => {
  const origin = new URL('https://sample-idlebot.trycloudflare.com');
  const profile = { id: 1, status: 'hunting', active: true, control: 'automatic', account: 'private-name',
    mission: { sold: 5, target: 20, open: 3 }, withdrawals: [{ wallet: 'private-wallet' }] };
  const monitor = createMobileMonitor({
    snapshot: () => ({ profiles: [profile] }),
    desktop: { upgrade: (_req, socket) => socket.end('HTTP/1.1 418 Test\r\nContent-Length: 0\r\n\r\n') },
  });
  t.after(() => monitor.close());
  monitor.server.listen(0, '127.0.0.1');
  await once(monitor.server, 'listening');
  assert.equal(monitor.qr(), null);
  monitor.setOrigin(origin);
  const pairing = new URL(monitor.link());
  assert.equal(pairing.origin, origin.origin);
  assert.match(pairing.hash, /^#[\w-]{43}$/);
  assert.match(monitor.qr(), /^<svg/);

  const port = monitor.server.address().port;
  const http = (path, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    request({ hostname: '127.0.0.1', port, path, method, headers: { Host: origin.host, ...headers } }, async (response) => {
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() });
    }).on('error', reject).end();
  });
  assert.equal((await http('/api/state')).status, 401);
  assert.equal((await http('/api/state', { Authorization: 'Bearer invalid' })).status, 401);
  const paired = await http('/api/state', { Authorization: `Bearer ${pairing.hash.slice(1)}` });
  assert.equal(paired.status, 200);
  assert.match(paired.headers['set-cookie'][0], /Secure; HttpOnly; SameSite=Strict/);
  const cookie = paired.headers['set-cookie'][0].split(';')[0];
  assert.deepEqual(JSON.parse(paired.body).profiles[0].mission, profile.mission);
  assert.doesNotMatch(paired.body, /private-name|private-wallet/);
  assert.equal((await http('/api/state', { Cookie: cookie })).status, 200);
  assert.equal((await http('/api/profiles/1/stop', { Cookie: cookie }, 'POST')).status, 405);
  assert.equal((await http('/api/state', { Cookie: cookie, Host: 'wrong.example' })).status, 403);
  const upgrade = async (suffix, headers) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/profiles/1/screen${suffix}`, {
      headers: { Host: origin.host, Origin: origin.origin, ...headers },
    });
    return (await once(ws, 'error'))[0].message;
  };
  assert.match(await upgrade('', {}), /403/);
  assert.match(await upgrade('?control=secret', { Cookie: cookie }), /403/);
  assert.match(await upgrade('', { Cookie: cookie }), /418/);
  profile.control = 'manual';
  assert.match(await upgrade('', { Cookie: cookie }), /403/);
  monitor.setOrigin(new URL('https://replacement.trycloudflare.com'));
  assert.notEqual(new URL(monitor.link()).hash, pairing.hash);
});
