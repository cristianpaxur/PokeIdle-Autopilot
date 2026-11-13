import { randomUUID } from 'node:crypto';
import { evolutionGoal, gameBonuses, plannerSettings, stoneRoute, supplyPlan } from './planning.mjs';
import { ActivityPlanner } from './activities.mjs';
import { AccountStrategy } from './strategy.mjs';
import { CapturePlanner } from './capture-planner.mjs';

const outside = (p) => p?.boss?.arena || p?.mistico || p?.safari?.dentro || p?.casa?.dentro;
const number = (n) => Math.round(n).toLocaleString('pt-BR');

export class AccountPlanner {
  species = {};
  route = null;
  goal = null;
  supply = null;
  decision = null;
  runtime = {};
  consumption = [];
  trackingSince = Date.now();
  stoneLastAt = null;
  account = null;
  bonuses = null;

  constructor(session) {
    this.session = session;
    this.settings = plannerSettings(session.ledger.plannerPreferences(session.config.id), {
      goldReserve: session.config.goldReserve ?? 10000,
    });
    this.activities = new ActivityPlanner(this);
    this.strategy = new AccountStrategy(this);
    this.capture = new CapturePlanner(this);
  }

  configure(value) {
    const settings = plannerSettings(value, this.settings);
    this.session.ledger.setPlannerPreferences(this.session.config.id, settings);
    this.settings = settings;
    this.refresh();
    return settings;
  }

  connect() {
    if (this.account === this.session.account) return;
    this.account = this.session.account;
    this.runtime = this.session.ledger.plannerState(this.account);
    this.activities.reset();
    this.strategy.reset();
    this.capture.reset();
    this.suspend();
  }

  persist() {
    this.session.ledger.setPlannerState(this.account, this.runtime);
  }

  suspend() {
    this.stoneLastAt = null;
    this.consumption = [];
    this.trackingSince = Date.now();
  }

  primary() {
    const { state, ledger, account } = this.session;
    const saved = state.pokemon.get(ledger.trainingPokemon(account));
    return saved?.slot != null ? saved : state.pokemon.get(state.player?.activeId);
  }

  spent(now = Date.now()) {
    return this.session.ledger.supplySpent(this.session.account, now);
  }

  pending() {
    return this.session.ledger.operations(this.session.account, 'supply')
      .find((row) => ['pending', 'uncertain'].includes(row.state));
  }

  setDecision(code, title, reason, until) {
    const since = this.decision?.code === code && this.decision?.reason === reason
      ? this.decision.since : Date.now();
    this.decision = { code, title, reason, since, ...(until ? { until } : {}) };
  }

  action(kind, note, status, at = Date.now()) {
    this.runtime.lastAction = { kind, note, status, at };
    this.persist();
  }

  record(message, now = Date.now()) {
    this.connect();
    this.activities.record(message, now);
    this.strategy.record(message, now);
    this.capture.record(message, now);
    const { session } = this;
    const pending = this.pending();
    if (pending) {
      const receipt = message.t === 'batalha' && message.ev?.find((event) => event.k === 'compra'
        && Number(event.qtd) === pending.quantity && Number(event.gasto) === pending.cost
        && (event.itemId != null ? Number(event.itemId) === pending.itemId : event.nome === pending.name));
      const count = pending.kindOfItem === 'ball'
        ? session.state.player?.balls?.[pending.itemId] : session.state.player?.items?.[pending.itemId];
      const inventoryConfirmed = ['estado', 'welcome'].includes(message.t)
        && Number.isFinite(count) && count >= pending.before + pending.quantity;
      if (receipt || inventoryConfirmed) {
        session.ledger.finish(this.account, 'supply', pending.key, 'confirmed');
        this.action('supply', `${pending.quantity} × ${pending.name} comprados por ${number(pending.cost)} ouro.`, 'confirmed', now);
      } else if (now - pending.time > 120_000 && ['estado', 'welcome'].includes(message.t)) {
        // Keep the reserved cost, but allow a new replenishment from a fresh inventory.
        session.ledger.finish(this.account, 'supply', pending.key, 'unverified');
        this.action('supply', 'Compra sem confirmação. O custo permanece reservado; a próxima reposição usa o estoque atual.', 'uncertain', now);
      }
    }
    const evolution = this.runtime.evolution;
    if (evolution && session.state.pokemon.get(evolution.pokemonId)?.speciesId === evolution.to) {
      this.action('evolution', `Evolução para ${evolution.targetName} confirmada pelo jogo.`, 'confirmed', now);
      delete this.runtime.evolution;
      delete this.runtime.stone;
      this.persist();
      session.due.hunt = 0;
    }
    if (session.active() && message.t === 'batalha') {
      for (const event of message.ev ?? []) {
        const category = { cura: 'heal', revive: 'revive', bola: 'ball' }[event.k];
        const consumed = category === 'ball'
          ? session.state.balls.some((ball) => ball.id === Number(event.ballId))
          : session.state.items.some((item) => item.id === Number(event.itemId) && item.category === category);
        if (category && consumed) this.consumption.push({ at: now, category });
        const search = this.runtime.stone;
        if (event.k === 'morte' && event.quem && event.quem !== 'selvagem'
          && search?.activeSlug && session.state.hunt?.slug === search.activeSlug) {
          search.faints = [...(search.faints ?? []).filter((at) => now - at < 90_000), now];
          if (search.faints.length >= 2) {
            this.runtime.stoneBlocks ??= {};
            this.runtime.stoneBlocks[search.activeSlug] = now + 600_000;
            session.state.huntLocks.set(search.activeSlug, now + 600_000);
          }
          this.persist();
        }
      }
    }
    this.consumption = this.consumption.filter((row) => now - row.at <= 300_000);
  }

  refresh(now = Date.now()) {
    this.connect();
    const { session, settings } = this;
    const { state } = session;
    const player = state.player;
    const pokemon = this.primary();
    this.route = null;
    for (const [slug, until] of Object.entries(this.runtime.stoneBlocks ?? {})) {
      if (until > now) state.huntLocks.set(slug, Math.max(until, state.huntLocks.get(slug) ?? 0));
      else delete this.runtime.stoneBlocks[slug];
    }
    this.bonuses = gameBonuses(player, state.serverNow(now));
    this.activities.refresh(now);
    this.strategy.refresh(now);
    const minutes = Math.max(1, Math.min(5, (now - this.trackingSince) / 60_000));
    const rates = {};
    for (const row of this.consumption) {
      if (now - row.at <= 300_000) rates[row.category] = (rates[row.category] ?? 0) + 1 / minutes;
    }
    this.supply = supplyPlan({ player: player ?? {}, pokemon, items: state.items, balls: state.balls,
      phase: session.phase(), settings, spentGold: this.spent(now), rates,
      capture: this.activities.advanced.preparationSupplies() ?? this.capture.refresh(rates.ball) });
    this.goal = session.mode === 'shiny' ? null : evolutionGoal({ pokemon, species: this.species,
      stones: state.evolutionStones, items: player?.items ?? {} });
    if (!session.active()) {
      this.stoneLastAt = null;
      this.setDecision(session.paused ? 'paused' : 'offline', session.paused ? 'Planejador pausado' : 'Aguardando conexão',
        session.paused ? 'As opções estão salvas. Retome o robô para executar o plano.' : 'O plano será calculado com os dados da conta conectada.');
      return;
    }
    const activity = this.activities.decision();
    if (activity) {
      this.stoneLastAt = null;
      this.setDecision(activity.code, activity.title, activity.reason);
      return;
    }
    if (outside(player)) {
      this.stoneLastAt = null;
      this.setDecision('activity', 'Outra atividade em andamento', 'Aguardando o retorno à caça para executar o plano.');
      return;
    }
    if (player.noCentro && [...state.pokemon.values()].some((pk) => pk.slot != null && pk.hp < pk.maxHp)) {
      this.stoneLastAt = null;
      this.setDecision('healing', 'Recuperando no Centro', 'Curando a equipe antes de retomar a hunt.');
      return;
    }
    const pending = this.pending();
    if (pending) {
      this.setDecision('supply-wait', 'Confirmando reposição', `Aguardando o jogo confirmar ${pending.quantity} × ${pending.name}. O orçamento já está reservado.`);
    } else if (this.supply.action) {
      this.setDecision('supply', 'Repondo suprimentos', this.supply.reason);
      this.stoneLastAt = null;
      return;
    }
    if (this.goal?.ready && settings.autoEvolve) {
      this.setDecision('evolve', `Evoluir para ${this.goal.targetName}`, `Nível e ${this.goal.stoneName} disponíveis. A evolução mantém o Pokémon principal.`);
      this.stoneLastAt = null;
      return;
    }
    const improvement = this.strategy.next();
    if (improvement && !pending) {
      this.stoneLastAt = null;
      this.setDecision(`strategy:${improvement.id}`, improvement.title, improvement.reason);
      return;
    }
    const upcoming = this.activities.next();
    if (upcoming && !pending) {
      this.stoneLastAt = null;
      this.setDecision('activity-ready', upcoming.title, upcoming.reason);
      return;
    }
    const event = this.bonuses.event;
    if (session.phase() === 'progression' && settings.prioritizeXpEvents && event?.trainerPercent > 0) {
      this.stoneLastAt = null;
      this.setDecision('event-xp', 'Aproveitando evento de XP',
        `Evento com +${number(event.trainerPercent)}% de XP do treinador. Priorizando a melhor hunt medida; a busca de pedra continua depois.`,
        event.until - state.serverOffset);
      return;
    }
    let detail = '';
    if (this.goal && settings.autoEvolve && settings.farmStones && this.goal.have < 1
      && pokemon.level >= this.goal.level) {
      const key = `${pokemon.id}:${this.goal.to}:${this.goal.stoneId}`;
      if (this.runtime.stone?.key !== key) {
        this.runtime.stone = { key, spentMs: 0, cooldownUntil: 0 };
        this.stoneLastAt = null;
        this.persist();
      }
      const search = this.runtime.stone;
      const blocked = new Set([...state.huntOptions(now).blocked, ...session.optimizer.blockedHunts(now)]);
      const route = stoneRoute({ hunts: state.hunts, player, pokemon, species: this.species,
        stones: state.evolutionStones, goal: this.goal, blocked });
      if (search.cooldownUntil && now >= search.cooldownUntil) {
        search.cooldownUntil = 0;
        search.spentMs = 0;
      }
      if (this.stoneLastAt != null && route?.slug === player.huntSlug && !player.noCentro) {
        search.spentMs += Math.min(30_000, Math.max(0, now - this.stoneLastAt));
      }
      if (!search.cooldownUntil && search.spentMs >= settings.stoneMinutes * 60_000) {
        search.cooldownUntil = now + 10 * 60_000;
        this.persist();
      }
      if (!search.cooldownUntil && route) {
        this.route = route;
        this.stoneLastAt = route.slug === player.huntSlug && !player.noCentro ? now : null;
        if (this.stoneLastAt != null && search.activeSlug !== route.slug) {
          search.activeSlug = route.slug;
          search.faints = [];
        }
        this.persist();
        this.setDecision('stone', `Buscando ${this.goal.stoneName}`,
          `${this.goal.targetName} já pode evoluir. Caçando em ${route.slug.replaceAll('-', ' ')} para obter 1 pedra; limite de ${settings.stoneMinutes} min por tentativa.`);
        return;
      }
      detail = search.cooldownUntil ? 'A tentativa de obter a pedra terminou; nova tentativa em até 10 min.'
        : 'A pedra ainda falta, mas nenhuma hunt de drop está liberada e segura agora.';
    }
    this.stoneLastAt = null;
    if (this.supply.blocked) detail = [detail, this.supply.reason].filter(Boolean).join(' ');
    else if (this.goal && !this.goal.ready && !detail) detail = this.goal.reason;
    else if (!this.goal && !detail && settings.autoEvolve && session.mode !== 'shiny'
      && this.species[pokemon?.speciesId]?.evolvesTo) {
      detail = 'A evolução desta espécie exige escolha ou regras ainda não automatizadas. Mantendo a progressão.';
    }
    if (pending) return;
    const phase = session.phase();
    this.setDecision(phase === 'progression' ? 'xp' : phase, phase === 'progression' ? 'Treinando o principal'
      : phase === 'outland' ? 'Farmando na Outland' : 'Procurando shiny', detail || (phase === 'progression'
      ? 'Suprimentos verificados. Comparando XP líquido por hora, incluindo desmaios.'
      : 'Suprimentos verificados. Mantendo a estratégia escolhida para esta conta.'));
  }

  async buySupplies() {
    const { session } = this;
    const { player } = session.state;
    const managedSafari = this.activities.current?.kind === 'safari' && player?.safari?.dentro;
    if (!session.active() || outside(player) && !managedSafari) return false;
    this.refresh();
    if (this.pending() || !this.supply.action) return false;
    if (!session.elapsed('supplies', 10_000)) return false;
    const account = session.account;
    const key = randomUUID();
    const { action, purchase } = this.supply;
    const data = { ...purchase, itemId: action.id, kindOfItem: action.kind, quantity: action.qty };
    if (!session.ledger.begin(account, 'supply', key, data)) return false;
    this.action('supply', `Solicitando ${action.qty} × ${purchase.name} por ${number(purchase.cost)} ouro.`, 'pending');
    try {
      if (!session.active() || session.account !== account || !await session.browser.send(action)) {
        session.ledger.finish(account, 'supply', key, 'failed');
        this.action('supply', 'Compra não enviada. A reposição será reavaliada.', 'failed');
        return false;
      }
    } catch {
      session.ledger.finish(account, 'supply', key, 'uncertain');
      this.action('supply', 'Resposta da compra indisponível. Aguardando o estoque antes de tentar novamente.', 'uncertain');
    }
    this.refresh();
    return true;
  }

  async evolve() {
    const { session, settings } = this;
    this.refresh();
    const goal = this.goal;
    if (!session.active() || outside(session.state.player) || !settings.autoEvolve || !goal?.ready) return false;
    if (this.runtime.evolution && Date.now() - this.runtime.evolution.at < 60_000) return false;
    if (!session.elapsed('evolve', 60_000)) return false;
    this.runtime.evolution = { pokemonId: goal.pokemonId, to: goal.to, targetName: goal.targetName, at: Date.now() };
    this.action('evolution', `Solicitando evolução para ${goal.targetName} com ${goal.stoneName}.`, 'pending');
    const sent = await session.browser.send({ t: 'pokemon.evoluir', pokemonId: goal.pokemonId, alvoId: goal.to });
    if (!sent) {
      delete this.runtime.evolution;
      this.action('evolution', 'Evolução não enviada. Aguardando a conexão.', 'failed');
    }
    return sent;
  }

  snapshot() {
    const { state } = this.session;
    const untilLocal = (value) => value ? value - state.serverOffset : null;
    const bonuses = this.bonuses ?? gameBonuses(state.player, state.serverNow());
    return { settings: this.settings, decision: this.decision,
      supplies: this.supply?.stocks ?? [], evolution: this.goal,
      bonuses: { ...bonuses, sources: bonuses.sources.map((source) => ({ ...source, until: untilLocal(source.until) })),
        event: bonuses.event && { ...bonuses.event, until: untilLocal(bonuses.event.until) },
        seasonal: bonuses.seasonal && { ...bonuses.seasonal, until: untilLocal(bonuses.seasonal.until) } },
      spending: { used: this.spent(), limit: this.settings.supplyGoldPerHour,
        available: Math.max(0, Math.min((state.player?.gold ?? 0) - this.settings.goldReserve,
          this.settings.supplyGoldPerHour - this.spent())) },
      lastAction: this.runtime.lastAction ?? null, activities: this.activities.snapshot(), capture: this.capture.snapshot(),
      strategy: this.strategy.snapshot() };
  }
}
