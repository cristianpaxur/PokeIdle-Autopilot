import { capturePlan } from './capture-policy.mjs';

const DAY = 86_400_000;
const positive = (value) => Number.isFinite(value) && value > 0;
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const count = (value) => integer(value) ? value : 0;
const defaults = {
  autoSafari: true, safariTicketsPerDay: 1, safariMinBalls: 40, safariMinTargets: 3,
  prioritizeXpEvents: true, activitiesDuringXpEvents: false,
  ballMode: 'economy', fixedBallId: 1, ballMaxGold: 10000, captureMinChancePercent: .5, stockMinutes: 10,
};
const badResults = new Set(['pending', 'uncertain', 'bad', 'cancelled', 'canceled', 'failed',
  'rejected', 'timeout', 'abandoned', 'lost', 'loss', 'defeat']);
const nameOf = (entry) => typeof (entry?.name ?? entry?.nome) === 'string' ? (entry.name ?? entry.nome).trim() : '';

export function safariEvidence({ player, pokemon, species = {}, info, data }) {
  if (!integer(info?.ticketId) || !integer(info.durationMs) || !integer(info.poolCount)
    || !integer(player?.level) || !Array.isArray(pokemon)
    || pokemon.some(pk => !integer(pk?.id) || !integer(pk.speciesId))) return false;
  const pool = data?.poolIds;
  return data?.poolComplete === true && Array.isArray(pool) && pool.length === info.poolCount
    && new Set(pool).size === pool.length && pool.every(id => integer(id) && nameOf(species[id])
      && integer(data.captureLevels?.[id]) && data.captureLevels[id] <= 200
      && integer(data.eligibleLevels?.[id]));
}

/**
 * Official helper data: poolIds/poolComplete, captureLevels[id] (captured level),
 * eligibleLevels[id] (minimum trainer level), balls (welcome catalog), and
 * chances[id][ballId] (official base chance). info supplies ticketId, durationMs
 * and welcome poolCount. Call again with the latest pokemon after each capture.
 * This function selects species; entry budgets and state are checked by safariPlan.
 */
export function safariTargets(input = {}) {
  if (!safariEvidence(input)) return [];
  const { player, pokemon, species, data } = input;
  const settings = { ...defaults, ...input.settings };
  const owned = new Map();
  for (const pk of pokemon) {
    if (!integer(pk?.speciesId)) continue;
    if (!owned.has(pk.speciesId)) owned.set(pk.speciesId, []);
    owned.get(pk.speciesId).push(pk);
  }
  const candidates = data.poolIds.map(id => {
    const specimens = owned.get(id) ?? [];
    const missingSpecies = specimens.length === 0;
    const bestOwnedLevel = specimens.length && specimens.every(pk => integer(pk.level))
      ? Math.max(...specimens.map(pk => pk.level)) : null;
    const captureLevel = data.captureLevels[id];
    const minTrainerLevel = data.eligibleLevels[id];
    const usableNow = player.level >= minTrainerLevel;
    const possibleLevelUpgrade = usableNow && bestOwnedLevel != null && captureLevel > bestOwnedLevel;
    return { id, name: nameOf(species[id]), captureLevel, minTrainerLevel, usableNow,
      missingSpecies, possibleLevelUpgrade, bestOwnedLevel,
      priority: missingSpecies ? usableNow ? 3 : 1 : possibleLevelUpgrade ? 2 : 0 };
  }).filter(target => target.priority > 0);

  // Safari is an explicitly enabled activity, independent of hunt/shiny capture
  // mode. Reuse ball choice, but automatic Safari never spends premium balls.
  const capture = capturePlan({ settings: { ...settings, captureMode: 'all', captureTargets: 'all',
    captureSpeciesIds: [], autoBuyBalls: false }, phase: 'safari', player,
    hunt: { especies: candidates.map(target => ({ pokeId: target.id, nome: target.name, pontos: 1 })) },
    balls: (Array.isArray(data.balls) ? data.balls : []).filter(ball => ball?.compravel === true
      && integer(ball.priceGold) && ball.priceGold <= settings.ballMaxGold), chances: data.chances ?? {} });
  const choices = new Map(capture.targets.map(target => [target.id, target]));
  return candidates.map(target => {
    const choice = choices.get(target.id);
    const valid = ball => positive(ball?.chance) && ball.chance <= 1
      && ball.chance * 100 + 1e-9 >= settings.captureMinChancePercent;
    const preferred = valid(choice?.preferred) ? choice.preferred : null;
    const available = valid(choice?.available) ? choice.available : null;
    return { ...target, preferred, available, ballId: available?.id ?? null,
      baseChance: (available ?? preferred)?.chance ?? null, chanceBasis: 'base' };
  }).sort((a, b) => b.priority - a.priority || a.id - b.id);
}

export function safariPlan(input = {}) {
  const { player, pokemon, info, history, bonuses, now = Date.now() } = input;
  const settings = { ...defaults, ...input.settings };
  const recent = (Array.isArray(history) ? history : []).filter(attempt => attempt?.kind === 'safari'
    && Number.isFinite(attempt.at) && attempt.at > now - DAY && attempt.at <= now);
  // Unconfirmed sends consume the local allowance too; absent cost means the
  // usual one-ticket intent. Adopted sessions explicitly record cost: 0.
  const ticketsUsed = recent.reduce((total, attempt) => total + (attempt.cost === 0 ? 0 : count(attempt.cost) || 1), 0);
  const facts = { kind: 'safari', action: 'enter', target: 'safari', itemId: info?.ticketId ?? 70095,
    cost: 1, tickets: 1, priority: 30, durationMs: info?.durationMs, attempts: recent.length,
    ticketsUsed, limit: settings.safariTicketsPerDay };
  const stop = (code, reason, extra = {}) => ({ ...facts, ready: false, code, title: 'Safári', reason, ...extra });
  if (!settings.autoSafari) return stop('disabled', 'Participação automática no Safári desligada.');
  if (player?.safari?.dentro) return stop('active', 'Safári já em andamento; retomar a visita sem gastar outro ticket.');
  if (!Number.isFinite(now)) return stop('checking', 'Aguardando um horário válido para o orçamento e os eventos.');
  if (ticketsUsed >= settings.safariTicketsPerDay) {
    return stop('daily-limit', 'Limite de tickets nas últimas 24 horas atingido; tentativas pendentes e incertas também contam.');
  }
  if (recent.some(attempt => badResults.has(attempt.status) || badResults.has(attempt.result))) {
    return stop('recent-attempt', 'Uma tentativa pendente, incerta, cancelada ou sem bom resultado bloqueia outro gasto por 24 horas.');
  }
  const event = bonuses?.event;
  if (settings.prioritizeXpEvents && !settings.activitiesDuringXpEvents && event?.until > now
    && (event.trainerPercent > 0 || event.pokemonPercent > 0)) {
    return stop('xp-event', 'Evento de XP ativo; o Safári não rende XP de abates e aguarda o fim do evento.');
  }
  if (!safariEvidence(input)) {
    return stop('checking', 'Aguardando pool completo, regras oficiais de nível capturado e elegibilidade do treinador.');
  }
  if (!count(player.items?.[info.ticketId])) {
    return stop('ticket', 'Não há ticket no inventário; o Safári usa somente um ticket já obtido.');
  }
  const team = pokemon.filter(pk => Number.isInteger(pk?.slot) && pk.slot >= 0 && pk.slot < 5);
  if (!team.length) return stop('team', 'Aguardando uma equipe participante.');
  if (team.some(pk => !positive(pk.hp) || !positive(pk.maxHp))) {
    return stop('health', 'Todos os integrantes da equipe precisam estar vivos com saúde conhecida.');
  }
  if (!integer(player.teto?.maxDepot)) return stop('checking', 'Aguardando a capacidade oficial do Depot.');
  const collection = new Set((Array.isArray(player.automation?.pokemonTravado)
    ? player.automation.pokemonTravado : []).map(Number));
  const used = pokemon.filter(pk => pk?.slot == null && !collection.has(pk.id)).length;
  const depot = { used, max: player.teto.maxDepot, free: Math.max(0, player.teto.maxDepot - used) };
  Object.assign(facts, { depot, minTargets: settings.safariMinTargets, minBalls: settings.safariMinBalls });
  if (depot.free < settings.safariMinTargets) {
    return stop('depot', `O Depot precisa de pelo menos ${settings.safariMinTargets} vagas livres para esta visita.`);
  }
  const targets = safariTargets(input);
  Object.assign(facts, { targets, targetIds: targets.map(target => target.id), poolCount: info.poolCount });
  if (targets.length < settings.safariMinTargets) {
    return stop('targets', `Há ${targets.length} espécies de interesse confirmado; a visita exige pelo menos ${settings.safariMinTargets}.`);
  }
  const balls = new Map();
  for (const { available } of targets) if (available) balls.set(available.id, available);
  const ballStock = [...balls.values()].reduce((sum, ball) => sum + ball.have, 0);
  const stockedTargets = targets.filter(target => target.available).length;
  Object.assign(facts, { ballStock, stockedTargets });
  if (stockedTargets < settings.safariMinTargets || ballStock < settings.safariMinBalls) {
    return stop('stock', `Aguardando ${settings.safariMinBalls} bolas apropriadas e estoque para pelo menos ${settings.safariMinTargets} espécies; reposição segue o orçamento compartilhado.`);
  }
  return { ...facts, ready: true, code: 'ready', title: 'Entrar no Safári',
    reason: `Usar 1 ticket já obtido para ${stockedTargets} espécies de interesse. Prioridade para lacunas da coleção e possíveis melhorias de nível. Chance base oficial, sem garantia de captura ou de potência; capturados só podem ser usados no nível permitido pelo jogo.` };
}
