const defaults = { autoRaids: true, raidTokenReserve: 1, raidMinGainPercent: 10 };
const DAY = 86_400_000;
const FRESH = 60_000;
const CUTOFF_MARGIN = 3_000;
const positive = (value) => Number.isFinite(value) && value > 0;
const id = (value) => Number.isSafeInteger(value) && value > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const evaluation = (code, reason, facts = {}) => ({ kind: 'raid', ready: false, code,
  title: 'Raid semanal', reason, priority: 0, ...facts });
const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((value, index) => value === b[index]);
const unresolved = (row) => row.resolved !== true && (['pending', 'uncertain', 'failed', 'rejected'].includes(row.status)
  || ['uncertain', 'failed', 'rejected', 'timeout'].includes(row.result));

function registrationResolved(row, now) {
  const succeeded = row.registered === true || ['registered', 'enrolled'].includes(row.result)
    || ['registered', 'enrolled', 'complete', 'completed'].includes(row.status)
    || row.status === 'confirmed' && !['rejected', 'failed', 'not-registered'].includes(row.result);
  const timestamps = [row.at, ...[row.sentAt, row.endedAt].filter((value) => value !== undefined)];
  return !succeeded && row.resolved === true && row.registered === false
    && timestamps.every(id) && id(row.resolvedAt) && row.resolvedAt <= now
    && row.resolvedAt > Math.max(...timestamps);
}

/**
 * `info` is a fresh, non-refusal server snapshot: {edicao:{id},eu:{inscrito,equipeIds}}.
 * The coordinator owns info freshness and invalidates it on reconnect/account changes.
 * `data` is {at,edition:{id,inscricoesDe,inscricoesAte,equipeAte,fimEm},
 * itemId,cost,maxTeam,ratings:{[ownedPokemonId]:officialCurrentLevelPower}}.
 * All timestamps, including data.at and history, use the LOCAL clock. Convert the
 * official calendar once at the boundary; info.agora is not a second clock source.
 * Ratings must be recalculated when collection/attributes change, before calling.
 * Keep registration history for the whole edition, not just 24 hours. An intent
 * {kind:'raid',target:editionId,action:'register',at,...} prevents another write.
 * Only an explicit reconciliation {resolved:true,registered:false,resolvedAt}
 * later than at/sentAt/endedAt allows one retry; a successful registration never
 * does. Fresh info.eu.inscrito=true authorizes team work independently of history.
 */

export function raidPlan(input = {}) {
  const { player, pokemon, info, data, history = [], now = Date.now() } = input;
  const settings = { ...defaults, ...input.settings };
  if (settings.autoRaids === false) return evaluation('disabled', 'Participação automática desligada.');
  if (settings.autoRaids !== true || !count(settings.raidTokenReserve)
    || !Number.isFinite(settings.raidMinGainPercent) || settings.raidMinGainPercent < 0) {
    return evaluation('checking', 'Aguardando preferências válidas de raid.');
  }
  if (!id(now) || !id(data?.at) || now < data.at || now - data.at > FRESH) {
    return evaluation('checking', 'Aguardando regras atuais de raid e relógio local válido.', { needsData: true });
  }
  const edition = data.edition;
  if (!object(edition) || typeof edition.id !== 'string' || !edition.id.trim()
    || ![edition.inscricoesDe, edition.inscricoesAte, edition.equipeAte, edition.fimEm].every(id)
    || edition.inscricoesDe >= edition.inscricoesAte || edition.inscricoesAte > edition.equipeAte
    || edition.equipeAte >= edition.fimEm) {
    return evaluation('checking', 'Aguardando o calendário oficial completo da edição.', { needsData: true });
  }
  const facts = { target: edition.id, registrationDeadline: edition.inscricoesAte,
    teamDeadline: edition.equipeAte, reserve: settings.raidTokenReserve };
  const stop = (code, reason, extra = {}) => evaluation(code, reason, { ...facts, ...extra });
  if (now >= edition.fimEm) return stop('checking', 'A edição terminou; consultando o próximo calendário.', { needsData: true, needsInfo: true });
  if (!object(info) || info.recusa || info.edicao?.id !== edition.id || typeof info.eu?.inscrito !== 'boolean') {
    return stop('checking', 'Aguardando a participação confirmada nesta edição.', { needsInfo: true });
  }
  facts.registered = info.eu.inscrito;
  if (!Array.isArray(history)) return stop('checking', 'Aguardando o histórico de intenções desta conta.');
  const attempts = history.filter((row) => row?.kind === 'raid' && row.target === edition.id);
  if (now < edition.inscricoesDe) return stop('scheduled', 'A inscrição desta edição ainda não abriu.', { until: edition.inscricoesDe });
  const deadline = facts.registered ? edition.equipeAte : edition.inscricoesAte;
  if (now >= deadline) return facts.registered
    ? stop('locked', 'A equipe desta edição está fechada; a batalha e o eventual bônus são automáticos.')
    : stop('closed', 'A janela de inscrição desta edição terminou.');
  if (deadline - now <= CUTOFF_MARGIN) return stop('closing', 'O fechamento está próximo demais para confirmar uma nova alteração.');
  if (!facts.registered) {
    const registrations = attempts.filter((row) => row.action !== 'team');
    if (registrations.length >= 2 || registrations.some((row) => !registrationResolved(row, now))) {
      return stop('checking', 'Já existe uma intenção de inscrição nesta edição; aguardando reconciliação, sem gastar outra ficha.', { needsInfo: true });
    }
  }
  if (!object(player) || !object(player.items) || !id(data.itemId) || !count(data.cost)
    || !id(data.maxTeam) || data.maxTeam > 5 || !object(data.ratings)) {
    return stop('checking', 'Aguardando inventário, custo e limites oficiais da raid.', { needsData: true });
  }
  const tokens = Object.hasOwn(player.items, data.itemId) ? player.items[data.itemId] : 0;
  if (!count(tokens)) return stop('checking', 'A quantidade de fichas ainda não é válida.');
  const cost = facts.registered ? 0 : data.cost;
  Object.assign(facts, { cost, registrationCost: data.cost, itemId: data.itemId, tokens, tokensAfter: tokens - cost });
  if (!facts.registered && facts.tokensAfter < settings.raidTokenReserve) {
    return stop('reserve', 'As fichas disponíveis não cobrem a inscrição e a reserva configurada.');
  }
  if (!Array.isArray(pokemon) || pokemon.some((pk) => !id(pk?.id))
    || pokemon.some((pk) => !positive(data.ratings[pk.id]))) {
    return stop('checking', 'Aguardando a coleção completa e o poder oficial no nível atual.', { needsData: true });
  }
  const owned = [...new Map(pokemon.map((pk) => [pk.id, pk])).values()];
  const selected = owned.sort((a, b) => data.ratings[b.id] - data.ratings[a.id]
    || (positive(b.level) ? b.level : 0) - (positive(a.level) ? a.level : 0) || b.id - a.id).slice(0, data.maxTeam);
  if (!selected.length) return stop('team', 'Ainda não há Pokémon próprios para formar a equipe.');
  const power = selected.reduce((sum, pk) => sum + data.ratings[pk.id], 0);
  if (!positive(power)) return stop('checking', 'O poder oficial total ainda não é válido.', { needsData: true });
  const pokemonIds = selected.map((pk) => pk.id);
  Object.assign(facts, { pokemonIds, power });
  const priority = deadline - now <= DAY ? 70 : 60;
  if (facts.registered) {
    const saved = info.eu.equipeIds;
    if (saved !== null && !Array.isArray(saved)) {
      return stop('checking', 'Aguardando a equipe salva ou a confirmação de uso da equipe de caça.', { needsInfo: true });
    }
    const ownedIds = new Set(owned.map((pk) => pk.id));
    const valid = Array.isArray(saved) && saved.length > 0 && saved.length <= data.maxTeam
      && new Set(saved).size === saved.length && saved.every((value) => id(value) && ownedIds.has(value));
    if (valid) {
      const previousPower = saved.reduce((sum, value) => sum + data.ratings[value], 0);
      if (!positive(previousPower)) return stop('checking', 'Aguardando o poder atual da equipe salva.', { needsData: true });
      const gainPercent = (power - previousPower) * 100 / previousPower;
      Object.assign(facts, { currentPokemonIds: [...saved], previousPower, gainPercent });
      if (sameIds(saved, pokemonIds)) return stop('registered', 'Inscrição e equipe confirmadas; a participação não interrompe a caça.');
      if (power <= previousPower || gainPercent < settings.raidMinGainPercent) {
        return stop('no-gain', `Mantendo a equipe e sua ordem: a melhora de poder não atinge ${settings.raidMinGainPercent}%.`,
          { pokemonIds: [...saved], power: previousPower, candidatePokemonIds: pokemonIds, candidatePower: power });
      }
    }
    if (attempts.some((row) => row.action === 'team' && sameIds(row.pokemonIds, pokemonIds) && unresolved(row))) {
      return stop('checking', 'A mesma equipe já foi enviada; aguardando confirmação antes de repetir.', { needsInfo: true });
    }
    return { ...facts, ready: true, kind: 'raid', code: 'ready', title: 'Atualizar equipe da raid',
      reason: valid ? 'A nova equipe melhora o poder oficial no nível atual; o bônus depende do resultado da raid.'
        : 'Registrar os Pokémon próprios de maior poder, na ordem de entrada, para a batalha automática.',
      priority, action: 'team', repairTeam: !valid };
  }
  return { ...facts, kind: 'raid', ready: true, code: 'ready', title: 'Inscrever na raid semanal',
    reason: 'Inscrição com fichas próprias; a batalha e o eventual bônus são automáticos.',
    priority, action: 'register' };
}
