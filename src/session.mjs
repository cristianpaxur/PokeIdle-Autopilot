import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acceptGameUpdate, clickCapture, GAME_URL, GameBrowser, prepareListing, prepareWithdrawal } from './browser.mjs';
import { GameState, pokemonFrom } from './game-state.mjs';
import { pokemonAtlas } from './catalog.mjs';
import { HuntOptimizer } from './hunt-optimizer.mjs';
import { openNativeLogin } from './native-login.mjs';
import { farmPhase, hasShiny, identifyItemSale, isOutland, listingDecision, netGems, nextHunt,
  pickFarmHunt, quote, quoteItem, withdrawalAmount } from './policy.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const accountError = /^(auth\.|login\.limiteOnlineIp)/;
const marketReply = (tab) => (message) => message.t === 'market' && message.aba === tab;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const listedPokemonId = (row) => String(row.pokemonId ?? row.ficha?.id ?? '');
const FARM_STALL_MS = 180_000;
const RECOVERY_WAIT_MS = 45_000;
const awayFromHunt = (player) => player?.boss?.arena || player?.mistico || player?.safari?.dentro || player?.casa?.dentro;
const inHunt = (player) => Boolean(player?.huntSlug && !player.noCentro
  && !player.boss?.arena && !player.mistico && !player.safari?.dentro && !player.casa?.dentro);
// PokeIdle starter lines. The game publishes the required stones with the welcome frame.
const starterEvolutions = {
  1: { level: 40, target: 2, type: 'GRASS' }, 2: { level: 80, target: 3, type: 'GRASS' },
  4: { level: 40, target: 5, type: 'FIRE' }, 5: { level: 80, target: 6, type: 'FIRE' },
  7: { level: 40, target: 8, type: 'WATER' }, 8: { level: 80, target: 9, type: 'WATER' },
};

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
  historyReady = false;
  farmSample = null;
  recovery = null;
  monitorSince = null;
  marketStatus = null;

  constructor(config, appConfig, ledger, publish) {
    this.config = config;
    this.appConfig = appConfig;
    this.ledger = ledger;
    this.publish = publish;
    this.account = ledger.profileAccount(config.id);
    this.mode = ledger.mode(config.id) ?? config.mode ?? 'farm';
    this.optimizer = new HuntOptimizer({
      load: (context) => this.ledger.huntSamples(this.account, context),
      save: (sample) => this.ledger.saveHuntSample(this.account, sample),
    });
  }

  update(status, note) {
    this.status = status;
    this.note = note;
    this.publish();
  }

  async start() {
    if (this.desired) {
      if (this.paused) this.monitorSince = Date.now();
      this.paused = false;
      if (this.status === 'login') this.attemptedNativeLogin = false;
      this.publish();
      return;
    }
    this.desired = true;
    this.paused = false;
    this.monitorSince = Date.now();
    this.attemptedNativeLogin = false;
    this.task = this.run();
  }

  pause() {
    this.optimizer.suspend();
    this.sampleFarm(false);
    this.paused = true;
    this.recovery = null;
    if (this.online) this.update('paused', 'Automação pausada. A janela do jogo continua aberta.');
  }

  async pauseAndDrain() {
    this.pause();
    await this.pendingTick?.catch(() => {});
    await this.marketRequest?.promise.catch(() => {});
  }

  async returnControl() {
    const native = await this.nativeStartup?.catch(() => null);
    if (this.config.display && native?.exitCode === null) native.kill('SIGTERM');
    const page = this.browser?.page;
    if (page && !page.isClosed() && page.url().split(/[?#]/)[0] !== GAME_URL) {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    }
    await this.start();
  }

  async focus() {
    await this.browser?.page?.bringToFront();
  }

  async stop() {
    this.optimizer.suspend();
    this.sampleFarm(false);
    this.desired = false;
    this.online = false;
    this.preview = null;
    if (this.config.display && this.nativeBrowser?.exitCode === null) this.nativeBrowser.kill('SIGTERM');
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
      this.monitorSince = Date.now();
      this.preview = null;
      this.update('opening', 'Abrindo a janela do PokeIdle…');
      try {
        await browser.open(profile, this.appConfig.channel,
          (message) => this.frame(message), () => this.disconnected(),
          () => {
            this.sampleFarm(false);
            this.online = false;
            if (this.browser === browser) this.browser = null;
          }, this.config.display);
        while (this.desired && this.browser === browser && !browser.page.isClosed()) {
          try {
            this.pendingTick = this.tick();
            await this.pendingTick;
          } catch (error) {
            if (this.online && this.desired) this.update('warning', `Ação interrompida. ${error.message.split('\n')[0].slice(0, 145)}`);
          } finally {
            this.pendingTick = null;
          }
          if (this.status === 'login' && !this.attemptedNativeLogin && !this.paused) {
            needsLogin = true;
            break;
          }
          if (this.desired) await delay(1100);
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
    this.update('native-login', this.config.display
      ? 'Assuma o controle para entrar. Quando o jogo carregar, devolva ao robô.'
      : 'Entre no navegador normal. Quando o jogo carregar, feche essa janela para retomar.');
    try {
      this.nativeStartup = openNativeLogin(this.appConfig.channel, profile, this.config.display);
      const browser = await this.nativeStartup;
      this.nativeBrowser = browser;
      if (!this.desired && this.config.display) browser.kill('SIGTERM');
      while (this.desired && browser.exitCode === null && browser.signalCode === null) await delay(800);
    } catch (error) {
      this.update('warning', `Falha ao abrir o navegador para login. ${error.message}`);
      await delay(2500);
    } finally {
      this.nativeStartup = null;
      this.nativeBrowser = null;
    }
  }

  frame(message) {
    try {
      if (message.t === 'welcome') {
        this.optimizer.suspend();
        this.sampleFarm(false);
        const nick = message.estado?.nick;
        this.online = typeof nick === 'string' && nick.length > 0 && this.ledger.bind(this.config.id, nick);
        if (!this.online) {
          this.update('blocked', 'Este perfil já está vinculado a outra conta ou a conta está aberta em outro perfil.');
          return;
        }
        this.account = nick;
        this.state.consume(message);
        this.monitorSince = Date.now();
        this.marketCache = null;
        this.attemptedNativeLogin = false;
        this.due = {};
        this.historyReady = false;
        this.update('ready', 'Sessão autenticada.');
      }
      if (message.t === 'erro' && accountError.test(message.chave ?? '')) {
        this.sampleFarm(false);
        this.online = false;
        this.preview = null;
        this.update('blocked', `O jogo restringiu a sessão (${message.chave}).`);
      }
      if (!this.online || !this.account) return;
      const captures = message.t === 'welcome' ? [] : this.state.consume(message);
      if (message.t === 'batalha' && Array.isArray(message.ev) && this.active()
        && this.status === 'hunting' && this.onStrategyHunt()) {
        const player = this.state.player;
        this.ledger.recordFarm(this.account, this.phase(), player.huntSlug, this.state.farmEvents(message.ev));
      }
      if (this.active() && this.phase() === 'progression' && message.t === 'batalha') {
        this.optimizer.recordBattle(message.ev ?? []);
      }
      this.observeOptimization();
      if (this.farmSample && !this.onStrategyHunt()) this.sampleFarm(false);
      for (const capture of captures) this.ledger.addCapture(this.account, capture);
      if (message.t === 'batalha' && Array.isArray(message.ev)
        && message.ev.some(({ k }) => k === 'marketVendido')) this.due.history = 0;
      if (captures.length || message.t === 'orbs') this.publish();
    } catch (error) {
      this.update('warning', `Falha ao registrar evento. ${error.message.split('\n')[0].slice(0, 115)}`);
    }
  }

  disconnected() {
    this.optimizer.suspend();
    this.sampleFarm(false);
    this.online = false;
    this.monitorSince = Date.now();
    this.preview = null;
    if (this.desired && this.status !== 'blocked') this.update('reconnecting', 'Aguardando reconexão do jogo.');
  }

  active() {
    return this.desired && this.online && !this.paused && this.browser?.socket;
  }

  setMode(mode) {
    if (!['farm', 'shiny'].includes(mode)) throw new Error('Modo de caça inválido.');
    this.sampleFarm(false);
    this.optimizer.suspend();
    this.ledger.setMode(this.config.id, mode);
    this.mode = mode;
    this.monitorSince = Date.now();
    this.recovery = null;
    this.marketStatus = null;
    this.due.hunt = 0;
    this.due.auto = 0;
    this.due.market = 0;
    this.publish();
  }

  phase() {
    return farmPhase(this.mode, this.state.player?.level);
  }

  sampleFarm(tracking, now = Date.now()) {
    const sample = this.farmSample;
    const slug = tracking ? this.state.player?.huntSlug : null;
    const phase = tracking ? this.phase() : null;
    const sameRoute = Boolean(tracking && sample && sample.slug === slug && sample.phase === phase && sample.account === this.account);
    if (sample) {
      const delta = now - sample.lastAt;
      if (delta > 0 && delta <= 30_000) sample.milliseconds += delta;
      sample.lastAt = now;
      if (!sameRoute || sample.milliseconds >= 15_000) {
        this.ledger.recordFarm(sample.account, sample.phase, sample.slug, { huntMs: sample.milliseconds }, now);
        sample.milliseconds = 0;
      }
    }
    this.farmSample = sameRoute ? sample : tracking && slug
      ? { account: this.account, slug, phase, lastAt: now, milliseconds: 0 } : null;
  }

  onStrategyHunt() {
    const player = this.state.player;
    if (!inHunt(player)) return false;
    const hunt = this.state.hunts.find(({ slug }) => slug === player.huntSlug);
    if (!hunt) return false;
    const phase = this.phase();
    return phase === 'outland' ? isOutland(hunt)
      : !isOutland(hunt) && (phase !== 'shiny' || hasShiny(hunt, this.state.shinyLooks));
  }

  checkpointFarm() {
    this.sampleFarm(Boolean(this.account && this.active() && this.status === 'hunting' && this.onStrategyHunt()));
    this.observeOptimization();
  }

  observeOptimization() {
    const player = this.state.player;
    const trained = player && this.account && this.ledger.trainingPokemon(this.account);
    const pokemon = this.state.pokemon.get(trained) ?? this.state.pokemon.get(player?.activeId);
    this.optimizer.observe({
      enabled: Boolean(this.account && this.active() && this.phase() === 'progression'
        && !['blocked', 'setup'].includes(this.status) && !player?.boss?.arena && !player?.mistico
        && !player?.safari?.dentro && !player?.casa?.dentro),
      player, pokemon,
    });
  }

  elapsed(key, interval) {
    const now = Date.now();
    if (now < (this.due[key] ?? 0)) return false;
    this.due[key] = now + interval;
    return true;
  }

  async tick() {
    try {
      await this.runTick();
    } finally {
      this.checkpointFarm();
    }
  }

  async runTick() {
    const page = this.browser.page;
    if (this.account && this.desired && !this.paused && this.elapsed('gameUpdate', 60_000)
      && await acceptGameUpdate(page)) return;
    if (!this.online) {
      if (this.status !== 'blocked' && await page.locator('#login:visible, #confirmar-email:visible').first().isVisible()) {
        if (this.status !== 'login') this.update('login', 'Use Entrar para autenticar no navegador normal.');
      } else if (this.account && this.desired && !this.paused && this.status !== 'blocked'
        && this.monitorSince != null && Date.now() - this.monitorSince >= FARM_STALL_MS) {
        this.monitorSince = Date.now();
        await this.reloadGame();
      }
      return;
    }
    if (!this.config.display && this.elapsed('preview', 6000)) await this.updatePreview(page);
    if (!this.active()) return;
    if ((this.config.marketEnabled || this.ledger.openListings(this.account).length) && this.elapsed('history', 90_000)) {
      this.historyReady = await this.refreshSales();
    }
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
    if (await this.recoverFarm()) return;
    if (player.noCentro && !player.boss?.arena && !player.mistico && !player.safari?.dentro && !player.casa?.dentro
      && [...this.state.pokemon.values()].some((pokemon) => pokemon.slot != null && pokemon.hp < pokemon.maxHp)) {
      const note = 'Recuperando a equipe no Centro Pokémon antes de voltar à rota.';
      if (this.status !== 'waiting' || this.note !== note) this.update('waiting', note);
      if (this.active() && this.elapsed('centerHeal', 10_000)) await this.browser.send({ t: 'centro.curar' });
      return;
    }
    const phase = this.phase();
    if (phase === 'progression' && !player.boss?.arena && !player.mistico && !player.safari?.dentro
      && !player.casa?.dentro && await this.trainPokemon(player)) return;
    const needsCaptures = phase === 'shiny';
    if (this.elapsed('supplies', 25_000) && await this.refill(player, needsCaptures)) return;
    if (await this.setHunt(player)) return;
    if (this.active() && this.phase() === 'shiny' && this.onStrategyHunt() && !player.automation?.autoBallSemParar
      && !player.automation?.autoBallAteCapturar && this.elapsed('throw', 2800)) {
      const hunt = this.state.hunts.find(({ slug }) => slug === this.state.player.huntSlug);
      const eligible = hunt.especies.filter(({ pokeId }) => this.state.shinyLooks[pokeId] != null);
      const names = eligible.length < hunt.especies.length && eligible.every(({ nome }) => typeof nome === 'string' && nome)
        ? eligible.map(({ nome }) => nome) : undefined;
      await clickCapture(page, names);
    }
    if (this.historyReady && (this.config.marketEnabled || this.ledger.openListings(this.account).length)
      && this.elapsed('market', 42_000)) await this.market();
    if (this.config.withdrawal?.enabled && this.elapsed('wallet', 120_000)) await this.withdraw();
    const next = this.onStrategyHunt() ? 'hunting' : 'waiting';
    const currentPhase = this.phase();
    const hasBalls = Object.values(player.balls ?? {}).some((amount) => amount > 0);
    const note = next !== 'hunting' ? 'Aguardando uma rota segura para o modo selecionado.'
      : currentPhase === 'progression' ? 'Treinando o Pokémon principal até liberar a Outland.'
        : currentPhase === 'outland' ? 'Farmando tokens e fragmentos na Outland.'
          : hasBalls ? 'Capturando em uma rota com espécies shiny.' : 'Caçando por ouro para repor bolas.';
    if (this.active() && (this.status !== next || this.note !== note)) this.update(next, note);
  }

  async reloadGame() {
    const browser = this.browser;
    this.update('recovering', 'Recarregando o jogo para recuperar a sessão.');
    try {
      await browser.page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    } catch {
      await browser.close?.().catch(() => {});
    }
  }

  async recoverFarm(now = Date.now()) {
    const player = this.state.player;
    const hunt = this.state.hunt;
    if (!this.active() || !player?.activeId || awayFromHunt(player)) return false;
    if (this.recovery && this.state.lastProgressAt > this.recovery.startedAt) this.recovery = null;
    const since = Math.max(this.monitorSince ?? hunt?.startedAt ?? now,
      this.state.lastProgressAt ?? 0, this.recovery ? 0 : hunt?.startedAt ?? 0);
    if (now - since < FARM_STALL_MS) return false;
    const attempt = this.recovery;
    if (attempt && now < attempt.nextAt) return true;
    const route = this.state.hunts.find(({ slug }) => slug === (player.huntSlug || hunt?.slug));
    const options = this.state.huntOptions(now);
    const blocked = new Set([...options.blocked, ...this.optimizer.blockedHunts(now)]);
    const fallback = nextHunt(this.state.hunts, player, {
      ...options, blocked: new Set([...blocked, route?.slug]), phase: this.phase(), shinyLooks: this.state.shinyLooks,
    });
    if (!route && !fallback) return false;
    const stage = attempt?.stage ?? 0;
    if (stage < 2 && !this.state.canSwitchHunt(now) && now - since < FARM_STALL_MS + RECOVERY_WAIT_MS) return false;
    const target = stage === 0 && route && !blocked.has(route.slug) ? route : stage < 2 ? fallback : null;
    this.sampleFarm(false, now);
    this.optimizer.suspend();
    this.recovery = { startedAt: attempt?.startedAt ?? now, since, stage: stage + 1, nextAt: now + RECOVERY_WAIT_MS };
    if (target && this.state.canSwitchHunt(now)) {
      if (target === fallback && route) this.state.huntLocks.set(route.slug, now + 600_000);
      this.update('recovering', target === route
        ? 'Caça sem progresso. Tentando voltar à rota.'
        : 'Caça sem progresso. Tentando uma rota segura.');
      await this.browser.send({ t: 'hunt.select', slug: target.slug });
    } else {
      this.monitorSince = now;
      await this.reloadGame();
    }
    return true;
  }

  async trainPokemon(player) {
    const stored = this.ledger.trainingPokemon(this.account);
    const previous = this.state.pokemon.get(stored);
    const main = previous?.slot != null ? previous : this.state.pokemon.get(player.activeId);
    if (!main || main.slot == null || !this.active()) return false;
    if (stored !== Number(main.id)) this.ledger.setTrainingPokemon(this.account, Number(main.id));
    if (Number(main.id) !== player.activeId && main.hp > 0 && this.state.canSwitchHunt(Date.now())) {
      return this.elapsed('trainingActive', 10_000)
        && this.browser.send({ t: 'team.active', pokemonId: Number(main.id) });
    }
    const evolution = main.starter && !main.shiny && starterEvolutions[main.speciesId];
    const stone = this.state.evolutionStones[evolution?.type]?.itemId;
    if (evolution && main.level >= evolution.level && player.items?.[stone] > 0
      && this.elapsed('evolve', 20_000)) {
      return this.browser.send({ t: 'pokemon.evoluir', pokemonId: Number(main.id), alvoId: evolution.target });
    }
    return false;
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
    const phase = this.phase();
    const stopBalls = phase !== 'shiny' && (automation?.autoBallSemParar || automation?.autoBallAteCapturar);
    if (automation && (!automation.autoRevive || !automation.autoPotion || !automation.autoVoltarHunt || stopBalls)
      && this.elapsed('auto', 180_000)) {
      return this.browser.send({ t: 'auto.set', ...automation, autoRevive: true, autoPotion: true, autoVoltarHunt: true,
        ...(stopBalls ? { autoBallSemParar: false, autoBallAteCapturar: false } : {}) });
    }
    const now = Date.now();
    if (!this.state.canSwitchHunt(now) || now < (this.due.hunt ?? 0)) return false;
    const atlas = await pokemonAtlas().catch(() => null);
    if (!this.active() || this.state.player !== player || this.phase() !== phase) return false;
    const trained = this.ledger.trainingPokemon(this.account);
    const pokemon = this.state.pokemon.get(trained) ?? this.state.pokemon.get(this.state.player.activeId);
    const species = atlas?.species ?? {};
    const options = this.state.huntOptions(now);
    const blocked = new Set([...options.blocked, ...this.optimizer.blockedHunts(now)]);
    const routeSamples = phase === 'progression' ? null : this.ledger.farmRoutes(this.account, phase, now);
    const selected = nextHunt(this.state.hunts, player, {
      ...options, blocked, pinned: this.config.hunt, phase, shinyLooks: this.state.shinyLooks,
      species, typeChart: this.state.typeChart,
      attackTypes: pokemon?.tipos ?? species[pokemon?.speciesId]?.types ?? [],
      select: routeSamples ? (candidates) => pickFarmHunt(phase, candidates, routeSamples, player.huntSlug)
        : this.optimizer.context ? (candidates) => this.optimizer.choose(candidates, player) : undefined,
    });
    if (!selected || !this.active() || !this.elapsed('hunt', 15_000)) return false;
    return this.browser.send({ t: 'hunt.select', slug: selected.slug });
  }

  async refill(player, needsCaptures) {
    const available = player.gold - this.config.goldReserve;
    if (!Number.isSafeInteger(available) || available <= 0) return false;
    const cheapest = (items, price) => items.filter((item) => positiveInteger(item.id) && positiveInteger(item[price]))
      .sort((first, second) => first[price] - second[price])[0];
    const ball = needsCaptures ? cheapest(this.state.balls.filter((item) => item.compravel), 'priceGold') : null;
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

  async askHistory(tab, filters, page = 0) {
    const seq = ++this.seq;
    const browser = this.browser;
    return browser.response((message) => marketReply(tab)(message) && message.seq === seq,
      () => Boolean(this.active()) && browser.send({ t: `market.${tab}`, pagina: page, seq, ...filters }));
  }

  async readMarket(tab, filters) {
    const browser = this.browser;
    const account = this.account;
    if (!this.active() || this.status === 'blocked' || this.status === 'setup') return null;
    const key = JSON.stringify([tab, filters]);
    if (this.marketCache?.key === key && Date.now() - this.marketCache.at < 10_000) return this.marketCache;
    if (this.marketRequest?.key === key) return this.marketRequest.promise;
    if (this.marketRequest || !this.elapsed(`marketView:${tab}`, 750)) {
      throw Object.assign(new Error('Aguarde um instante e consulte o mercado novamente.'), { status: 429 });
    }

    const seq = ++this.seq;
    const reply = { listar: 'vitrine', itens: 'itens', item: 'item' }[tab];
    const promise = browser.response((message) => marketReply(reply)(message)
      && (message.seq == null || message.seq === seq)
      && (tab !== 'listar' || Number(message.pagina ?? 0) === filters.pagina)
      && (tab !== 'item' || Number(message.itemId) === filters.itemId && message.moeda === filters.moeda),
    () => this.active() ? browser.send({ t: `market.${tab}`, ...filters, seq }) : false, 5000).then((data) => {
      if (!data || !this.active() || this.browser !== browser || this.account !== account) return null;
      this.marketCache = { key, at: Date.now(), data };
      return this.marketCache;
    }).finally(() => {
      this.marketRequest = null;
    });
    this.marketRequest = { key, promise };
    return promise;
  }

  async refreshSales() {
    const account = this.account;
    const oldest = this.ledger.openListings(account)[0]?.time;
    for (let page = 0; ; page++) {
      const result = await this.askHistory('historico', { moeda: 'orb' }, page);
      if (!Array.isArray(result?.linhas) || !this.active() || account !== this.account) return false;
      const catalog = [...this.state.items, ...(this.state.market?.catalogo ?? [])];
      for (const row of result.linhas) this.ledger.addSale(account, identifyItemSale(row, catalog));
      if (!oldest || !result.linhas.length
        || Number(result.linhas.at(-1).em) < oldest
        || !positiveInteger(result.porPagina) || !positiveInteger(result.total)
        || (page + 1) * result.porPagina >= result.total) break;
    }
    this.publish();
    return true;
  }

  async market() {
    if (!this.active()) return;
    const account = this.account;
    const browser = this.browser;
    const result = await browser.response(marketReply('meus'), () => browser.send({ t: 'market.meus' }));
    if (!Array.isArray(result?.linhas) || !this.active() || account !== this.account) return;
    const listings = result.linhas.filter((row) => row.tipo === 'pokemon');
    const listedIds = new Set(listings.map(listedPokemonId));
    const now = Date.now();
    for (const { key, time, kind, gems, listingId } of this.ledger.openListings(account)) {
      if (kind !== 'listing') continue;
      const offer = listings.find((row) => listedPokemonId(row) === key && (row.moeda == null || row.moeda === 'orb')
        && (row.preco == null || Number(row.preco) === gems) && (listingId == null || String(row.id) === String(listingId)));
      if (offer) {
        const details = offer.id != null && offer.moeda === 'orb' && Number(offer.preco) === gems
          ? { listingId: offer.id } : {};
        this.ledger.finish(account, 'listing', key, 'confirmed', details);
        if (listingId == null && details.listingId != null) this.ledger.updateListing(account, kind, key, details);
      }
      else if (listedIds.has(key)) continue;
      // A fresh market list plus the Pokémon back in inventory confirms release from escrow.
      else if (now - time >= 90_000 && this.state.pokemon.has(Number(key))) this.ledger.returnListing(account, key);
    }
    await this.reconcileItems(account, result.linhas, now);
    if (!this.active() || this.account !== account || this.browser !== browser) return;
    if (this.config.marketEnabled === false) return;
    if (await this.reviewListings(result.linhas, now)) return;
    if (this.phase() === 'outland') return this.listOutlandItem(account, result.linhas);
    if (this.phase() !== 'shiny') return;
    const marketLimit = this.state.market?.maxAnunciosPokemon;
    if (this.ledger.pending(account, 'listing')) return this.marketUpdate('pending', 'Aguardando confirmação de um anúncio.');
    if (positiveInteger(marketLimit) && listings.length >= marketLimit) {
      return this.marketUpdate('limit', 'Limite de anúncios atingido. Aguardando uma vaga.');
    }
    const player = this.state.player;
    const locked = new Set(player.automation?.pokemonTravado?.map(Number));
    const trained = this.ledger.trainingPokemon(account);
    let current;
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = this.ledger.nextCandidate(account, now - 30 * 60_000, true);
      if (!candidate) return;
      const owned = this.state.pokemon.get(candidate.id);
      if (owned?.shiny && owned.slot == null && !owned.starter && candidate.id !== player.activeId && candidate.id !== trained
        && !locked.has(candidate.id) && !listedIds.has(String(candidate.id))) current = pokemonFrom(owned);
      if (current) break;
      this.ledger.saveQuote(account, candidate.id, null);
    }
    if (!current) return;
    const valuation = await this.pokemonValuation(current);
    if (valuation === undefined || !this.active() || this.account !== account || this.phase() !== 'shiny') return;
    this.ledger.saveQuote(account, current.id, valuation);
    const decision = listingDecision(valuation, this.listingMinimum('shiny'));
    this.marketUpdate(decision.code, decision.text, current.name);
    if (decision.code !== 'ready') return;
    const days = this.state.market?.diasMin;
    const { fee } = valuation;
    if (!positiveInteger(days) || !positiveInteger(fee)
      || fee > this.config.maxListingFee || player.gold - fee < this.config.goldReserve) {
      return this.marketUpdate('fee', 'A estadia excede o limite ou a reserva de ouro.', current.name);
    }

    try {
      if (!await prepareListing(browser.page, current, valuation.gems, days) || !this.active() || this.account !== account) {
        return this.marketUpdate('ineligible', 'O jogo não disponibilizou o anúncio.', current.name);
      }
      const quotedFee = await browser.page.locator('#confirmar:visible .dlg-custo-num').textContent({ timeout: 1000 });
      if (this.phase() !== 'shiny' || Number(quotedFee.replace(/[^0-9]/g, '')) !== fee
        || this.state.player.gold - fee < this.config.goldReserve) return;
      const confirmed = await this.confirmOperation(account, 'listing', String(current.id), { ...valuation, pokemon: current },
        marketReply('criado'), 'shiny');
      this.marketUpdate(confirmed ? 'listed' : 'pending',
        confirmed ? 'Anúncio publicado.' : 'Aguardando confirmação de um anúncio.', current.name);
    } finally {
      await browser.dismiss().catch(() => {});
    }
  }

  async pokemonValuation(current) {
    const filters = {
      tipo: 'pokemon', moeda: 'orb', busca: current.name,
      ...(current.shiny ? { soShiny: 1 } : {}), ...(current.power === 5 ? { soP5: 1 } : {}),
    };
    const accounts = this.ledger.accounts();
    const sales = [];
    let valuationQuote;
    for (let page = 0; page < 3; page++) {
      const records = await this.askHistory('historicoGlobal', filters, page);
      if (!Array.isArray(records?.linhas) || !this.active()) return undefined;
      sales.push(...records.linhas);
      valuationQuote = quote(current, sales, accounts);
      if (valuationQuote || !records.temMais) break;
    }
    const { diasMin, taxaDiaria } = this.state.market ?? {};
    return valuationQuote ? { ...valuationQuote, net: netGems(valuationQuote.gems), fee: diasMin * taxaDiaria, tracked: true } : null;
  }

  listingMinimum(phase) {
    return Math.max(phase === 'outland' ? 2 : 1, this.state.market?.precoMinOrb ?? 1, this.config.minListingGems ?? 1);
  }

  marketUpdate(code, text, name) {
    this.marketStatus = { code, text, name, at: Date.now() };
    this.publish();
  }

  async itemValuation(itemId, now = Date.now()) {
    const records = await this.askHistory('historicoGlobal', { tipo: 'item', itemId, moeda: 'orb' });
    if (!Array.isArray(records?.linhas)) return undefined;
    const recent = records.linhas.filter(({ em }) => !Number.isFinite(Number(em)) || Number(em) >= now - 7 * 86_400_000);
    const valuation = quoteItem(itemId, recent.map((row) => ({ ...row, itemId: row.itemId ?? itemId })), this.ledger.accounts());
    return valuation && { ...valuation, net: valuation.gems - Math.ceil(valuation.gems * 0.15) };
  }

  async reviewListings(rows, now) {
    const hours = this.config.repriceAfterHours;
    if (!hours || !this.active()) return false;
    const account = this.account;
    const browser = this.browser;
    const phase = this.phase();
    const kind = phase === 'outland' ? 'item-listing' : phase === 'shiny' ? 'listing' : null;
    const op = this.ledger.openListings(account).find((entry) => entry.kind === kind
      && entry.state === 'confirmed' && entry.listingId != null
      && now - entry.time >= hours * 3_600_000 && now - (entry.reviewedAt ?? 0) >= 6 * 3_600_000
      && rows.some((row) => String(row.id) === String(entry.listingId) && row.moeda === 'orb'
        && Number(row.preco) === entry.gems && (kind === 'item-listing'
          ? row.tipo === 'item' && Number(row.itemId) === entry.itemId && Number(row.qtd) === entry.quantity
          : row.tipo === 'pokemon' && listedPokemonId(row) === entry.key)));
    if (!op) return false;
    const row = rows.find(({ id }) => String(id) === String(op.listingId));
    const pokemon = op.pokemon ?? pokemonFrom(row.ficha);
    this.ledger.updateListing(account, op.kind, op.key, { reviewedAt: now });
    const valuation = kind === 'item-listing' ? await this.itemValuation(op.itemId, now)
      : pokemon ? await this.pokemonValuation(pokemon) : undefined;
    if (!this.active() || this.account !== account || this.browser !== browser || this.phase() !== phase) return false;
    const name = op.name ?? pokemon?.name ?? this.itemName(op.itemId);
    const decision = listingDecision(valuation, this.listingMinimum(phase));
    if (decision.code !== 'ready') {
      this.marketUpdate(decision.code, decision.text, name);
      return false;
    }
    if (valuation.gems > Math.floor(op.gems * 0.9) || valuation.gems >= op.gems) return false;
    if (kind === 'listing' && (!positiveInteger(valuation.fee) || valuation.fee > this.config.maxListingFee
      || this.state.player.gold - valuation.fee < this.config.goldReserve)) return false;
    if (!this.ledger.openListings(account).some(({ kind, key, state }) =>
      kind === op.kind && key === op.key && state === 'confirmed')) return false;
    if (!await browser.send({ t: 'market.cancelar', id: row.id })) return false;
    this.marketUpdate('repricing', 'Solicitada a retirada do anúncio. Aguardando o jogo devolver o item ou Pokémon.', name);
    return true;
  }

  async reconcileItems(account, rows, now) {
    const missing = [];
    for (const op of this.ledger.openListings(account)) {
      if (op.kind !== 'item-listing') continue;
      const match = rows.find((row) => row.tipo === 'item' && row.moeda === 'orb'
        && Number(row.itemId) === op.itemId
        && (op.listingId == null ? Number(row.preco) === op.gems && Number(row.qtd) === op.quantity
          : String(row.id) === String(op.listingId)));
      if (match) {
        this.ledger.finish(account, op.kind, op.key, 'confirmed', { listingId: match.id });
        if (op.listingId == null && match.id != null) this.ledger.updateListing(account, op.kind, op.key, { listingId: match.id });
      } else if (now - op.time >= 150_000) missing.push(op.key);
    }
    if (!missing.length || !await this.refreshSales()) return;
    for (const op of this.ledger.openListings(account)) {
      if (op.kind === 'item-listing' && missing.includes(op.key)
        && (op.listingId != null || (this.state.player.items?.[op.itemId] ?? 0) >= op.stockBefore)) {
        this.ledger.returnListing(account, op.key, op.kind);
      }
    }
  }

  async listOutlandItem(account, rows) {
    const { market, player } = this.state;
    const browser = this.browser;
    const limit = market?.maxAnunciosItens ?? market?.maxAnunciosPokemon ?? 20;
    if (this.ledger.pending(account, 'item-listing')) return this.marketUpdate('pending', 'Aguardando confirmação de um anúncio.');
    if (rows.filter(({ tipo }) => tipo === 'item').length >= limit) {
      return this.marketUpdate('limit', 'Limite de anúncios de itens atingido. Aguardando uma vaga.');
    }
    const listedItems = new Set(rows.filter((row) => row.tipo === 'item' && row.moeda === 'orb')
      .map(({ itemId }) => Number(itemId)));
    const trackedItems = new Set(this.ledger.openListings(account)
      .filter(({ kind }) => kind === 'item-listing').map(({ itemId }) => itemId));
    const itemId = this.state.outlandItems.find((id) => positiveInteger(player.items?.[id])
      && !listedItems.has(id) && !trackedItems.has(id) && this.elapsed(`itemQuote:${id}`, 300_000));
    if (!itemId) return;
    const valuation = await this.itemValuation(itemId);
    if (valuation === undefined || !this.active() || this.account !== account || this.browser !== browser) return;
    const name = this.itemName(itemId);
    const decision = listingDecision(valuation, this.listingMinimum('outland'));
    this.ledger.saveItemQuote(account, itemId, { valuation, decision });
    this.marketUpdate(decision.code, decision.text, name);
    const stockBefore = this.state.player.items?.[itemId];
    if (decision.code !== 'ready' || !positiveInteger(stockBefore) || this.phase() !== 'outland') return;

    const key = randomUUID();
    const { gems } = valuation;
    const kind = 'item-listing';
    if (!this.ledger.begin(account, kind, key, { ...valuation, itemId, quantity: 1, stockBefore,
      name })) return;
    let reply;
    try {
      reply = await browser.response(marketReply('criado'), () => this.active()
        && browser.send({ t: 'market.criar', tipo: 'item', itemId, qtd: 1, preco: gems, moeda: 'orb', dias: null }));
    } finally {
      const listingId = reply?.anuncio?.id ?? reply?.id;
      this.ledger.finish(account, kind, key, reply ? 'confirmed' : 'uncertain',
        { acknowledged: Boolean(reply), ...(listingId == null ? {} : { listingId }) });
      this.marketUpdate(reply ? 'listed' : 'pending',
        reply ? 'Anúncio publicado.' : 'Aguardando confirmação de um anúncio.', name);
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

  async confirmOperation(account, kind, key, details, matches, phase) {
    if (!this.active() || account !== this.account || !this.ledger.begin(account, kind, key, details)) return;
    const browser = this.browser;
    let confirmed;
    try {
      confirmed = await browser.response(matches, () => this.active() && (!phase || phase === this.phase()) && browser.confirm());
    } finally {
      const listingId = kind === 'listing' ? confirmed?.anuncio?.id ?? confirmed?.id : null;
      this.ledger.finish(account, kind, key, confirmed ? 'confirmed' : 'uncertain', listingId == null ? {} : { listingId });
      this.publish();
    }
  }

  itemName(id) {
    return [...this.state.items, ...(this.state.market?.catalogo ?? [])]
      .find((item) => Number(item.id ?? item.itemId) === id)?.name ?? (id == null ? undefined : `Item #${id}`);
  }

  itemStock(player, now = Date.now()) {
    const quotes = this.ledger.itemQuotes(this.account);
    const items = this.state.outlandItems.filter((id) => positiveInteger(player.items?.[id])).map((id) => {
      const quote = quotes.get(id);
      const recent = quote && now - quote.checkedAt < 24 * 3_600_000;
      return { id, name: this.itemName(id), quantity: player.items[id],
        price: recent ? quote.valuation?.gems ?? null : null,
        note: recent ? quote.decision?.text : 'Aguardando cotação recente.' };
    });
    return { items, gems: items.reduce((sum, item) => sum + item.quantity * (item.price ?? 0), 0),
      unpriced: items.reduce((sum, item) => sum + (item.price == null ? item.quantity : 0), 0) };
  }

  snapshot() {
    const account = this.account;
    const player = this.online ? this.state.player : null;
    const panel = this.online ? this.state.panel : null;
    const current = player && this.state.pokemon.get(player.activeId);
    const attention = ({
      login: { kind: 'action', text: 'Entre novamente na conta pelo painel do PC.' },
      'native-login': { kind: 'action', text: 'Entre no jogo e devolva o controle ao robô.' },
      blocked: { kind: 'action', text: 'Abra o jogo e verifique a confirmação ou restrição da conta.' },
      setup: { kind: 'action', text: 'Conclua a configuração inicial no jogo.' },
      reconnecting: { kind: 'recovering', text: 'Aguardando a conexão com o jogo.' },
      recovering: { kind: 'recovering', text: this.note },
      warning: { kind: 'recovering', text: 'Uma ação falhou. O robô continua verificando a sessão.' },
    })[this.status] ?? null;
    return {
      id: this.config.id, status: this.status, note: this.note, account,
      active: this.desired, paused: this.paused, preview: this.preview ? this.previewAt : null,
      hunt: player?.huntSlug ?? this.config.hunt, level: player?.level ?? null,
      gold: player?.gold ?? null, gems: panel?.saldo ?? player?.orbs ?? null,
      balls: player ? Object.values(player.balls ?? {}).reduce((a, b) => a + b, 0) : null,
      mode: this.mode, phase: player ? this.phase() : null,
      pokemon: current ? { name: current.nome, speciesId: current.speciesId, level: current.level,
        shiny: Boolean(current.shiny) } : null,
      lastProgressAt: this.state.lastProgressAt, lastFrameAt: this.state.lastFrameAt,
      stalledSince: this.status === 'recovering' ? this.recovery?.since ?? null : null,
      attention, marketStatus: this.marketStatus,
      itemStock: player && account ? this.itemStock(player) : null,
      periods: account ? this.ledger.farmPeriods(account) : null,
      huntOptimizer: this.optimizer.snapshot(),
      openListings: account ? this.ledger.openListings(account).length : 0,
      metrics: account ? this.ledger.metrics(account) : {},
      captures: account ? this.ledger.captures(account, 30) : [],
      sales: account ? this.ledger.sales(account) : [],
      listings: account ? [...this.ledger.operations(account, 'listing', 30),
        ...this.ledger.operations(account, 'item-listing', 30)] : [],
      withdrawals: account ? this.ledger.operations(account, 'withdrawal', 20) : [],
      paid: panel?.saques?.filter((entry) => entry.status === 'confirmado').map(({ orbs, usdt }) => ({ orbs, usdt })) ?? [],
    };
  }
}
