import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createDashboard } from '../src/dashboard.mjs';

test('the dashboard exposes state and denies control requests from outside its own page', async () => {
  const dashboard = createDashboard({
    snapshot: () => ({ profiles: [{ id: 1, status: 'offline' }] }),
    preview: () => null,
    command: async () => {},
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
    assert.equal((await fetch(`${url}/`)).status, 200);
  } finally {
    await dashboard.close();
  }
});
