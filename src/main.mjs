import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { createDashboard } from './dashboard.mjs';
import { Ledger } from './ledger.mjs';
import { createMobileMonitor } from './mobile-monitor.mjs';
import { startMobileTunnel } from './mobile-tunnel.mjs';
import { RemoteDesktop } from './remote-desktop.mjs';
import { Session } from './session.mjs';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const ledger = new Ledger(join(config.dataDir, 'idlebot.sqlite'));
const publish = () => {
  mobile?.syncScreens();
  dashboard.publish();
};
const sessions = config.profiles.map((profile) => new Session(profile, config, ledger, publish));
const desktop = config.remote ? new RemoteDesktop() : null;
const commands = new Map();
const snapshot = () => ({ remote: Boolean(desktop), profiles: sessions.map((session) => ({
  ...session.snapshot(), control: desktop?.state(session.config.id),
})) });
const mobile = desktop ? createMobileMonitor({ snapshot, desktop }) : null;
let stopMobileTunnel;
if (mobile) mobile.server.listen(0, '127.0.0.1', () => {
  if (!shuttingDown) stopMobileTunnel = startMobileTunnel(mobile.server.address().port, mobile.setOrigin);
});
const dashboard = createDashboard({
  remote: desktop ? { ...config.remote, desktop } : undefined,
  snapshot,
  mobileQr: mobile?.qr,
  preview: (id) => sessions[id - 1].preview,
  async command(id, action) {
    const session = sessions[id - 1];
    const previous = commands.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (desktop && action === 'take') {
        if (!session.desired) throw Object.assign(new Error('Abra o perfil antes de assumir o controle.'), { status: 409 });
        const token = await desktop.take(id, () => session.pauseAndDrain());
        publish();
        return { token };
      }
      if (desktop && action === 'release') {
        if (desktop.state(id) === 'automatic') return;
        desktop.release(id);
        await session.returnControl();
        publish();
        return;
      }
      if (desktop && desktop.state(id) !== 'automatic') {
        throw Object.assign(new Error('Devolva o controle antes de enviar outro comando.'), { status: 409 });
      }
      if (action !== 'focus') ledger.setEnabled(id, action === 'start');
      await session[action]();
    });
    commands.set(id, next);
    try {
      return await next;
    } finally {
      if (commands.get(id) === next) commands.delete(id);
    }
  },
});

dashboard.server.listen(config.port, config.host, () => {
  console.log(`IdleBot • ${config.remote?.origin.origin ?? `http://127.0.0.1:${config.port}`}`);
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
  stopMobileTunnel?.();
  const closed = Promise.all([dashboard.close(), mobile?.close()]);
  await Promise.allSettled([...commands.values()]);
  await Promise.allSettled(sessions.map((session) => session.stop()));
  await closed;
  ledger.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
