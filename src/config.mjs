import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const integer = (value, fallback, min, max) => value === undefined ? fallback
  : Number.isSafeInteger(value) && value >= min && value <= max ? value
    : (() => { throw new Error(`Valor inteiro esperado entre ${min} e ${max}.`); })();

export function loadConfig(file = process.env.IDLEBOT_DOCKER === '1' ? '/data/idlebot.local.json' : 'idlebot.local.json') {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Configuração inválida.');
  const profiles = raw.profiles ?? [];
  if (!Array.isArray(profiles) || profiles.length > 4) throw new Error('Configure até quatro perfis.');
  const docker = process.env.IDLEBOT_DOCKER === '1';
  const dataDir = docker ? '/data' : resolve(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'IdleBot');
  const channel = docker ? 'chromium' : raw.channel ?? 'msedge';
  if (!docker && !['msedge', 'chrome'].includes(channel)) throw new Error('Use msedge ou chrome.');
  let remote;
  if (docker) {
    const origin = new URL(process.env.IDLEBOT_ORIGIN ?? 'http://127.0.0.1:4097');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== `${origin.origin}/`) {
      throw new Error('IDLEBOT_ORIGIN deve conter apenas o protocolo, host e porta do painel.');
    }
    const password = process.env.IDLEBOT_PASSWORD;
    if (!password || password.length < 12) throw new Error('IDLEBOT_PASSWORD deve ter pelo menos 12 caracteres.');
    remote = { origin, password };
  }
  return {
    dataDir, channel, remote,
    port: docker ? 4096 : integer(raw.port, 4096, 1024, 65535),
    host: docker ? '0.0.0.0' : '127.0.0.1',
    profiles: Array.from({ length: 4 }, (_, index) => {
      const profile = profiles[index] ?? {};
      const wallet = profile.withdrawal ?? {};
      const hunt = profile.hunt ?? '';
      if (typeof hunt !== 'string' || !/^[a-z0-9-]*$/.test(hunt)) throw new Error('Rota de caça inválida.');
      return {
        id: index + 1, hunt, autoStart: profile.autoStart === undefined ? docker : profile.autoStart === true,
        display: docker ? `:${11 + index}` : undefined,
        goldReserve: integer(profile.goldReserve, 10_000, 0, Number.MAX_SAFE_INTEGER),
        maxListingFee: integer(profile.maxListingFee, 100_000, 0, Number.MAX_SAFE_INTEGER),
        marketEnabled: profile.marketEnabled !== false,
        withdrawal: {
          enabled: wallet.enabled === true,
          wallet: String(wallet.wallet ?? '').trim(),
          maxGems: integer(wallet.maxGems, 1000, 1000, 1_000_000),
          reserveGems: integer(wallet.reserveGems, 0, 0, Number.MAX_SAFE_INTEGER),
          intervalMs: integer(wallet.intervalHours, 24, 1, 168) * 3_600_000,
        },
      };
    }),
  };
}
