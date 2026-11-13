const defaults = { autoPvp: true, pvpAttemptsPerDay: 12, pvpQueueMinutes: 3,
  pvpLossStreak: 2, pvpRestMinutes: 60 };
const day = 86_400_000;
const minute = 60_000;
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const positive = (value) => Number.isFinite(value) && value > 0;
const evaluation = (code, title, reason, facts = {}) => ({
  kind: 'pvp', target: 'ranked', priority: 40, ready: false, code, title, reason, ...facts,
});
const validTeam = (ids) => Array.isArray(ids) && ids.length <= 5
  && ids.every(integer) && new Set(ids).size === ids.length;

function confirmedResults(history, now) {
  return history.filter((row) => row.status === 'confirmed' && ['win', 'loss'].includes(row.result))
    .map((row) => ({ result: row.result, at: row.resultAt ?? row.endedAt ?? row.at, startedAt: row.at }))
    .filter((row) => Number.isFinite(row.at) && row.at >= row.startedAt && row.at <= now)
    .sort((a, b) => b.at - a.at || b.startedAt - a.startedAt);
}

// The coordinator supplies fresh server info and a local-clock cooldownUntil, including zero.
// Ratings are validated positive powers from poderNoGinasio; match IDs are deduplicated upstream.
export function pvpPlan(input = {}) {
  const { player, pokemon = [], info, data, history = [], now = Date.now() } = input;
  const settings = { ...defaults, ...input.settings };
  const reservations = (Array.isArray(history) ? history : []).filter((row) => row?.kind === 'pvp'
    && row.action === 'queue' && Number.isFinite(row.at) && row.at <= now);
  const recent = reservations.filter((row) => row.at > now - day);
  const results = confirmedResults(reservations, now);
  let lossStreak = 0;
  for (const result of results) {
    if (result.result !== 'loss') break;
    lossStreak++;
  }
  const facts = { attempts: recent.length, limit: settings.pvpAttemptsPerDay, lossStreak,
    queueTimeoutMs: settings.pvpQueueMinutes * minute };
  const stop = (code, reason, extra = {}) => evaluation(code, 'PvP ranqueado', reason, { ...facts, ...extra });

  // An existing queue must be reconciled even when new automatic entries are disabled.
  if (info?.fila?.na === true) return stop('waiting', 'Fila ranqueada já ativa; acompanhar a busca existente.', { adopt: true });
  if (!settings.autoPvp) return stop('disabled', 'Participação automática desligada.');
  if (!positive(player?.level)) return stop('checking', 'Aguardando o nível do treinador.');
  const ruleMinimum = integer(info?.regras?.nivelMin) ? info.regras.nivelMin : data?.minimumLevel;
  const minimumLevel = Math.max(150, integer(ruleMinimum) ? ruleMinimum : 150);
  Object.assign(facts, { minimumLevel });
  if (player.level < minimumLevel) return stop('level', `Requer treinador de nível ${minimumLevel}.`);
  if (player.mistico) return stop('busy', 'Aguardar o término da Arena Mística antes de entrar no ranqueado.');
  if (!validTeam(info?.time) || typeof info?.fila?.na !== 'boolean'
    || !Number.isFinite(info?.cooldownUntil) || info.cooldownUntil < 0) {
    return stop('checking', 'Aguardando equipe, estado da fila e cooldown atuais do servidor.', { needsInfo: true });
  }
  const unresolved = recent.filter((row) => ['pending', 'uncertain'].includes(row.status) || row.result === 'uncertain');
  if (unresolved.length) {
    return stop('recent-attempt', 'Uma entrada pendente ou incerta exige reconciliação; não repetir por 24 horas.',
      { retryAt: Math.max(...unresolved.map((row) => row.at + day)) });
  }
  const minTeam = data?.minTeam === undefined ? 1 : data.minTeam;
  const maxTeam = data?.maxTeam === undefined ? 5 : data.maxTeam;
  if (!integer(ruleMinimum) || !integer(minTeam) || !integer(maxTeam) || minTeam > Math.min(5, maxTeam)
    || !data?.ratings || typeof data.ratings !== 'object' || !Array.isArray(pokemon)) {
    return stop('checking', 'Aguardando regras e cálculos oficiais de poder do ranqueado.', { needsData: true });
  }
  const owned = [...new Map(pokemon.filter((pk) => integer(pk?.id)).map((pk) => [pk.id, pk])).values()];
  if (owned.length < minTeam) return stop('team', `A equipe precisa de pelo menos ${minTeam} Pokémon próprios válidos.`);
  const unknownPokemonIds = owned.filter((pk) => !integer(pk.speciesId) || !positive(pk.level)
    || !positive(data.ratings[pk.id])).map((pk) => pk.id);
  if (unknownPokemonIds.length) {
    return stop('checking', 'Faltam dados completos ou poder oficial de parte da coleção; a seleção será reavaliada.',
      { needsData: true, unknownPokemonIds });
  }
  const team = owned.sort((a, b) => data.ratings[b.id] - data.ratings[a.id] || b.level - a.level || a.id - b.id)
    .slice(0, Math.min(5, maxTeam));
  const pokemonIds = team.map((pk) => pk.id);
  const power = team.reduce((sum, pk) => sum + data.ratings[pk.id], 0);
  if (!positive(power)) return stop('checking', 'O cálculo total de poder ainda não é válido.', { needsData: true });
  Object.assign(facts, { pokemonIds, power });
  const saved = info.time.length === pokemonIds.length && info.time.every((id, index) => id === pokemonIds[index]);
  if (!saved) return evaluation('ready', 'Preparar equipe ranqueada',
    'Salvar a equipe independente da hunt, ordenada pelo poder oficial de arena. O poder não representa probabilidade de vitória.',
    { ...facts, ready: true, action: 'save' });
  if (recent.length >= settings.pvpAttemptsPerDay) {
    return stop('daily-limit', 'Limite de entradas na fila nas últimas 24 horas atingido.');
  }
  const restUntil = lossStreak >= settings.pvpLossStreak ? results[0]?.at + settings.pvpRestMinutes * minute : 0;
  if (restUntil > now) {
    return stop('loss-streak', `Sequência de ${lossStreak} derrotas confirmadas; descansar ${settings.pvpRestMinutes} minutos após o último resultado.`,
      { retryAt: restUntil });
  }
  if (info.cooldownUntil > now) {
    return stop('cooldown', 'Aguardando o cooldown de entrada informado pelo servidor.',
      { cooldownMs: info.cooldownUntil - now, retryAt: info.cooldownUntil });
  }
  return evaluation('ready', 'Entrar na fila ranqueada',
    'Equipe confirmada. A fila é gratuita e permite continuar a hunt; resultados reais orientarão as próximas tentativas.',
    { ...facts, ready: true, action: 'queue' });
}
