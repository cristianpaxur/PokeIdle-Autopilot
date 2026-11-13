import { randomUUID } from 'node:crypto';
import { gymPlan, bossPlan } from './activity-policy.mjs';
import { pokemonAtlas } from './catalog.mjs';
import { AdvancedActivities } from './advanced-activities.mjs';

const DAY = 86_400_000;
const FRESH = 300_000;
const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((id) => b.includes(id));
const elsewhere = (p) => p?.mistico || p?.safari?.dentro || p?.casa?.dentro;

export class ActivityPlanner {
  ratings = {};
  ratingsKey = null;
  ratingsAt = 0;
  stateAt = 0;
  evaluated = { gym: null, boss: null };

  constructor(planner) { this.planner = planner; this.session = planner.session; this.advanced = new AdvancedActivities(this); }
  get current() { return this.planner.runtime.activity ?? null; }
  get history() { return this.planner.runtime.activityHistory ?? []; }
  get interruptsHunt() { return ['boss', 'safari'].includes(this.current?.kind); }

  reset() { this.ratings = {}; this.ratingsKey = null; this.ratingsAt = 0; this.advanced.reset(); }
  persist() { this.planner.persist(); }

  fingerprint(pokemon = [...this.session.state.pokemon.values()]) {
    return JSON.stringify(pokemon.map((pk) => [pk.id, pk.speciesId, pk.level, pk.ivs, pk.potencia,
      pk.quality ?? pk.qualidade, pk.shiny, pk.refino, pk.tmElemental, pk.tmFisico]));
  }

  input(now = Date.now(), excludeActive = false) {
    const { state, mode } = this.session;
    // Policies use local time for history; convert the already server-validated event expiry.
    const bonuses = this.planner.bonuses && { ...this.planner.bonuses,
      event: this.planner.bonuses.event && { ...this.planner.bonuses.event,
        until: this.planner.bonuses.event.until - state.serverOffset } };
    const panel = state.gymPanel && now - state.gymPanelAt < FRESH ? {
      ...state.gymPanel, desafioCooldownMs: Math.max(0, state.gymPanel.desafioCooldownMs - (now - state.gymPanelAt)),
    } : null;
    return { player: state.player, pokemon: [...state.pokemon.values()], primary: this.planner.primary(),
      species: this.planner.species, settings: this.planner.settings, mode, now,
      bonuses, bosses: state.bosses ?? [], typeChart: state.typeChart,
      info: now - state.gymInfoAt < FRESH ? state.gymInfo : null, panel,
      ratings: now - this.ratingsAt < FRESH && (!this.ratingsKey || this.ratingsKey === this.fingerprint()) ? this.ratings : {},
      history: this.history.filter((row) => !excludeActive || row.id !== this.current?.id) };
  }

  refresh(now = Date.now()) {
    const input = this.input(now);
    this.evaluated = { gym: gymPlan(input), boss: bossPlan(input), ...this.advanced.refresh(now) };
    if (this.evaluated.boss.ready && input.player?.activeId !== input.primary?.id) {
      this.evaluated.boss = { ...this.evaluated.boss, ready: false, code: 'active',
        title: 'Aguardando Pokémon principal', reason: 'O jogo precisa confirmar o principal como ativo antes da entrada no boss.' };
    }
    return this.evaluated;
  }

  decision() {
    const a = this.current;
    if (!a) return null;
    const stages = { disarming: 'Desligando repetição do boss', entering: 'Confirmando entrada no boss',
      fighting: 'Enfrentando boss', returning: 'Retornando à hunt', saving: 'Registrando equipe de ginásio',
      registered: 'Conferindo equipe registrada', challenging: 'Aguardando resultado do ginásio',
      joining: 'Entrando na fila PvP', queued: 'Caçando enquanto aguarda o PvP', cancelling: 'Saindo da fila PvP',
      registering: 'Inscrevendo na raid semanal', capturing: 'Capturando no Safári' };
    if (this.advanced.owns(a.kind) && a.stage === 'saving') return { code: `activity-${a.kind}`,
      title: a.kind === 'raid' ? 'Registrando formação da raid' : 'Registrando formação do PvP', reason: a.note };
    if (this.advanced.owns(a.kind) && ['disarming', 'entering'].includes(a.stage)) return { code: `activity-${a.kind}`,
      title: a.stage === 'disarming' ? 'Preparando os controles da atividade' : 'Confirmando entrada no Safári', reason: a.note };
    return { code: `activity-${a.kind}`, title: stages[a.stage] ?? 'Reconciliando atividade',
      reason: a.note || `${a.name ?? a.target}. Uma tentativa por vez; aguardando confirmação do jogo.` };
  }

  next() {
    return Object.entries(this.evaluated).filter(([, plan]) => plan?.ready)
      .map(([kind, plan]) => ({ ...plan, kind, priority: plan.priority ?? (kind === 'gym' ? 60 : 50) }))
      .sort((a, b) => b.priority - a.priority)[0] ?? null;
  }

  update(patch) {
    const a = this.current;
    if (!a) return;
    Object.assign(a, patch);
    const row = this.history.find(({ id }) => id === a.id);
    if (row) Object.assign(row, patch);
    this.persist();
  }

  finish(result, note, extra = {}, now = Date.now()) {
    const a = this.current;
    if (!a) return;
    const row = this.history.find(({ id }) => id === a.id);
    if (row) Object.assign(row, { ...extra, result, note, endedAt: now, durationMs: Math.max(0, now - a.at),
      status: result === 'uncertain' ? 'uncertain' : 'confirmed' });
    delete this.planner.runtime.activity;
    this.planner.action(a.kind, note, result === 'uncertain' ? 'uncertain' : 'confirmed', now);
    if (!['pvp', 'raid'].includes(a.kind)) {
      this.session.due.hunt = 0;
      this.session.optimizer.suspend();
    }
    this.persist();
  }

  record(message, now = Date.now()) {
    if (['estado', 'welcome'].includes(message.t) && message.estado) this.stateAt = now;
    this.advanced.record(message, now);
    const a = this.current;
    if (!a || this.advanced.owns(a.kind)) return;
    const { state } = this.session;
    const p = state.player;
    if (a.kind === 'gym') {
      if (message.t === 'ginasio' && message.salvo?.tipo === a.target && a.stage === 'saving'
        && sameIds(message.salvo.pokemonIds, a.pokemonIds)) {
        this.update({ stage: 'registered', savedAt: now });
        state.gymInfoAt = state.gymPanelAt = 0;
      }
      const result = message.t === 'ginasio' && message.desafio;
      if (a.stage === 'challenging' && result?.tipo === a.target && typeof result.venci === 'boolean') {
        state.gymInfoAt = state.gymPanelAt = 0;
        this.finish(result.venci ? 'win' : 'loss', result.venci
          ? `Vitória no ginásio ${a.target}${result.tomouLideranca ? '; liderança confirmada' : '; liderança não transferida'}.`
          : `Derrota no ginásio ${a.target}. Nova tentativa adiada por 24 h.`, { tookLead: result.tomouLideranca === true }, now);
      } else if (message.t === 'ginasio' && message.recusado
        || message.t === 'erro' && /^gin\./.test(message.chave ?? '')) {
        this.finish('rejected', `O jogo recusou a ação no ginásio ${a.target}; tentativa adiada.`, {}, now);
      }
      return;
    }
    const arena = p?.boss?.arena;
    if (arena?.key === a.target && ['entering', 'fighting'].includes(a.stage)) {
      if (!a.entered) this.update({ stage: 'fighting', entered: true, enteredAt: now });
    }
    for (const e of message.t === 'batalha' ? message.ev ?? [] : []) {
      const awaitingResult = ['entering', 'fighting'].includes(a.stage)
        || a.stage === 'returning' && !['win', 'loss'].includes(a.result);
      if (e.k === 'bossMorto' && e.key === a.target && awaitingResult) {
        this.update({ stage: 'returning', result: 'win', resultAt: now,
          drops: (e.drops ?? []).map(({ itemId, nome, qtd }) => ({ itemId, name: nome, quantity: qtd })),
          note: `Vitória contra ${a.name ?? a.target} confirmada. Recuperando e retornando à hunt.` });
      } else if (e.k === 'bossPerdeu' && a.entered && awaitingResult) {
        this.update({ stage: 'returning', result: 'loss', resultAt: now, note: 'Derrota confirmada. Retornando à hunt; este boss fica adiado por 24 h.' });
      } else if (e.k === 'bossSaiu' && a.entered) {
        this.update({ stage: 'returning', result: a.result ?? 'cancelled', resultAt: now });
      }
    }
    if (['estado', 'welcome'].includes(message.t)) {
      const wins = p?.boss?.vitorias?.[a.target];
      if (!arena && (['entering', 'fighting'].includes(a.stage) || a.stage === 'returning' && a.result !== 'win') && Number.isFinite(wins)
        && Number.isFinite(a.winsBefore) && wins > a.winsBefore) {
        this.update({ stage: 'returning', result: 'win', resultAt: now, note: 'Vitória reconciliada pelo contador do jogo. Retornando à hunt.' });
      } else if (!arena && a.entered && a.stage === 'fighting' && (p.noCentro || message.t === 'welcome')) {
        // The result event can arrive after the Center state. Allow time to receive it.
        this.update({ stage: 'returning', result: 'uncertain', resultAt: now });
      }
      if (a.stage === 'returning' && !arena && !p.noCentro && p.huntSlug
        && (message.t === 'welcome' || message.estado?.noCentro === false)) {
        this.finish(a.result ?? 'uncertain', `${a.name ?? a.target}: ${a.result === 'win' ? 'vitória' : a.result === 'loss'
          ? 'derrota' : a.result === 'timeout' ? 'tempo limite' : 'resultado não confirmado'}. Retorno à hunt confirmado.`,
        { drops: a.drops ?? [] }, now);
      }
    }
    if (message.t === 'erro' && /^boss\./.test(message.chave ?? '') && ['disarming', 'entering'].includes(a.stage)) {
      this.finish('rejected', `Entrada em ${a.name ?? a.target} recusada pelo jogo; nova tentativa adiada.`, {}, now);
    }
  }

  async send(message, { retryable = false } = {}) {
    if (!this.session.active()) return false;
    try {
      if (await this.session.browser.send(message)) return true;
      if (retryable) this.update({ note: 'Comando de recuperação não enviado. Aguardando conexão para concluir o retorno.' });
      else this.finish('rejected', 'Ação não enviada. A tentativa foi encerrada para evitar duplicação.');
    } catch {
      // A throw may happen after send. The persisted stage is left pending for reconciliation.
      this.update({ note: 'Resposta indisponível. Aguardando o estado do jogo, sem repetir a entrada.' });
    }
    return false;
  }

  async queryGym(type) {
    const { session } = this;
    const { state } = session;
    if (!session.active()) return false;
    if ((!state.gymInfo || Date.now() - state.gymInfoAt >= FRESH) && session.elapsed('gymInfo', 30_000)) {
      return session.browser.send({ t: 'ginasio.info' });
    }
    if (type && (state.gymPanel?.tipo !== type || Date.now() - state.gymPanelAt >= FRESH)
      && session.elapsed('gymPanel', 15_000)) return session.browser.send({ t: 'ginasio.painel', tipo: type });
    return false;
  }

  async prepareRatings() {
    const { session } = this;
    if (!session.elapsed('gymRatings', 30_000)) return false;
    const account = session.account;
    const browser = session.browser;
    const atlas = await pokemonAtlas().catch(() => null);
    if (!session.active() || session.account !== account || session.browser !== browser || !atlas?.species) return false;
    this.planner.species = atlas.species;
    const pokemon = [...session.state.pokemon.values()];
    const key = this.fingerprint(pokemon);
    const data = await browser.gymData?.(pokemon, atlas.species);
    if (!session.active() || session.account !== account || session.browser !== browser || !data || key !== this.fingerprint()) return false;
    this.ratings = data.ratings;
    this.ratingsKey = key;
    this.ratingsAt = Date.now();
    return true;
  }

  async consider() {
    const { session, planner } = this;
    if (!session.active() || this.current || planner.pending() || planner.strategy.pending() || elsewhere(session.state.player) || session.state.player?.boss?.arena) return false;
    await this.advanced.prepare();
    if (!session.active()) return false;
    this.refresh();
    let { gym, boss } = this.evaluated;
    if (gym.code === 'checking') {
      if (gym.needsRatings) await this.prepareRatings();
      else await this.queryGym(gym.target);
      if (!session.active()) return false;
      ({ gym, boss } = this.refresh());
    }
    const selected = this.next();
    if (this.advanced.owns(selected?.kind)) return this.advanced.consider(selected);
    const kind = selected?.kind ?? null;
    const plan = kind === 'gym' ? gym : boss;
    if (!kind || !session.state.canSwitchHunt(Date.now())) return false;
    let casas;
    if (kind === 'gym') {
      const account = session.account;
      const browser = session.browser;
      const key = this.fingerprint();
      const data = await browser.gymData?.([...session.state.pokemon.values()], planner.species, plan.pokemonIds);
      if (!session.active() || session.account !== account || session.browser !== browser || !data || key !== this.fingerprint()) return false;
      this.ratings = data.ratings;
      this.ratingsKey = key;
      this.ratingsAt = Date.now();
      casas = data.casas;
    }
    // Recheck after any asynchronous work, before reserving a daily attempt.
    this.refresh();
    const fresh = this.evaluated[kind];
    if (!fresh.ready || fresh.target !== plan.target || fresh.action !== plan.action
      || kind === 'gym' && !sameIds(fresh.pokemonIds, plan.pokemonIds)) return false;
    const now = Date.now();
    const a = { id: randomUUID(), kind, target: plan.target, name: plan.name, action: plan.action,
      at: now, status: 'pending', returnHunt: session.state.player.huntSlug, mode: session.mode,
      pokemonIds: plan.pokemonIds, challengerReady: plan.challengerReady,
      itemId: plan.itemId, cost: plan.cost, winsBefore: session.state.player.boss?.vitorias
        ? session.state.player.boss.vitorias[plan.target] ?? 0 : undefined,
      stage: kind === 'gym' ? plan.action === 'register' ? 'saving' : 'challenging'
        : session.state.player.boss?.auto === false ? 'entering' : 'disarming', sentAt: now };
    planner.runtime.activityHistory = [...this.history.filter((row) => now - row.at < 14 * DAY), { ...a }];
    planner.runtime.activity = a;
    session.optimizer.suspend();
    if (kind === 'boss') session.sampleFarm(false);
    this.persist();
    const command = kind === 'gym' ? a.stage === 'saving'
      ? { t: 'ginasio.salvar', tipo: a.target, pokemonIds: a.pokemonIds, casas }
      : { t: 'ginasio.desafiar', tipo: a.target }
      : a.stage === 'disarming' ? { t: 'boss.auto', ativo: false, key: a.target } : { t: 'boss.entrar', key: a.target };
    await this.send(command);
    planner.refresh();
    return true;
  }

  async run(now = Date.now()) {
    const handled = await this.advanced.run(now);
    if (handled || this.advanced.owns(this.current?.kind)) return handled;
    const a = this.current;
    const { session } = this;
    if (!a || !session.active()) return false;
    const p = session.state.player;
    if (a.kind === 'gym') {
      if (now - (a.sentAt ?? a.at) >= 120_000) {
        session.state.gymInfoAt = session.state.gymPanelAt = 0;
        this.finish('uncertain', `Ginásio ${a.target} sem confirmação. Reconsultando o jogo; não repetir automaticamente por 24 h.`);
        return true;
      }
      if (a.stage === 'registered') {
        if (!a.challengerReady) { this.finish('registered', `Equipe do ginásio ${a.target} registrada. O pódio será recalculado pelo jogo.`); return true; }
        if (await this.queryGym(a.target)) return true;
        const plan = gymPlan(this.input(now, true));
        if (plan.needsRatings) { await this.prepareRatings(); return true; }
        if (plan.ready && plan.target === a.target && plan.action === 'challenge') {
          this.update({ stage: 'challenging', action: 'challenge', sentAt: now });
          await this.send({ t: 'ginasio.desafiar', tipo: a.target });
        } else if (plan.code !== 'checking') this.finish('registered', `Equipe registrada em ${a.target}. ${plan.reason}`);
      }
      return true;
    }
    const arena = p?.boss?.arena;
    if (arena && arena.key !== a.target) {
      this.finish('cancelled', 'Outra arena está ativa. O planejador não assumirá esse combate.'); return true;
    }
    if (a.stage === 'disarming') {
      if (now - a.at >= 120_000) {
        this.finish('cancelled', 'Preparação do boss expirou antes da entrada; nenhuma ficha foi solicitada.'); return true;
      }
      if (arena) { this.finish('cancelled', 'Arena iniciada fora desta tentativa. Mantendo controle do jogo.'); return true; }
      if (p.boss?.auto === false) {
        const plan = bossPlan(this.input(now, true));
        if (!plan.ready || plan.target !== a.target || p.activeId !== this.planner.primary()?.id) {
          this.finish('cancelled', `Entrada adiada. ${p.activeId !== this.planner.primary()?.id ? 'O principal não está ativo.' : plan.reason}`); return true;
        }
        this.update({ stage: 'entering', sentAt: now });
        await this.send({ t: 'boss.entrar', key: a.target });
      }
      return true;
    }
    if (arena?.key === a.target && p.boss.auto !== false && session.elapsed('bossDisarm', 15_000)) {
      await this.send({ t: 'boss.auto', ativo: false, key: a.target }, { retryable: true }); return true;
    }
    if (arena && a.stage !== 'returning' && now - a.sentAt >= this.planner.settings.bossMaxMinutes * 60_000) {
      this.update({ stage: 'returning', result: 'timeout', exitSentAt: now, resultAt: now,
        note: 'Tempo máximo atingido. Saída solicitada; a ficha não é devolvida pelo jogo.' });
      await this.send({ t: 'boss.sair' }, { retryable: true }); return true;
    }
    if (arena && a.stage === 'returning' && a.result === 'timeout'
      && now - a.exitSentAt >= 15_000 && this.stateAt > a.exitSentAt) {
      this.update({ exitSentAt: now });
      await this.send({ t: 'boss.sair' }, { retryable: true }); return true;
    }
    if (a.stage === 'entering' && !arena && now - a.sentAt >= 120_000) {
      this.finish('uncertain', 'Entrada no boss sem confirmação. Tentativa reservada e repetição bloqueada por 24 h.'); return true;
    }
    if (a.stage !== 'returning' || arena) return true;
    if (a.result === 'uncertain' && now - a.resultAt < 3000) return true;
    const injured = [...session.state.pokemon.values()].some((pk) => pk.slot != null && pk.hp < pk.maxHp);
    if (p.noCentro && injured) {
      if (session.elapsed('activityHeal', 10_000)) await this.send({ t: 'centro.curar' }, { retryable: true });
      return true;
    }
    if (session.mode !== a.mode || !session.state.hunts.some((hunt) => hunt.slug === a.returnHunt && hunt.nivel <= p.level)) {
      this.finish(a.result ?? 'uncertain', 'Atividade encerrada. Retomando a estratégia atual de hunt.'); return true;
    }
    if (p.noCentro && session.state.canSwitchHunt(now) && session.elapsed('activityReturn', 15_000)) {
      this.update({ returnSentAt: now });
      await this.send({ t: 'hunt.select', slug: a.returnHunt }, { retryable: true });
    }
    return true;
  }

  snapshot() {
    const a = this.current;
    return { ...this.evaluated, active: a && { kind: a.kind, target: a.target, stage: a.stage, at: a.at },
      history: [...this.history].reverse().slice(0, 10).map(({ kind, target, at, status, result, note, durationMs, tookLead, captures, delta }) =>
        ({ kind, target, at, status, result, note, durationMs, tookLead, captures, delta })) };
  }
}
