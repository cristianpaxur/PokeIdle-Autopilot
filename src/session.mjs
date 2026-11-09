import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { clickCapture, GameBrowser, prepareListing, prepareWithdrawal } from './browser.mjs';
import { GameState, pokemonFrom } from './game-state.mjs';
import { openNativeLogin } from './native-login.mjs';
import { netGems, quote, withdrawalAmount } from './policy.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const accountError = /^(auth\.|login\.limiteOnlineIp)/;
const marketReply = (tab) => (message) => message.t === 'market' && message.aba === tab;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

export class Session {
  state = new GameState();
  browser = null;
  desired = false;
  paused = false;
  online = false;
  status = 'offline';
  note = 'Perfil fechado.';
  account = null;
  seq = 900_000_000;
  preview = null;
  due = {};
  attemptedNativeLogin = false;

  constructor(config, appConfig, ledger, publish) {
    this.config = config;
    this.appConfig = appConfig;
    this.ledger = ledger;
    this.publish = publish;
    this.account = ledger.profileAccount(config.id);
  }

  update(status, note) {
    this.status = status;
    this.note = note;
    this.publish();
  }

  async start() {
    if (this.desired) {
      this.paused = false;
      if (this.status === 'login') this.attemptedNativeLogin = false;
      this.publish();
      return;
    }
    this.desired = true;
    this.paused = false;
    this.attemptedNativeLogin = false;
    this.task = this.run();
  }

  pause() {
    this.paused = true;
    if (this.online) this.update('paused', 'Automação pausada. A janela do jogo continua aberta.');
  }

  async focus() {
    await this.browser?.page?.bringToFront();
  }

  async stop() {
    this.desired = false;
    this.online = false;
    this.preview = null;
    await this.browser?.close().catch(() => {});
    await this.task;
    this.update('offline', 'Perfil fechado.');
  }

  async run() {
    const profile = join(this.appConfig.dataDir, 'profiles', String(this.config.id));
    if (!this.account) await this.authenticate(profile);
    while (this.desired) {
      const browser = new GameBrowser();
      let needsLogin = false;
      this.browser = browser;
      this.state = new GameState();
      this.online = false;
      this.preview = null;
      this.update('opening', 'Abrindo a janela do PokeIdle…');
      try {
        await browser.open(profile, this.appConfig.channel,
          (message) => this.frame(message), () => this.disconnected(),
          () => {
            this.online = false;
            if (this.browser === browser) this.browser = null;
          });
        while (this.desired && this.browser === browser && !browser.page.isClosed()) {
          try {
            await this.tick();
          } catch (error) {
            if (this.online && this.desired) this.update('warning', `Ação interrompida. ${error.message.split('\n')[0].slice(0, 145)}`);
          }
          if (this.status === 'login' && !this.attemptedNativeLogin) {
            needsLogin = true;
            break;
          }
          await delay(1100);
        }
      } catch (error) {
        if (this.desired) this.update('warning', `Falha ao abrir o perfil. ${error.message.split('\n')[0].slice(0, 145)}`);
      } finally {
        await browser.close().catch(() => {});
      }
      if (needsLogin && this.desired) {
        await this.authenticate(profile);
        continue;
      }
      if (this.desired) {
        this.update('reconnecting', 'A janela fechou. Tentando reabrir em 10 segundos.');
        for (let second = 0; second < 10 && this.desired; second++) await delay(1000);
      }
    }
  }

  async authenticate(profile) {
    this.attemptedNativeLogin = true;
    this.update('native-login', 'Entre no navegador normal. Quando o jogo carregar, feche essa janela para retomar.');
    try {
      const browser = await openNativeLogin(this.appConfig.channel, profile);
      while (this.desired && browser.exitCode === null && browser.signalCode === null) await delay(800);
    } catch (error) {
      this.update('warning', `Falha ao abrir o navegador para login. ${error.message}`);
      await delay(2500);
    }
  }

  frame(message) {
    try {
      const captures = this.state.consume(message);
      if (message.t === 'welcome') {
        const nick = this.state.player?.nick;
        this.online = typeof nick === 'string' && nick.length > 0 && this.ledger.bind(this.config.id, nick);
        if (!this.online) {
          this.update('blocked', 'Este perfil já está vinculado a outra conta ou a conta está aberta em outro perfil.');
          return;
        }
        this.account = nick;
        this.attemptedNativeLogin = false;
        this.due = {};
        this.update('ready', 'Sessão autenticada.');
      }
      if (message.t === 'erro' && accountError.test(message.chave ?? '')) {
        this.online = false;
        this.preview = null;
        this.update('blocked', `O jogo restringiu a sessão (${message.chave}).`);
      }
      if (!this.online || !this.account) return;
      for (const capture of captures) this.ledger.addCapture(this.account, capture);
      if (captures.length || message.t === 'orbs') this.publish();
    } catch (error) {
      this.update('warning', `Falha ao registrar evento. ${error.message.split('\n')[0].slice(0, 115)}`);
    }
  }

  disconnected() {
    this.online = false;
    this.preview = null;
    if (this.desired && this.status !== 'blocked') this.update('reconnecting', 'Aguardando reconexão do jogo.');
  }

  active() {
    return this.desired && this.online && !this.paused && this.browser?.socket;
  }

  elapsed(key, interval) {
    const now = Date.now();
    if (now < (this.due[key] ?? 0)) return false;
    this.due[key] = now + interval;
    return true;
  }

  async tick() {
    const page = this.browser.page;
    if (!this.online) {
      if (this.status !== 'blocked' && await page.locator('#login:visible, #confirmar-email:visible').first().isVisible()) {
        if (this.status !== 'login') this.update('login', 'Use Entrar para autenticar no navegador normal.');
      }
      return;
    }
    if (this.elapsed('preview', 6000)) await this.updatePreview(page);
    if (!this.active()) return;
    if (await page.locator('#termos-aceite:visible, #login:visible, #confirmar:visible').first().isVisible()) {
      if (this.status !== 'blocked') this.update('blocked', 'O jogo está aguardando uma confirmação na janela.');
      return;
    }
    const player = this.state.player;
    if (!positiveInteger(player.activeId)) {
      if (this.status !== 'setup') this.update('setup', 'Conclua a configuração inicial da conta no jogo.');
      return;
    }
    if (this.elapsed('supplies', 25_000) && await this.refill(player)) return;
    if (this.elapsed('hunt', 18_000) && await this.setHunt(player)) return;
    if (player.huntSlug && !player.noCentro && !player.automation?.autoBallSemParar
      && !player.automation?.autoBallAteCapturar && this.elapsed('throw', 2800)) await clickCapture(page);
    if (this.elapsed('history', 150_000)) await this.refreshSales();
    if (this.config.marketEnabled && this.elapsed('market', 42_000)) await this.market();
    if (this.config.withdrawal.enabled && this.elapsed('wallet', 120_000)) await this.withdraw();
    const next = player.huntSlug && !player.noCentro ? 'hunting' : 'waiting';
    const note = next === 'hunting' ? 'Caça e captura ativas.' : 'Aguardando a entrada na rota.';
    if (this.active() && this.status !== next) this.update(next, note);
  }

  async updatePreview(page) {
    const canvas = page.locator('#cena:visible');
    if (!(await canvas.isVisible())) return;
    try {
      this.preview = await canvas.screenshot({ type: 'jpeg', quality: 54, timeout: 1300 });
      this.previewAt = Date.now();
    } catch {
      this.preview = null;
    }
    this.publish();
  }

  async setHunt(player) {
    const automation = player.automation;
    if (automation && (!automation.autoRevive || !automation.autoPotion || !automation.autoVoltarHunt)
      && this.elapsed('auto', 180_000)) {
      return this.browser.send({ t: 'auto.set', ...automation, autoRevive: true, autoPotion: true, autoVoltarHunt: true });
    }
    if (player.boss?.arena || player.mistico || player.safari?.dentro || player.casa?.dentro) return false;
    const allowed = this.state.hunts.filter((hunt) => Number.isFinite(hunt.nivel) && hunt.nivel <= player.level);
    const chosen = this.config.hunt || player.huntSlug;
    const selected = chosen ? allowed.find((hunt) => hunt.slug === chosen)
      : allowed.reduce((first, hunt) => !first || hunt.nivel < first.nivel ? hunt : first, null);
    if (!selected || (selected.slug === player.huntSlug && !player.noCentro)) return false;
    return this.browser.send({ t: 'hunt.select', slug: selected.slug });
  }

  async refill(player) {
    const available = player.gold - this.config.goldReserve;
    if (!Number.isSafeInteger(available) || available <= 0) return false;
    const cheapest = (items, price) => items.filter((item) => positiveInteger(item.id) && positiveInteger(item[price]))
      .sort((first, second) => first[price] - second[price])[0];
    const ball = cheapest(this.state.balls.filter((item) => item.compravel), 'priceGold');
    const potion = cheapest(this.state.items.filter((item) => item.category === 'heal'), 'npcPrice');
    const revive = cheapest(this.state.items.filter((item) => item.category === 'revive'), 'npcPrice');
    const supply = [
      { item: ball, kind: 'ball', price: 'priceGold', have: Object.values(player.balls ?? {}).reduce((a, b) => a + b, 0), min: 8, batch: 40 },
      { item: potion, kind: 'item', price: 'npcPrice', have: player.items?.[potion?.id] ?? 0, min: 3, batch: 12 },
      { item: revive, kind: 'item', price: 'npcPrice', have: player.items?.[revive?.id] ?? 0, min: 2, batch: 6 },
    ].find((entry) => entry.item && entry.have < entry.min && entry.item[entry.price] <= available);
    if (!supply || !this.active()) return false;
    const quantity = Math.min(supply.batch, Math.floor(available / supply.item[supply.price]));
    return this.browser.send({ t: 'shop.buy', kind: supply.kind, id: supply.item.id, qty: quantity });
  }

  async askHistory(tab, filters = {}) {
    const seq = ++this.seq;
    const browser = this.browser;
    return browser.response((message) => marketReply(tab)(message) && message.seq === seq,
      () => this.active() && browser.send({ t: `market.${tab}`, pagina: 0, seq, ...filters }));
  }

  async refreshSales() {
    const account = this.account;
    const result = await this.askHistory('historico', { tipo: 'pokemon', moeda: 'orb' });
    if (!result || account !== this.account) return;
    for (const row of result.linhas ?? []) {
      const pokemonId = row.pokemonId ?? row.ficha?.id;
      if (positiveInteger(Number(pokemonId))) this.ledger.finish(account, 'listing', String(pokemonId), 'confirmed');
      this.ledger.addSale(account, row);
    }
    this.publish();
  }

  async market() {
    if (!this.active()) return;
    const account = this.account;
    if (this.ledger.pending(account, 'listing')) {
      const result = await this.browser.response(marketReply('meus'), () => this.browser.send({ t: 'market.meus' }));
      for (const row of result?.linhas ?? []) {
        const id = row.pokemonId ?? row.ficha?.id;
        if (positiveInteger(Number(id))) this.ledger.finish(account, 'listing', String(id), 'confirmed');
      }
      return;
    }
    const candidate = this.ledger.nextCandidate(account, Date.now() - 30 * 60_000);
    if (!candidate) return;
    const owned = this.state.pokemon.get(candidate.id);
    const current = pokemonFrom(owned);
    const player = this.state.player;
    if (!current || owned.slot != null || owned.starter || candidate.id === player.activeId
      || player.automation?.pokemonTravado?.some((id) => Number(id) === candidate.id)) {
      this.ledger.saveQuote(account, candidate.id, null);
      return;
    }
    const records = await this.askHistory('historicoGlobal', {
      tipo: 'pokemon', moeda: 'orb', busca: current.name,
      ...(current.shiny ? { soShiny: 1 } : {}), ...(current.power === 5 ? { soP5: 1 } : {}),
    });
    if (!Array.isArray(records?.linhas) || !this.active() || this.account !== account) return;
    const result = quote(current, records.linhas, this.ledger.accounts());
    const rules = this.state.market;
    const days = rules?.diasMin;
    const fee = days * rules?.taxaDiaria;
    const valuation = result && { ...result, net: netGems(result.gems), fee };
    this.ledger.saveQuote(account, candidate.id, valuation);
    this.publish();
    if (!valuation?.net || !positiveInteger(days) || !positiveInteger(fee)
      || fee > this.config.maxListingFee || player.gold - fee < this.config.goldReserve) return;

    const browser = this.browser;
    try {
      if (!await prepareListing(browser.page, current, result.gems, days) || !this.active() || this.account !== account) return;
      const quotedFee = await browser.page.locator('#confirmar:visible .dlg-custo-num').textContent({ timeout: 1000 });
      if (Number(quotedFee.replace(/[^0-9]/g, '')) !== fee) return;
      await this.confirmOperation(account, 'listing', String(current.id), valuation,
        marketReply('criado'));
    } finally {
      await browser.dismiss().catch(() => {});
    }
  }

  async withdraw() {
    if (!this.active()) return;
    const account = this.account;
    const browser = this.browser;
    const panel = await browser.response((message) => message.t === 'orbs',
      () => browser.send({ t: 'orbs.painel' }));
    if (!panel || !this.active() || account !== this.account) return;
    const recent = this.ledger.operations(account, 'withdrawal', 1)[0];
    if (recent && ['pending', 'uncertain'].includes(recent.state)) {
      const row = panel.saques?.find((entry) => entry.endereco === this.config.withdrawal.wallet
        && entry.orbs === recent.gems && Number(entry.criadoEm ?? entry.em) >= recent.time - 30_000);
      if (row) this.ledger.finish(account, 'withdrawal', recent.key, 'confirmed');
      return;
    }
    if (recent && Date.now() - recent.time < this.config.withdrawal.intervalMs) return;
    const gems = withdrawalAmount(panel, this.config.withdrawal);
    if (!gems) return;
    try {
      if (!await prepareWithdrawal(browser.page, gems, this.config.withdrawal.wallet)
        || !this.active() || this.account !== account) return;
      await this.confirmOperation(account, 'withdrawal', randomUUID(), { gems },
        (message) => message.t === 'batalha' && message.ev?.some((event) => event.k === 'orbsSaque' && event.orbs === gems));
    } finally {
      await browser.dismiss().catch(() => {});
    }
  }

  async confirmOperation(account, kind, key, details, matches) {
    if (!this.active() || account !== this.account || !this.ledger.begin(account, kind, key, details)) return;
    const browser = this.browser;
    let confirmed;
    try {
      confirmed = await browser.response(matches, () => this.active() && browser.confirm());
    } finally {
      this.ledger.finish(account, kind, key, confirmed ? 'confirmed' : 'uncertain');
      this.publish();
    }
  }

  snapshot() {
    const account = this.account;
    const player = this.online ? this.state.player : null;
    const panel = this.online ? this.state.panel : null;
    return {
      id: this.config.id, status: this.status, note: this.note, account,
      active: this.desired, paused: this.paused, preview: this.preview ? this.previewAt : null,
      hunt: player?.huntSlug ?? this.config.hunt, level: player?.level ?? null,
      gold: player?.gold ?? null, gems: panel?.saldo ?? player?.orbs ?? null,
      balls: player ? Object.values(player.balls ?? {}).reduce((a, b) => a + b, 0) : null,
      metrics: account ? this.ledger.metrics(account) : {},
      captures: account ? this.ledger.captures(account, 30) : [],
      sales: account ? this.ledger.sales(account) : [],
      listings: account ? this.ledger.operations(account, 'listing', 30) : [],
      withdrawals: account ? this.ledger.operations(account, 'withdrawal', 20) : [],
      paid: panel?.saques?.filter((entry) => entry.status === 'confirmado').map(({ orbs, usdt }) => ({ orbs, usdt })) ?? [],
    };
  }
}
