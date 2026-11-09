import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { createDashboard } from './dashboard.mjs';
import { Ledger } from './ledger.mjs';
import { Session } from './session.mjs';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const ledger = new Ledger(join(config.dataDir, 'idlebot.sqlite'));
const publish = () => dashboard.publish();
const sessions = config.profiles.map((profile) => new Session(profile, config, ledger, publish));
const commands = new Map();
const dashboard = createDashboard({
  snapshot: () => ({ profiles: sessions.map((session) => session.snapshot()) }),
  preview: (id) => sessions[id - 1].preview,
  async command(id, action) {
    const session = sessions[id - 1];
    const previous = commands.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (action !== 'focus') ledger.setEnabled(id, action === 'start');
      await session[action]();
    });
    commands.set(id, next);
    try {
      await next;
    } finally {
      if (commands.get(id) === next) commands.delete(id);
    }
  },
});

dashboard.server.listen(config.port, '127.0.0.1', () => {
  console.log(`IdleBot • http://127.0.0.1:${config.port}`);
  for (const session of sessions) {
    if (ledger.enabled(session.config.id) ?? session.config.autoStart) void session.start();
  }
});

const pulse = setInterval(publish, 15_000);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(pulse);
  const closed = dashboard.close();
  await Promise.allSettled([...commands.values()]);
  await Promise.allSettled(sessions.map((session) => session.stop()));
  await closed;
  ledger.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
