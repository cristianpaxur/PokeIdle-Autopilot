import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const quickAddress = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i;

export function startMobileTunnel(port, setOrigin) {
  let child;
  let retry;
  let stopped = false;

  function connect() {
    let address;
    let registered = false;
    child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    const deadline = setTimeout(() => child.kill('SIGTERM'), 50_000);
    const log = createInterface({ input: child.stderr });
    log.on('line', (line) => {
      address ??= line.match(quickAddress)?.[0];
      registered ||= line.includes('Registered tunnel connection');
      if (!stopped && address && registered) {
        clearTimeout(deadline);
        setOrigin(new URL(address));
      }
    });
    child.on('error', (error) => console.error(`Monitor do celular: ${error.code ?? error.name}`));
    child.once('close', () => {
      clearTimeout(deadline);
      log.close();
      setOrigin(null);
      if (!stopped) retry = setTimeout(connect, 10_000);
    });
  }

  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    setOrigin(null);
    child?.kill('SIGTERM');
  };
}
