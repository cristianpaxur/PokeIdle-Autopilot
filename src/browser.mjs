import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

export const GAME_URL = 'https://pokeidle.io/app';
const GAME_ORIGIN = new URL(GAME_URL).origin;
const GAME_SOCKET = 'wss://pokeidle.io/';
const BUTTON_WAIT = 1800;
const CAPTURE_WAIT = 4000;
const click = (page, selector) => page.locator(selector).first().click({ timeout: BUTTON_WAIT });

export async function acceptGameUpdate(page) {
  const button = page.locator('#aviso-versao:visible #aviso-versao-btn:visible');
  if (!(await button.isVisible())
    || await page.locator('#confirmar:visible, #termos-aceite:visible').first().isVisible()) return false;
  await button.click({ timeout: BUTTON_WAIT });
  return true;
}

export async function clickCapture(page) {
  const ball = page.locator('#caidos-bolas .caidos-bola.on:visible');
  const target = page.locator('#caidos-lista .caido:not(.acabando):visible').first();
  if (!(await ball.isVisible()) || !(await target.isVisible())) return false;
  try {
    await target.click({ timeout: CAPTURE_WAIT });
    return true;
  } catch (error) {
    if (error.name === 'TimeoutError') return false;
    throw error;
  }
}

export async function prepareListing(page, pokemon, price, days) {
  if (await page.locator('#confirmar:visible').isVisible()) return false;
  if (!(await page.locator('#cm-anunciar:visible').isVisible())) await click(page, 'button[data-modal="community"]:visible');
  await click(page, '#cm-anunciar:visible');
  await click(page, '.cm-escolha [data-tipo="pokemon"]:visible, button[data-tipo="pokemon"]:visible');
  const search = page.locator('#cm-pks-busca:visible');
  if (await search.isVisible()) await search.fill(pokemon.name);
  const card = page.locator(`#cm-pks [data-chave="cm-sel${pokemon.id}"]:visible`);
  try {
    await card.waitFor({ timeout: BUTTON_WAIT });
  } catch (error) {
    if (error.name === 'TimeoutError') return false;
    throw error;
  }
  await card.click({ timeout: BUTTON_WAIT });
  await click(page, '.cm-moedas-anuncio [data-moeda="orb"]:visible');
  const priceInput = page.locator('#cm-preco:visible');
  await priceInput.fill(String(price), { timeout: BUTTON_WAIT });
  if (!(await page.locator('.cm-moedas-anuncio [data-moeda="orb"].on:visible').isVisible())
    || Number(await priceInput.inputValue()) !== price || !await priceInput.evaluate((input) => input.checkValidity())) return false;
  await click(page, '#cm-publicar:visible');
  const duration = page.locator('#cm-dias:visible');
  if (Number(await duration.inputValue({ timeout: BUTTON_WAIT })) !== days) return false;
  await click(page, '#cm-dias-ok:visible');
  return page.locator('#confirmar:visible #confirmar-texto .dlg-custo').isVisible();
}

export async function prepareWithdrawal(page, amount, wallet) {
  if (await page.locator('#confirmar:visible').isVisible()) return false;
  if (!(await page.locator('#cm-withdraw:visible').isVisible())) await click(page, 'button[data-modal="community"]:visible');
  await click(page, '#cm-withdraw:visible');
  if (await page.locator('#orbs-sacar.travado:visible').isVisible()) return false;
  await page.locator('#sw-orbs:visible').fill(String(amount), { timeout: BUTTON_WAIT });
  await page.locator('#orbs-endereco:visible').fill(wallet, { timeout: BUTTON_WAIT });
  if (Number(await page.locator('#sw-orbs:visible').inputValue()) !== amount) return false;
  await click(page, '#orbs-sacar:visible');
  const address = page.locator('#confirmar:visible .dlg-carteira code');
  return await address.isVisible() && (await address.textContent()).trim() === wallet;
}

function hookSocket({ key, origin, socketUrl }) {
  if (location.origin !== origin) return;
  const original = WebSocket.prototype.send;
  let connection;
  WebSocket.prototype.send = function (payload) {
    if (this.url === socketUrl && this.readyState === WebSocket.OPEN) connection = this;
    return original.call(this, payload);
  };
  const allowed = new Set(['hunt.select', 'centro.curar', 'auto.set', 'shop.buy', 'market.historico',
    'market.historicoGlobal', 'market.meus', 'orbs.painel']);
  Object.defineProperty(window, key, {
    value: (message) => {
      if (!allowed.has(message.t) || connection?.readyState !== WebSocket.OPEN) return false;
      original.call(connection, JSON.stringify(message));
      return true;
    },
  });
}

export class GameBrowser {
  key = `idlebot_${randomUUID().replaceAll('-', '')}`;
  waiters = new Set();
  socket = null;

  async open(profileDir, channel, onFrame, onDisconnect, onClose, display) {
    this.context = await chromium.launchPersistentContext(profileDir, {
      channel: channel === 'chromium' ? undefined : channel,
      headless: false, viewport: display ? null : { width: 1320, height: 850 },
      env: display ? { ...process.env, DISPLAY: display } : undefined,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        ...(display ? ['--start-maximized', '--disable-background-mode'] : [])],
    });
    this.context.on('close', onClose);
    await this.context.addInitScript(hookSocket, { key: this.key, origin: GAME_ORIGIN, socketUrl: GAME_SOCKET });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.page.on('websocket', (socket) => {
      if (socket.url() !== GAME_SOCKET) return;
      this.socket = socket;
      socket.on('framereceived', ({ payload }) => {
        if (socket !== this.socket || typeof payload !== 'string') return;
        let message;
        try { message = JSON.parse(payload); } catch { return; }
        if (!message || typeof message.t !== 'string') return;
        onFrame(message);
        for (const waiter of this.waiters) {
          if (waiter.matches(message)) waiter.resolve(message);
        }
      });
      socket.on('close', () => {
        if (socket !== this.socket) return;
        this.socket = null;
        for (const waiter of this.waiters) waiter.resolve(null);
        onDisconnect();
      });
    });
    await this.page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  async send(message) {
    if (!this.page || !this.socket || new URL(this.page.url()).origin !== GAME_ORIGIN) return false;
    return this.page.evaluate(({ key, message }) => window[key]?.(message) === true, { key: this.key, message });
  }

  async response(matches, action, timeout = 7000) {
    let waiter;
    let timer;
    const result = new Promise((resolve) => {
      waiter = { matches, resolve };
      this.waiters.add(waiter);
      timer = setTimeout(() => resolve(null), timeout);
    });
    try {
      return await action() === false ? null : await result;
    } finally {
      clearTimeout(timer);
      this.waiters.delete(waiter);
    }
  }

  async confirm() {
    await click(this.page, '#confirmar:visible #confirmar-sim');
  }

  async dismiss() {
    await this.page.keyboard.press('Escape');
    await this.page.keyboard.press('Escape');
  }

  async close() {
    await this.context?.close();
  }
}
