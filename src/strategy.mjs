import { randomUUID } from 'node:crypto';
import { strategicReserves, strategyHorizon, strategyOpportunities } from './strategy-policy.mjs';
import { gameCoverage } from './game-knowledge.mjs';

const WAIT_MS = 120_000;
const RETRY_MS = 15 * 60_000;
const outside = (p) => p?.boss?.arena || p?.mistico || p?.safari?.dentro || p?.casa?.dentro;
const actionKey = (row) => JSON.stringify([row.command, row.expected]);

export class AccountStrategy {
  rules = null;
  rulesKey = null;
  rulesAt = 0;
  retryAt = 0;
  opportunities = [];
  rewards = [];

  constructor(planner) { this.planner = planner; this.session = planner.session; }
  reset() { this.rules = null; this.rulesKey = null; this.rulesAt = 0; this.retryAt = 0; this.opportunities = []; this.rewards = []; }
  get runtime() { return this.planner.runtime.strategy ??= { cooldowns: {}, history: [], lastTeamChangeAt: 0 }; }
  pending() { return this.session.ledger.operations(this.session.account, 'strategy').find((op) => ['pending', 'uncertain'].includes(op.state)); }

  fingerprint() {
    const { state } = this.session;
    return JSON.stringify([state.generation, state.player?.level, state.player?.passe, state.player?.chocadeira, Math.floor(state.serverNow() / 60_000),
      [...state.pokemon.values()].map((pk) => [pk.id, pk.speciesId, pk.level, pk.ivs, pk.quality, pk.potencia, pk.refino, pk.starter])]);
  }

  canAct() {
    const { session } = this;
    return Boolean(session.active() && !['blocked', 'setup'].includes(session.status) && !outside(session.state.player)
      && !this.planner.activities.current && !this.planner.pending());
  }

  refresh(now = Date.now()) {
    const { session, planner } = this;
    const runtime = this.runtime;
    for (const [key, until] of Object.entries(runtime.cooldowns)) if (until <= now) delete runtime.cooldowns[key];
    const rules = this.rulesKey === this.fingerprint() && now - this.rulesAt < WAIT_MS ? this.rules : null;
    this.opportunities = strategyOpportunities({ state: session.state, settings: planner.settings, rules,
      primary: planner.primary(), species: planner.species, mode: session.mode, now: session.state.serverNow(now),
      lastTeamChangeAt: runtime.lastTeamChangeAt ? runtime.lastTeamChangeAt + session.state.serverOffset : 0 });
    for (const row of this.opportunities) {
      const evolution = planner.runtime.evolution;
      if ((row.command?.t.startsWith('team.') || ['house-xp', 'held-xp'].includes(row.id))
        && row.command && evolution && now - evolution.at < WAIT_MS) {
        row.status = 'waiting'; row.reason = 'Aguardando o resultado da evolução antes de reorganizar a equipe e o XP Share.';
        delete row.command;
      }
      const until = row.command && Math.max(runtime.cooldowns[actionKey(row)] ?? 0, runtime.cooldowns[`domain:${row.id}`] ?? 0);
      if (until > now) {
        row.status = 'waiting'; row.until = until + session.state.serverOffset;
        row.reason = 'Aguardando nova avaliação após a última tentativa.';
        delete row.command;
      }
    }
    return this.opportunities;
  }

  next() {
    if (this.pending()) return null;
    return this.opportunities.filter((row) => row.status === 'ready' && row.command)
      .sort((a, b) => b.priority - a.priority)[0] ?? null;
  }

  async prepare() {
    const { session } = this;
    if (!this.canAct() || typeof session.browser?.strategyData !== 'function') return false;
    const now = Date.now();
    const key = this.fingerprint();
    if (key === this.rulesKey && now - this.rulesAt < WAIT_MS) return true;
    if (now < this.retryAt) return false;
    this.retryAt = now + 15_000;
    const { browser, account } = session;
    const generation = session.state.generation;
    const rules = await browser.strategyData(session.state.player, [...session.state.pokemon.values()],
      this.planner.species, session.state.serverNow(now)).catch(() => null);
    if (!this.canAct() || session.browser !== browser || session.account !== account
      || generation !== session.state.generation || key !== this.fingerprint()) return false;
    this.rules = rules; this.rulesKey = rules ? key : null; this.rulesAt = now;
    return Boolean(rules);
  }

  finish(operation, status, note, now = Date.now()) {
    const { session, planner } = this;
    session.ledger.finish(session.account, 'strategy', operation.key, status);
    const runtime = this.runtime;
    runtime.cooldowns[actionKey(operation)] = now + (status === 'confirmed' ? 30_000 : RETRY_MS);
    if (status === 'unverified' && operation.expected.consumes) runtime.cooldowns[`domain:${operation.id}`] = now + 86_400_000;
    runtime.history = [{ title: operation.title, kind: operation.id, status, note, at: now }, ...runtime.history].slice(0, 30);
    if (status === 'confirmed' && operation.expected.kind === 'team') {
      session.ledger.setTrainingPokemon(session.account, operation.expected.pokemonId);
      runtime.lastTeamChangeAt = now;
      session.optimizer.suspend(); session.due.hunt = 0;
    }
    if (status === 'confirmed' && operation.expected.kind === 'bike') session.optimizer.suspend();
    planner.action(`strategy:${operation.id}`, note, status, now);
    this.rulesKey = null;
  }

  record(message, now = Date.now()) {
    if (message.t === 'welcome') this.reset();
    if (this.session.account && this.session.desired) {
      if (message.t === 'passe' && Number.isInteger(message.resgate?.degrau) && Array.isArray(message.resgate.premios)) {
        this.rewards.push({ kind: 'pass', at: now });
      }
      for (const event of message.t === 'batalha' && Array.isArray(message.ev) ? message.ev : []) {
        if (event.k === 'casaFabricada') this.rewards.push({ kind: 'house', at: now });
        if (event.k === 'bicicletaFabricada') this.rewards.push({ kind: 'bike', at: now });
        const name = event.pokemon?.apelido || event.pokemon?.nome;
        if (event.k === 'ovoChocou' && typeof name === 'string' && name.length) this.rewards.push({ kind: 'egg', name, at: now });
      }
      // The client may keep a reward open across a long pause; welcome/reset clears the page generation.
      this.rewards = this.rewards.slice(-32);
    }
    const operation = this.pending();
    if (!operation) return;
    const namespace = operation.command.t.split('.')[0];
    if (message.t === 'erro' && typeof message.chave === 'string' && message.chave.startsWith(`${namespace}.`)) {
      this.finish(operation, 'rejected', `${operation.title}: pedido recusado pelo jogo (${message.chave}). Nova avaliação em 15 min.`, now);
      return;
    }
    const { state } = this.session;
    const expected = operation.expected;
    const delta = ['estado', 'welcome'].includes(message.t) ? message.estado : null;
    let fresh = false; let confirmed = false;
    if (expected.kind === 'incubate') {
      fresh = Boolean(delta && Object.hasOwn(delta, 'chocadeira'));
      confirmed = fresh && state.player?.chocadeira?.ovos?.some((egg) => egg.slot === expected.slot && egg.ovo === expected.egg);
      if (message.t === 'batalha' && message.ev?.some((event) => event.k === 'ovoColocado'
        && event.slot === expected.slot && event.ovo === expected.egg && Number.isFinite(event.fim))) confirmed = true;
    } else if (['build-house', 'build-bike'].includes(expected.kind)) {
      const field = expected.kind === 'build-house' ? 'casa' : 'bicicleta';
      fresh = Boolean(delta && Object.hasOwn(delta, field));
      confirmed = fresh && state.player?.[field]?.lista?.some((item) => Number.isSafeInteger(item.id) && item.id > 0 && !expected.ids.includes(item.id));
    } else if (expected.kind === 'pass') {
      fresh = Boolean(delta && Object.hasOwn(delta, 'passe'));
      confirmed = fresh && state.player?.passe?.[expected.vip ? 'ultimoVip' : 'ultimo'] === expected.day;
      if (message.t === 'passe' && message.resgate?.degrau === expected.step && Array.isArray(message.resgate.premios)) confirmed = true;
    } else if (expected.kind === 'bike') {
      fresh = Boolean(delta && Object.hasOwn(delta, 'bicicleta'));
      confirmed = fresh && state.player?.bicicleta?.equipada === expected.id;
    } else if (['house', 'house-xp'].includes(expected.kind)) {
      fresh = Boolean(delta && Object.hasOwn(delta, 'casa'));
      const house = state.player?.casa?.lista?.find((row) => row.id === expected.id);
      confirmed = fresh && house && !house.anunciada && (expected.kind === 'house'
        ? house.emUso !== false : house.postos?.[expected.slot] === expected.pokemonId);
    } else if (expected.kind === 'team') {
      fresh = Boolean(delta && Object.hasOwn(delta, 'activeId'));
      confirmed = fresh && state.player?.activeId === expected.pokemonId;
    } else if (['team-fill', 'held-xp'].includes(expected.kind)) {
      fresh = Boolean(delta && (Array.isArray(delta.pokemons) || delta.pkMud?.some((pk) => pk.id === expected.pokemonId)));
      const pk = state.pokemon.get(expected.pokemonId);
      confirmed = fresh && pk && (expected.kind === 'team-fill' ? pk.slot === expected.slot : pk.heldItemId === expected.itemId);
    }
    if (confirmed) this.finish(operation, 'confirmed', `${operation.title}: efeito confirmado pelo jogo.`, now);
    else if (now - operation.time >= WAIT_MS && fresh && (!expected.consumes
      || delta?.items && ((delta.items[expected.itemId] ?? 0) >= expected.before || message.t === 'welcome' || delta.cheio === true))) {
      this.finish(operation, 'unverified', `${operation.title}: estado atualizado sem o efeito esperado. Nova avaliação em ${expected.consumes ? '24 h' : '15 min'}.`, now);
    } else if (now - operation.time >= WAIT_MS && operation.state !== 'uncertain') {
      this.session.ledger.finish(this.session.account, 'strategy', operation.key, 'uncertain');
      this.planner.action(`strategy:${operation.id}`, `${operation.title}: aguardando dados do jogo para confirmar. A caça continua.`, 'uncertain', now);
    }
  }

  async dismissRewards() {
    const { session } = this;
    const { browser, account } = session;
    const generation = session.state.generation;
    const canAct = () => session.active() && session.status !== 'blocked' && session.browser === browser
      && session.account === account && session.state.generation === generation;
    if (!canAct() || typeof browser?.dismissStrategyReward !== 'function') return false;
    for (const reward of this.rewards) {
      if (!canAct()) return false;
      if (await browser.dismissStrategyReward(reward, canAct).catch(() => false)) {
        this.rewards = this.rewards.filter((entry) => entry !== reward);
        return true;
      }
    }
    return false;
  }

  async run() {
    this.planner.connect();
    if (!this.canAct()) return false;
    const pending = this.pending();
    if (pending) {
      const now = Date.now();
      this.record({ t: 'strategy.wait' }, now);
      if (now - pending.time >= WAIT_MS && now - (this.runtime.lastResyncAt ?? 0) >= 300_000
        && typeof this.session.browser?.page?.reload === 'function') {
        this.runtime.lastResyncAt = now;
        this.planner.persist();
        await this.session.reloadGame();
        return true;
      }
      return false;
    }
    if (!await this.prepare()) return false;
    this.refresh();
    const selected = this.next();
    if (!selected || !this.canAct()) return false;
    if (selected.id.startsWith('team') && !this.session.state.canSwitchHunt(Date.now())) return false;
    const { session } = this;
    const { browser, account } = session;
    const key = randomUUID();
    if (!session.ledger.begin(account, 'strategy', key, selected)) return false;
    this.planner.action(`strategy:${selected.id}`, selected.reason, 'pending');
    try {
      if (!this.canAct() || session.browser !== browser || session.account !== account || !await browser.send(selected.command)) {
        if (this.pending()?.key === key) this.finish({ ...selected, key }, 'failed', `${selected.title}: comando não enviado.`);
        return false;
      }
    } catch {
      if (this.pending()?.key === key) {
        session.ledger.finish(account, 'strategy', key, 'uncertain');
        this.planner.action(`strategy:${selected.id}`, `${selected.title}: envio sem confirmação; aguardando o estado do jogo.`, 'uncertain');
      }
    }
    this.planner.refresh();
    return true;
  }

  snapshot() {
    const pending = this.pending();
    const knowledge = gameCoverage(this.session.state);
    return { objective: 'Equilibrar progressão, equipe e rendimento',
      opportunities: this.opportunities.map(({ command, expected, ...row }) => ({ ...row,
        ...(row.until ? { until: row.until - this.session.state.serverOffset } : {}) })),
      horizon: strategyHorizon(this.session.state), reserves: strategicReserves(this.session.state, this.planner.settings, this.planner.activities.advanced.rules?.raid),
      pending: pending && { title: pending.title, status: pending.state, at: pending.time },
      history: this.runtime.history.slice(0, 10), coverage: knowledge.systems,
      knowledge: { version: knowledge.version, reviewedAt: knowledge.reviewedAt, hunts: knowledge.hunts } };
  }
}
