import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import test from 'node:test';
import { WebSocket } from 'ws';
import { RemoteDesktop } from '../src/remote-desktop.mjs';
import { Session } from '../src/session.mjs';

test('one controller can connect after the bot drains and returning control revokes the connection', async () => {
  const vnc = createTcpServer((socket) => socket.write('RFB 003.008\n'));
  vnc.listen(0, '127.0.0.1');
  await once(vnc, 'listening');
  const desktop = new RemoteDesktop(() => vnc.address().port);
  const server = createServer();
  server.on('upgrade', (request, socket, head) => desktop.upgrade(request, socket, head));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/api/profiles/1/screen`;
  let finishPause;
  const pausing = new Promise((resolve) => { finishPause = resolve; });
  const session = new Session({ id: 1 }, {}, { profileAccount: () => null }, () => {});
  session.desired = true;
  session.online = true;
  session.browser = { socket: {} };
  session.pendingTick = pausing;
  const takeover = desktop.take(1, () => session.pauseAndDrain());
  let controller;
  try {
    assert.equal(desktop.state(1), 'pausing');
    assert.equal(session.active(), false);
    await assert.rejects(desktop.take(1, async () => {}), { status: 409 });
    const denied = new WebSocket(`${url}?control=invalid`);
    assert.match((await once(denied, 'error'))[0].message, /403/);
    finishPause();
    const token = await takeover;
    assert.equal(desktop.state(1), 'manual');
    controller = new WebSocket(`${url}?control=${token}`);
    assert.equal(String((await once(controller, 'message'))[0]), 'RFB 003.008\n');
    const second = new WebSocket(`${url}?control=${token}`);
    assert.match((await once(second, 'error'))[0].message, /409/);
    const disconnected = once(controller, 'close');
    desktop.release(1);
    await session.returnControl();
    await disconnected;
    assert.equal(desktop.state(1), 'automatic');
    assert.ok(session.active());
    const expired = new WebSocket(`${url}?control=${token}`);
    assert.match((await once(expired, 'error'))[0].message, /403/);
  } finally {
    finishPause();
    controller?.terminate();
    desktop.close();
    await Promise.all([new Promise((done) => server.close(done)), new Promise((done) => vnc.close(done))]);
  }
});
