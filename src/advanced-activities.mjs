import { randomUUID } from 'node:crypto';
import { pokemonAtlas } from './catalog.mjs';
import { capturePlan } from './capture-policy.mjs';
import { pvpPlan } from './pvp-policy.mjs';
import { safariEvidence, safariPlan, safariTargets } from './safari-policy.mjs';
import { raidPlan } from './raid-policy.mjs';

const FRESH = 60_000;
const WAIT = 120_000;
const RETAIN = 14 * 86_400_000;
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((id, i) => id === b[i]);
const kinds = new Set(['pvp', 'safari', 'raid']);
const away = (p) => p?.boss?.arena || p?.mistico || p?.safari?.dentro || p?.casa?.dentro;

export class AdvancedActivities {
  constructor(activities) { this.activities = activities; this.planner = activities.planner; this.session = activities.session; this.reset(); }
  reset() { this.rules = null; this.rulesKey = null; this.rulesAt = 0; this.retryAt = 0; this.chances = {}; this.reward = false; this.replayGeneration = null; }
  owns(kind) { return kinds.has(kind); }
  get current() { return this.activities.current; }
  key() { return JSON.stringify([this.session.state.generation, this.activities.fingerprint(), this.session.state.safariPool]); }
  guard() {
    const { session, planner } = this;
    const { browser, account } = session;
    const generation = session.state.generation, settings = planner.settings;
    return () => Boolean(session.active() && !['blocked', 'setup'].includes(session.status) && session.browser === browser
      && session.account === account && session.state.generation === generation && planner.settings === settings);
  }

  input(kind, now = Date.now(), excludeCurrent = false) {
    const { state } = this.session;
    const input = this.activities.input(now, excludeCurrent);
    const rules = this.rulesKey === this.key() && now - this.rulesAt < FRESH ? this.rules : null;
    if (kind === 'pvp') return { ...input, data: rules?.pvp,
      info: state.pvpInfo && now - state.pvpInfoAt < FRESH ? { ...state.pvpInfo, cooldownUntil: state.pvpCooldownUntil } : null };
    if (kind === 'raid') {
      const data = rules?.raid && { ...rules.raid, at: this.rulesAt, edition: { ...rules.raid.edition } };
      if (data?.edition) for (const key of ['inscricoesDe', 'inscricoesAte', 'equipeAte', 'batalhaEm', 'transmissaoEm', 'fimEm']) {
        if (Number.isFinite(data.edition[key])) data.edition[key] -= state.serverOffset;
      }
      return { ...input, data, info: state.raidInfo && now - state.raidInfoAt < FRESH ? state.raidInfo : null };
    }
    return { ...input, data: rules?.safari && { ...rules.safari, balls: state.balls, chances: this.chances },
      info: rules?.safari && { ticketId: rules.safari.ticketId, durationMs: rules.safari.durationMs, poolCount: state.safariPool } };
  }

  refresh(now = Date.now()) {
    return { pvp: pvpPlan(this.input('pvp', now)), safari: safariPlan(this.input('safari', now)), raid: raidPlan(this.input('raid', now)) };
  }

  async query(kind, now = Date.now()) {
    if (!this.session.active() || !this.session.elapsed(`${kind}Info`, 30_000)) return false;
    const command = kind === 'pvp' ? { t: 'pvp.info', semLadder: 1 } : { t: 'raid.info' };
    return this.session.browser.send(command).catch(() => false);
  }

  async prepare() {
    const { session, planner } = this;
    if (!session.active() || typeof session.browser?.activityData !== 'function') return false;
    const valid = this.guard();
    const now = Date.now();
    const { state } = session;
    if (planner.settings.autoPvp && state.player?.level >= 150 && now - state.pvpInfoAt >= FRESH) await this.query('pvp', now);
    if (!valid()) return false;
    if (planner.settings.autoRaids && now - state.raidInfoAt >= FRESH) await this.query('raid', now);
    if (!valid()) return false;
    if (this.rulesKey === this.key() && now - this.rulesAt < FRESH - 10_000) return true;
    if (now < this.retryAt) return false;
    this.retryAt = now + 15_000;
    if (!Object.keys(planner.species).length) {
      const atlas = await pokemonAtlas().catch(() => null);
      if (!valid()) return false;
      if (atlas?.species) planner.species = atlas.species;
    }
    const key = this.key();
    const rules = await session.browser.activityData({ player: state.player, pokemon: [...state.pokemon.values()],
      species: planner.species, hunts: state.hunts, safariPool: state.safariPool, now: state.serverNow() }).catch(() => null);
    if (!valid() || key !== this.key() || !rules) return false;
    let chances = this.chances;
    if (rules.safari?.poolComplete && planner.settings.autoSafari
      && (state.player?.items?.[rules.safari.ticketId] > 0 || state.player?.safari?.dentro)) {
      chances = await session.browser.captureChances?.({ species: planner.species,
        targets: rules.safari.poolIds.map((id) => ({ id })), hunts: state.hunts, balls: state.balls, rules: state.captureRules });
      if (!valid() || key !== this.key()) return false;
    }
    this.rules = rules; this.rulesKey = key; this.rulesAt = Date.now(); this.chances = chances ?? {};
    return true;
  }

  begin(plan, stage, extra = {}) {
    const { session, planner, activities } = this;
    const now = Date.now();
    const a = { id: randomUUID(), kind: plan.kind, target: plan.target, action: plan.action,
      stage, at: now, sentAt: now, status: 'pending', mode: session.mode, returnHunt: session.state.player?.huntSlug,
      pokemonIds: plan.pokemonIds, cost: plan.cost ?? 0, itemId: plan.itemId, power: plan.power,
      before: plan.itemId ? session.state.player?.items?.[plan.itemId] ?? 0 : undefined,
      generation: session.state.generation, note: plan.reason, ...extra };
    planner.runtime.activityHistory = [...activities.history.filter((row) => now - row.at < RETAIN), { ...a }];
    planner.runtime.activity = a;
    if (a.kind === 'safari') { session.optimizer.suspend(); session.sampleFarm(false); }
    activities.persist();
    return a;
  }

  async consider(plan) {
    const { session, planner, activities } = this;
    const valid = this.guard();
    if (!plan?.ready || !valid() || this.current || away(session.state.player) || planner.pending() || planner.strategy.pending()) return false;
    let casas;
    if (plan.kind === 'pvp' && plan.action === 'save') {
      const key = this.key();
      const data = await session.browser.gymData([...session.state.pokemon.values()], planner.species, plan.pokemonIds);
      if (!valid() || key !== this.key() || !data?.casas) return false;
      casas = data.casas;
    }
    if (plan.kind === 'pvp' && plan.action === 'queue') {
      if (!await session.browser.suppressPvpReplay?.(valid) || !valid()) return false;
      this.replayGeneration = session.state.generation;
    }
    const fresh = this.refresh()[plan.kind];
    if (!valid() || !fresh.ready || fresh.action !== plan.action || fresh.target !== plan.target
      || plan.pokemonIds && !same(fresh.pokemonIds, plan.pokemonIds)) return false;
    const p = session.state.player;
    if (plan.kind === 'safari' && !session.state.canSwitchHunt(Date.now())) return false;
    const native = plan.kind === 'pvp' ? p.automation?.pvpAutoFila === true
      : plan.kind === 'safari' && (p.automation?.autoBallSemParar === true || p.automation?.autoBallAteCapturar === true);
    const stage = plan.kind === 'pvp' ? plan.action === 'save' ? 'saving' : 'joining'
      : plan.kind === 'raid' ? plan.action === 'register' ? 'registering' : 'saving' : 'entering';
    const knownIds = [...(session.state.pvpInfo?.historico ?? []), ...(session.state.pvpInfo?.naoVistas ?? []), session.state.pvpInfo?.lastMatch]
      .filter(Boolean).map((match) => match.id);
    const a = this.begin(plan, native ? 'disarming' : stage, { casas, nextStage: stage,
      beforeMatchIds: plan.kind === 'pvp' ? knownIds : undefined,
      matchesBefore: plan.kind === 'pvp' ? session.state.pvpInfo?.rank?.partidas : undefined });
    await activities.send(native ? { t: 'auto.set', ...p.automation, ...(plan.kind === 'pvp'
      ? { pvpAutoFila: false } : { autoBallSemParar: false, autoBallAteCapturar: false }) } : this.command(a));
    planner.refresh();
    return true;
  }

  command(a) {
    if (a.kind === 'pvp') return a.action === 'save' ? { t: 'pvp.time.salvar', pokemonIds: a.pokemonIds, casas: a.casas }
      : { t: 'pvp.fila.entrar' };
    if (a.kind === 'raid') return a.action === 'register' ? { t: 'raid.inscrever' } : { t: 'raid.equipe', pokemonIds: a.pokemonIds };
    return { t: 'safari.entrar', tickets: 1 };
  }

  rememberTeam(kind, ids) {
    if (!Array.isArray(ids)) return;
    (this.planner.runtime.reservedTeams ??= {})[kind] = [...ids];
    this.activities.persist();
  }
  reservedIds() {
    return new Set([...Object.values(this.planner.runtime.reservedTeams ?? {}).flat(), ...(this.current?.pokemonIds ?? [])]);
  }

  record(message, now = Date.now()) {
    const { state } = this.session;
    if (message.t === 'pvp' && (Array.isArray(message.time) || Array.isArray(message.timeSalvo))) this.rememberTeam('pvp', message.timeSalvo ?? message.time);
    if (message.t === 'raid' && !message.recusa && message.eu) this.rememberTeam('raid', message.eu.inscrito ? message.eu.equipeIds ?? [] : []);
    if (message.t === 'batalha' && message.ev?.some((event) => ['safariFim', 'safariAbandonou'].includes(event.k))) this.reward = true;
    const a = this.current;
    if (!this.owns(a?.kind)) return;
    const { activities } = this;
    if (a.kind === 'raid' && message.t === 'raid') {
      if (message.recusa) {
        if (message.recusa === 'raid.recusa.ja') { this.session.due.raidInfo = 0; return; }
        activities.finish('rejected', `Raid: ${message.recusa}. Reavaliar após nova informação do jogo.`, {}, now); return;
      }
      if (message.edicao?.id !== a.target) return;
      if (a.action === 'register' && message.eu?.inscrito === true) {
        activities.finish('registered', 'Inscrição na raid confirmada; batalha e bônus serão automáticos. A caça continua.', { registered: true }, now);
      } else if (a.action === 'team' && message.eu?.inscrito === true && same(message.eu.equipeIds, a.pokemonIds)) {
        activities.finish('team', 'Formação da raid confirmada na ordem escolhida. A caça continua.', { registered: true }, now);
      }
      return;
    }
    if (a.kind === 'pvp' && message.t === 'pvp') {
      if (message.recusa || message.filaRecusa) {
        activities.finish('rejected', `PvP recusado: ${(message.filaRecusa ?? message.recusa).msg ?? 'aguardar nova avaliação'}.`, {}, now); return;
      }
      const info = state.pvpInfo;
      if (a.action === 'save' && same(info?.time, a.pokemonIds)
        && a.pokemonIds.every((id) => info.casas?.[id] === a.casas?.[id]) && (message.timeSalvo || message.time)) {
        activities.finish('team', 'Equipe e posições do PvP confirmadas; a equipe de caça foi mantida.', {}, now); return;
      }
      if (a.action !== 'queue') return;
      const seen = new Set([...(a.beforeMatchIds ?? []), ...(this.planner.runtime.pvpSeenMatches ?? [])]);
      const candidates = message.partida ? [message.partida]
        : [...(message.naoVistas ?? []), ...(message.historico ?? [])].filter((match) => {
          const created = Date.parse(match.criadoEm ?? '');
          return Number.isFinite(created) ? created - state.serverOffset >= a.sentAt
            : Number.isFinite(a.matchesBefore) && info?.rank?.partidas > a.matchesBefore;
        }).sort((x, y) => y.id - x.id);
      const match = candidates.find((entry) => Number.isSafeInteger(entry.id) && entry.id > 0 && typeof entry.venci === 'boolean' && !seen.has(entry.id));
      if (match) {
        this.planner.runtime.pvpSeenMatches = [...(this.planner.runtime.pvpSeenMatches ?? []), match.id].slice(-200);
        activities.finish(match.venci ? 'win' : 'loss', `${match.venci ? 'Vitória' : 'Derrota'} no PvP confirmada${Number.isFinite(match.delta) ? ` (${match.delta >= 0 ? '+' : ''}${match.delta} PR)` : ''}.`,
          { matchId: match.id, delta: match.delta, resultAt: now }, now); return;
      }
      if (message.fila?.na === true && a.stage !== 'cancelling') activities.update({ stage: 'queued', queueObserved: true });
      if (message.fila?.na === false && a.stage === 'cancelling') activities.finish('timeout', 'Busca do PvP cancelada e saída da fila confirmada.', {}, now);
      return;
    }
    if (a.kind !== 'safari') return;
    const safari = state.player?.safari;
    if (['estado', 'welcome'].includes(message.t)) {
      if (safari?.dentro && Number.isFinite(safari.fim)) activities.update({ stage: a.stage === 'returning' ? 'returning' : 'capturing', entered: true,
        endsAt: safari.fim - state.serverOffset, captures: safari.capturas ?? a.captures ?? 0 });
      else if (a.entered && (message.t === 'welcome' || Object.hasOwn(message.estado ?? {}, 'safari'))) {
        activities.update({ stage: 'returning', endedSafari: true, result: a.result ?? 'completed' });
      }
      if (a.stage === 'returning' && !safari?.dentro && state.player?.noCentro === false && state.player?.huntSlug
        && !away(state.player) && (message.t === 'welcome' || Object.hasOwn(message.estado ?? {}, 'noCentro'))) {
        activities.finish(a.result ?? 'completed', `Safári encerrado com ${a.captures ?? 0} captura(s); retorno à caça confirmado.`, { captures: a.captures ?? 0 }, now);
      }
    }
    for (const event of message.t === 'batalha' ? message.ev ?? [] : []) {
      if (event.k === 'safariEntrou') activities.update({ entered: true, stage: 'capturing',
        ...(Number.isFinite(event.fim) ? { endsAt: event.fim - state.serverOffset } : {}) });
      if (['safariFim', 'safariAbandonou'].includes(event.k)) activities.update({ stage: 'returning',
        result: event.k === 'safariFim' ? 'completed' : 'cancelled', captures: event.capturas ?? a.captures ?? 0 });
      if (event.k === 'capturado' && a.entered) activities.update({ captures: (a.captures ?? 0) + 1 });
    }
    if (message.t === 'erro' && message.chave?.startsWith('safari.') && !safari?.dentro) {
      activities.finish('rejected', `Safári recusado: ${message.chave}. O ticket não será reenviado nesta tentativa.`, {}, now);
    }
  }

  captureInput() {
    if (this.current?.kind !== 'safari' || !this.session.state.player?.safari?.dentro || this.current.stage !== 'capturing') return null;
    return this.captureContext(safariTargets(this.input('safari')));
  }
  captureContext(targets) {
    const { state } = this.session;
    const settings = this.planner.settings;
    const eligible = targets.filter((target) => target.available || target.preferred);
    return { settings: { ...settings, captureMode: 'all', captureTargets: 'selected', captureSpeciesIds: eligible.map((t) => t.id) },
      phase: 'safari', player: state.player, hunt: { slug: 'safari', especies: targets.map((t) => ({ pokeId: t.id, nome: t.name })) },
      balls: state.balls.filter((ball) => ball.compravel === true && Number.isSafeInteger(ball.priceGold)
        && ball.priceGold > 0 && ball.priceGold <= settings.ballMaxGold), shinyLooks: {} };
  }
  preparationSupplies() {
    const plan = this.activities.evaluated.safari;
    if (this.current || plan?.code !== 'stock' || !plan.targets?.length) return null;
    const capture = capturePlan({ ...this.captureContext(plan.targets), chances: this.chances });
    const preferred = new Map(plan.targets.filter((target) => target.preferred).map((target) => [target.preferred.id, target.preferred]));
    capture.stocks = capture.stocks.map((stock) => ({ ...stock, target: Math.max(stock.target, this.planner.settings.safariMinBalls) }));
    capture.restocks = this.planner.settings.autoBuyBalls ? capture.stocks.filter((stock) => stock.have < stock.target)
      .map((stock) => preferred.get(stock.itemId)).filter(Boolean) : [];
    capture.restock = capture.restocks[0] ?? null;
    return capture;
  }

  safariStopReason(now) {
    const input = this.input('safari', now);
    if (!safariEvidence(input)) return null;
    const targets = safariTargets(input);
    if (!targets.length) return 'As espécies de interesse já foram obtidas; retomar a progressão.';
    const collection = new Set(input.player.automation?.pokemonTravado ?? []);
    const used = input.pokemon.filter((pk) => pk.slot == null && !collection.has(pk.id)).length;
    if (Number.isSafeInteger(input.player.teto?.maxDepot) && used >= input.player.teto.maxDepot) return 'Depot sem vagas para novas capturas; retomar a progressão.';
    const balls = this.captureContext(targets).balls;
    const chancesKnown = balls.length > 0 && targets.every((target) => balls.every((ball) => {
      const chance = input.data.chances?.[target.id]?.[ball.id];
      return Number.isFinite(chance) && chance >= 0 && chance <= 1;
    }));
    if (chancesKnown && !targets.some((target) => target.available) && !this.planner.pending() && !this.planner.supply?.action) {
      return 'Sem bolas adequadas ou reposição dentro do orçamento; retomar a progressão.';
    }
    return null;
  }

  async leaveSafari(note, now) {
    this.activities.update({ stage: 'returning', result: 'cancelled', exitRequested: true, note });
    if (this.session.state.canSwitchHunt(now)) {
      this.activities.update({ exitSentAt: now });
      await this.activities.send({ t: 'centro.ir' }, { retryable: true });
    }
  }

  async run(now = Date.now()) {
    const { activities, session, planner } = this;
    const valid = this.guard();
    if (!valid()) return false;
    if (this.reward && await session.browser.dismissStrategyReward?.({ kind: 'safari' }, valid)) { this.reward = false; return true; }
    let a = this.current;
    const p = session.state.player;
    if (!a && p?.safari?.dentro) a = this.begin({ kind: 'safari', action: 'adopt', target: 'safari', cost: 0 }, 'capturing', {
      entered: true, endsAt: p.safari.fim - session.state.serverOffset, captures: p.safari.capturas ?? 0 });
    if (!a && session.state.pvpInfo?.fila?.na) a = this.begin({ kind: 'pvp', action: 'queue', target: 'ranked' }, 'queued', {
      queueObserved: true, beforeMatchIds: (session.state.pvpInfo.historico ?? []).map((row) => row.id),
      matchesBefore: session.state.pvpInfo.rank?.partidas });
    if (!this.owns(a?.kind)) return false;
    if (a.stage === 'disarming') {
      const off = a.kind === 'pvp' ? p.automation?.pvpAutoFila === false
        : p.automation?.autoBallSemParar === false && p.automation?.autoBallAteCapturar === false;
      if (off) {
        const fresh = (a.kind === 'pvp' ? pvpPlan : safariPlan)(this.input(a.kind, now, true));
        if (!fresh.ready || fresh.action !== a.action || fresh.target !== a.target
          || a.pokemonIds && !same(fresh.pokemonIds, a.pokemonIds)) { activities.finish('cancelled', 'Preparação mudou; a atividade será reavaliada.'); return false; }
        activities.update({ stage: a.nextStage, sentAt: now });
        await activities.send(this.command(a));
      } else if (now - a.at >= WAIT) activities.finish('uncertain', 'A automação nativa não confirmou a preparação. Nova entrada adiada.');
      return a.kind === 'safari';
    }
    if (a.kind === 'pvp') {
      if (a.action === 'queue' && this.replayGeneration !== session.state.generation) {
        if (!await session.browser.suppressPvpReplay?.(valid) || !valid() || this.current?.id !== a.id) return false;
        this.replayGeneration = session.state.generation;
      }
      if (p.automation?.pvpAutoFila === true && session.elapsed('pvpNativeAuto', 15_000)) {
        await activities.send({ t: 'auto.set', ...p.automation, pvpAutoFila: false }, { retryable: true });
      }
      if (!valid() || this.current?.id !== a.id) return false;
      if (a.action === 'queue' && now - a.sentAt >= planner.settings.pvpQueueMinutes * 60_000) {
        if (a.stage !== 'cancelling') {
          activities.update({ stage: 'cancelling', exitSentAt: now });
          await activities.send({ t: 'pvp.fila.sair' }, { retryable: true });
        } else if (now - a.exitSentAt >= WAIT) {
          // A lost cancellation never authorizes another entry; the next fresh queue snapshot is adopted.
          activities.finish('uncertain', 'Saída da fila sem confirmação; novas entradas aguardam reconciliação.');
        }
      } else if (a.action === 'save' && now - a.sentAt >= WAIT) activities.finish('uncertain', 'Formação PvP sem confirmação; reconsultando o servidor.');
      await this.query('pvp', now);
      return false;
    }
    if (a.kind === 'raid') {
      await this.query('raid', now);
      if (this.current?.id === a.id && now - a.sentAt >= WAIT) activities.finish('uncertain', 'Raid sem confirmação; inscrição reservada nesta edição, sem repetir o gasto.');
      return false;
    }
    if (!a.entered && now - a.sentAt >= WAIT) {
      activities.finish('uncertain', 'Entrada do Safári sem confirmação; ticket reservado e nova entrada adiada por 24 horas.');
      if (valid()) await session.reloadGame();
      return true;
    }
    if (p.safari?.dentro && a.stage === 'capturing') {
      if (!planner.settings.autoSafari) {
        await this.leaveSafari('Participação desligada; encerrando a visita e retornando à caça.', now);
        return true;
      }
      if (now >= (a.endsAt ?? Infinity) + 30_000) {
        if (session.elapsed('safariResync', 120_000)) await session.reloadGame();
        return true;
      }
      await this.prepare();
      if (!valid()) return true;
      await planner.capture.prepare();
      if (!valid()) return true;
      if (await planner.buySupplies()) return true;
      if (!valid() || this.current?.id !== a.id) return true;
      const stop = this.safariStopReason(now);
      if (!stop && a.idleSince) activities.update({ idleSince: null });
      if (stop && !a.idleSince) activities.update({ idleSince: now });
      if (stop && now - a.idleSince >= 60_000) { await this.leaveSafari(stop, now); return true; }
      const managed = { ...planner.supply?.automation, autoBallSemParar: false, autoBallAteCapturar: false };
      if (p.automation && Object.entries(managed).some(([key, value]) => JSON.stringify(p.automation[key]) !== JSON.stringify(value))
        && session.elapsed('safariAuto', 15_000)) { await activities.send({ t: 'auto.set', ...p.automation, ...managed }, { retryable: true }); return true; }
      if (session.elapsed('safariThrow', 2800)) await planner.capture.run();
      return true;
    }
    if (a.stage !== 'returning') return true;
    if (p.safari?.dentro) {
      if (a.exitRequested && session.state.canSwitchHunt(now)
        && (!a.exitSentAt || now - a.exitSentAt >= 30_000 && activities.stateAt > a.exitSentAt)) {
        activities.update({ exitSentAt: now });
        await activities.send({ t: 'centro.ir' }, { retryable: true });
      } else if (!a.exitRequested && now - (a.endsAt ?? now) > 30_000 && session.elapsed('safariResync', 120_000)) await session.reloadGame();
      return true;
    }
    const injured = [...session.state.pokemon.values()].some((pk) => pk.slot != null && pk.hp < pk.maxHp);
    if (p.noCentro && injured) {
      if (session.elapsed('activityHeal', 10_000)) await activities.send({ t: 'centro.curar' }, { retryable: true });
      return true;
    }
    const route = session.state.hunts.find((hunt) => hunt.slug === a.returnHunt && hunt.nivel <= p.level);
    if (!route || a.mode !== session.mode) { activities.finish(a.result ?? 'completed', 'Safári encerrado; reavaliando a melhor rota disponível.', { captures: a.captures ?? 0 }); return false; }
    if (p.noCentro && session.state.canSwitchHunt(now) && session.elapsed('activityReturn', 15_000)) await activities.send({ t: 'hunt.select', slug: route.slug }, { retryable: true });
    return true;
  }
}
