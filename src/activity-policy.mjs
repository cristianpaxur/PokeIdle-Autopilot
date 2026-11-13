const day = 86_400_000;
const recent = (history, kind, now) => (Array.isArray(history) ? history : []).filter((attempt) =>
  attempt?.kind === kind && Number.isFinite(attempt.at) && attempt.at > now - day && attempt.at <= now);

export function dayAttempts(history, kind, now = Date.now()) {
  return recent(history, kind, now).length;
}

const positive = (value) => Number.isFinite(value) && value > 0;
const integer = (value) => Number.isSafeInteger(value) && value > 0;
const typeName = (value) => typeof value === 'string' ? value.toUpperCase() : '';
const defaults = { autoGyms: true, gymMinAdvantagePercent: 25, gymAttemptsPerDay: 2,
  autoBosses: true, bossTeamLevelPercent: 120, bossTokenReserve: 1, bossAttemptsPerDay: 2,
  prioritizeXpEvents: true, activitiesDuringXpEvents: false };
const evaluation = (code, title, reason, facts = {}) => ({ ready: false, code, title, reason, ...facts });
const pokemonTypes = (pokemon, species) => {
  const types = pokemon?.tipos?.length ? pokemon.tipos : species?.[pokemon?.speciesId]?.types;
  return Array.isArray(types) ? [...new Set(types.map(typeName).filter(Boolean))] : [];
};
const placeBonus = (place) => ({ 1: 25, 2: 10, 3: 5 })[place] ?? 0;
const teamIds = (team) => (team?.pokemonIds ?? team?.pokemons ?? []).map((pk) => typeof pk === 'object' ? pk?.id : pk);
const sameTeam = (team, ids) => {
  const saved = teamIds(team);
  return saved.length === ids.length && ids.every((id) => saved.includes(id));
};

function commonBlock(kind, { settings, history, now, mode, bonuses }) {
  const gym = kind === 'gym';
  const title = gym ? 'Ginásios' : 'Bosses';
  const attempts = dayAttempts(history, kind, now);
  const limit = settings[gym ? 'gymAttemptsPerDay' : 'bossAttemptsPerDay'];
  const facts = { attempts, limit };
  if (!settings[gym ? 'autoGyms' : 'autoBosses']) return evaluation('disabled', title, 'Participação automática desligada.', facts);
  if (attempts >= limit) return evaluation('daily-limit', title, 'Limite de tentativas nas últimas 24 horas atingido.', facts);
  if (mode === 'shiny') return evaluation('shiny', title, 'A busca de shiny mantém a prioridade.', facts);
  const event = bonuses?.event;
  if (settings.prioritizeXpEvents && !settings.activitiesDuringXpEvents && event?.until > now
    && (event.trainerPercent > 0 || event.pokemonPercent > 0)) {
    return evaluation('xp-event', title, 'Evento de XP ativo; novas atividades aguardam o fim do evento.', facts);
  }
  return null;
}

function blockedTarget(history, kind, target, now) {
  const bad = new Set(['pending', 'uncertain', 'failed', 'lost', 'loss', 'defeat', 'rejected', 'timeout']);
  return recent(history, kind, now).some((attempt) => attempt.target === target
    && (bad.has(attempt.status) || bad.has(attempt.result) || (kind === 'gym' && attempt.action === 'challenge')));
}

function gymCandidate({ gym, panel, player, pokemon, species, info, ratings, settings, bonusBefore, history, now }) {
  const target = typeName(gym.tipo);
  const facts = { target, bonusBefore };
  const stop = (code, reason, extra = {}) => evaluation(code, 'Ginásios', reason, { ...facts, ...extra });
  if (blockedTarget(history, 'gym', target, now)) return stop('recent-attempt', 'Já houve uma tentativa pendente, incerta, rejeitada, perdida ou um desafio neste ginásio nas últimas 24 horas.');
  const leaders = new Set(info.ginasios.filter((entry) => entry.souLider).flatMap((entry) => teamIds(entry.meuTime)));
  const eligible = pokemon.filter((pk) => integer(pk?.id) && integer(pk.speciesId)
    && pokemonTypes(pk, species).includes(target) && !leaders.has(pk.id)
    && (info.pokemonEmGinasio[pk.id] == null || typeName(info.pokemonEmGinasio[pk.id]) === target));
  if (!eligible.length) return stop('team', 'Não há Pokémon disponíveis desse tipo sem retirar integrantes de outro ginásio.');
  if (eligible.some((pk) => !positive(ratings?.[pk.id]))) return stop('checking', 'Aguardando o cálculo oficial de poder dos Pokémon.', { needsRatings: true });
  const ids = new Set();
  const speciesIds = new Set();
  const team = [];
  for (const pk of [...eligible].sort((a, b) => ratings[b.id] - ratings[a.id] || a.id - b.id)) {
    if (ids.has(pk.id) || speciesIds.has(pk.speciesId)) continue;
    ids.add(pk.id);
    speciesIds.add(pk.speciesId);
    team.push(pk);
    if (team.length >= Math.min(5, integer(info.timeMax) ? info.timeMax : 5)) break;
  }
  const power = team.reduce((sum, pk) => sum + ratings[pk.id], 0);
  if (!positive(power)) return stop('checking', 'O cálculo oficial de poder ainda não é válido.', { needsRatings: true });
  Object.assign(facts, { pokemonIds: team.map((pk) => pk.id), power });
  const currentPanel = typeName(panel?.tipo) === target;
  const emptyPanel = panel?.total === 0 && Array.isArray(panel.ranking) && !panel.ranking.length && panel.meuTime == null;
  if (gym.lider === null && gym.meuTime == null && (!currentPanel || emptyPanel)) {
    return evaluation('ready', 'Registrar no ginásio', 'Ginásio vazio: o registro pode dar 25% de bônus de dano ao principal, sem desafio.',
      { ...facts, ready: true, action: 'register', leaderPower: 0, powerRatio: null, bonusAfter: 25 });
  }
  if (!currentPanel) return stop('checking', 'Aguardando o painel atual deste ginásio.', { needsPanel: true });
  const ranking = panel.ranking;
  if (!Array.isArray(ranking) || !ranking.length || !positive(ranking[0]?.poder)
    || !ranking.every((entry, index) => entry?.pos === index + 1)
    || !Number.isFinite(panel.desafioCooldownMs) || panel.desafioCooldownMs < 0) {
    return stop('checking', 'Poder do líder, ranking ou cooldown do servidor ainda indisponível.');
  }
  const leaderPower = ranking[0].poder;
  const powerRatio = power / leaderPower;
  if (!positive(powerRatio)) return stop('checking', 'A razão entre os poderes oficiais ainda não é válida.');
  Object.assign(facts, { leaderPower, powerRatio });
  const margin = 1 + settings.gymMinAdvantagePercent / 100;
  const registered = sameTeam(panel.meuTime, facts.pokemonIds);
  const canChallenge = power >= leaderPower * margin;
  if (canChallenge && registered) {
    if (panel.desafioCooldownMs > 0) return stop('cooldown', 'O servidor ainda impõe cooldown para desafiar este ginásio.', { cooldownMs: panel.desafioCooldownMs });
    return evaluation('ready', 'Desafiar o líder', `Poder oficial ${power} contra ${leaderPower}, com margem mínima de ${settings.gymMinAdvantagePercent}%. A razão de poder não é probabilidade de vitória.`,
      { ...facts, ready: true, action: 'challenge', bonusAfter: 25 });
  }
  if (registered) return stop('insufficient-power', 'O mesmo time já está registrado e não tem a margem de poder exigida para desafiar o líder.');
  const challengers = ranking.slice(1).filter((entry) => entry.playerId !== player.id);
  let podium = 0;
  for (const place of [2, 3]) {
    const opponent = challengers[place - 2];
    // A partial ranking must not turn an unknown occupied position into a free place.
    const available = !opponent && Number.isSafeInteger(panel.total) && panel.total <= ranking.length;
    if (available || (positive(opponent?.poder) && power >= opponent.poder * margin)) {
      podium = place;
      break;
    }
  }
  const bonusAfter = placeBonus(podium);
  if (bonusAfter > bonusBefore || (canChallenge && panel.desafioCooldownMs === 0)) {
    return evaluation('ready', 'Registrar time no ginásio',
      `Registrar este time pode elevar o bônus de dano de ${bonusBefore}% para ${Math.max(bonusBefore, bonusAfter)}%. ${canChallenge ? 'O poder permite avaliar um desafio depois da confirmação do registro.' : 'A margem de poder permite disputar o pódio sem desafiar o líder.'}`,
      { ...facts, ready: true, action: 'register', bonusAfter: Math.max(bonusBefore, bonusAfter),
        challengerReady: canChallenge && panel.desafioCooldownMs === 0, projectedPosition: podium || null });
  }
  return stop('no-gain', 'O time não melhora o bônus atual com a margem de poder configurada.');
}

export function gymPlan(input = {}) {
  const { player, primary, pokemon = [], species = {}, info, panel, ratings, history = [],
    now = Date.now(), mode, bonuses } = input;
  const settings = { ...defaults, ...input.settings };
  const common = commonBlock('gym', { settings, history, now, mode, bonuses });
  if (common && common.code !== 'xp-event') return common;
  const minimumLevel = Math.max(150, integer(info?.nivelMin) ? info.nivelMin : 150);
  if (!positive(player?.level)) return evaluation('checking', 'Ginásios', 'Aguardando o nível do treinador.');
  if (player.level < minimumLevel) return evaluation('level', 'Ginásios', `Requer treinador de nível ${minimumLevel}.`, { minimumLevel });
  if (common) return common;
  if (!Array.isArray(info?.ginasios) || !info.pokemonEmGinasio || typeof info.podeRegistrar !== 'boolean') {
    return evaluation('checking', 'Ginásios', 'Aguardando informações oficiais dos ginásios.');
  }
  if (!info.podeRegistrar) return evaluation('access', 'Ginásios', 'O servidor ainda não liberou o registro em ginásios.');
  const types = pokemonTypes(primary, species);
  if (!types.length) return evaluation('team', 'Ginásios', 'Os tipos do Pokémon principal ainda não estão disponíveis.');
  const gyms = info.ginasios.filter((gym) => types.includes(typeName(gym.tipo)));
  const bonusBefore = Math.max(0, ...gyms.map((gym) => {
    const overviewBonus = placeBonus(gym.souLider ? 1 : gym.meuLugar);
    if (typeName(panel?.tipo) === typeName(gym.tipo)) {
      const panelBonus = placeBonus(panel.minhaPos === 1 || panel.ranking?.[0]?.playerId === player.id ? 1 : panel.minhaPos);
      return Math.max(overviewBonus, panelBonus);
    }
    return overviewBonus;
  }));
  if (bonusBefore === 25) return evaluation('no-gain', 'Ginásios', 'O principal já recebe o bônus máximo de 25%; tipos duplos usam o maior bônus, sem soma.', { bonusBefore, bonusAfter: bonusBefore });
  if (!gyms.length) return evaluation('checking', 'Ginásios', 'Aguardando os ginásios dos tipos do principal.');
  const candidates = gyms.map((gym) => gymCandidate({ gym, panel, player, pokemon, species, info, ratings,
    settings, bonusBefore, history, now }));
  candidates.sort((a, b) => Number(b.ready) - Number(a.ready)
    || (b.bonusAfter ?? 0) - (a.bonusAfter ?? 0)
    || Number(b.code === 'checking') - Number(a.code === 'checking')
    || (b.powerRatio ?? 0) - (a.powerRatio ?? 0));
  return { ...candidates[0], attempts: dayAttempts(history, 'gym', now), limit: settings.gymAttemptsPerDay };
}

function matchup(attackTypes, defenseTypes, chart) {
  if (!attackTypes.length || !defenseTypes.length) return null;
  const values = attackTypes.map((attack) => {
    const row = defenseTypes.map((defense) => chart?.[attack]?.[defense]);
    return row.every((value) => Number.isFinite(value) && value >= 0)
      ? row.reduce((total, value) => total * value, 1) : NaN;
  });
  return values.every(Number.isFinite) ? Math.max(...values) : null;
}

function bossCandidate({ boss, player, team, primary, species, settings, history, now, typeChart }) {
  const facts = { target: boss?.key, name: boss?.nome };
  const stop = (code, reason, extra = {}) => evaluation(code, 'Bosses', reason, { ...facts, ...extra });
  const minimumLevel = integer(boss?.minNivelTreinador) ? boss.minNivelTreinador : 300;
  if (player.level < minimumLevel) return stop('level', `Requer treinador de nível ${minimumLevel}.`, { minimumLevel });
  if (!boss?.key || !integer(boss.teamLevel) || !integer(boss.equipeIdeal)
    || !integer(boss.entrada?.itemId) || !integer(boss.entrada?.qtd)) {
    return stop('checking', 'Requisitos de equipe ou custo da ficha oficial ainda indisponíveis.');
  }
  if (blockedTarget(history, 'boss', boss.key, now)) return stop('recent-attempt', 'Uma tentativa pendente, perdida, rejeitada ou incerta bloqueia este boss por 24 horas.');
  if (team.length < boss.equipeIdeal || !integer(primary?.id) || !team.some((pk) => pk.id === primary.id)
    || team.some((pk) => !integer(pk.id)) || new Set(team.map((pk) => pk.id)).size !== team.length) {
    return stop('team', `A equipe participante precisa de pelo menos ${boss.equipeIdeal} Pokémon, incluindo o principal.`, { teamSize: team.length, idealTeamSize: boss.equipeIdeal });
  }
  const requiredTeamLevel = Math.ceil(boss.teamLevel * settings.bossTeamLevelPercent / 100);
  Object.assign(facts, { teamLevel: boss.teamLevel, requiredTeamLevel, teamSize: team.length, idealTeamSize: boss.equipeIdeal });
  if (team.some((pk) => !positive(pk.level) || pk.level < requiredTeamLevel)) {
    return stop('team-level', `Cada participante precisa de nível ${requiredTeamLevel}; um Pokémon forte não compensa um membro abaixo do requisito.`);
  }
  if (team.some((pk) => !positive(pk.maxHp) || !positive(pk.hp) || pk.hp < pk.maxHp * 0.8)) {
    return stop('health', 'Todos os participantes precisam estar de pé, com HP conhecido e ao menos 80% da vida.');
  }
  const principalTypes = pokemonTypes(primary, species);
  const bossTypes = [...new Set([typeName(boss.type1), typeName(boss.type2)].filter(Boolean))];
  const offensiveMultiplier = matchup(principalTypes, bossTypes, typeChart);
  const defensiveMultiplier = matchup(bossTypes, principalTypes, typeChart);
  if (offensiveMultiplier === null || defensiveMultiplier === null) return stop('types', 'Faltam tipos ou relações oficiais da tabela de tipos para avaliar este boss.');
  Object.assign(facts, { offensiveMultiplier, defensiveMultiplier });
  if (offensiveMultiplier <= 1 || defensiveMultiplier > 1) {
    return stop('types', 'O principal precisa de vantagem ofensiva real e não pode ter desvantagem defensiva contra os tipos deste boss.');
  }
  const itemId = boss.entrada.itemId;
  const cost = boss.entrada.qtd;
  const rawTokens = player.items?.[itemId];
  const tokens = Number.isSafeInteger(rawTokens) && rawTokens >= 0 ? rawTokens : 0;
  const reserve = settings.bossTokenReserve;
  Object.assign(facts, { itemId, cost, tokens, reserve, tokensAfter: tokens - cost });
  if (tokens - cost < reserve) return stop('tokens', `A entrada custa ${cost} ${boss.entrada.nome ?? 'ficha(s)'}; é preciso preservar ${reserve} na reserva.`);
  return evaluation('ready', 'Enfrentar boss',
    `${boss.nome ?? boss.key}: entrada de ${cost} ${boss.entrada.nome ?? 'ficha(s)'}, restando ${tokens - cost} (reserva ${reserve}). Equipe e tipos atendem aos critérios; drops são incertos, sem lucro em Gemas estimado.`,
    { ...facts, ready: true, action: 'enter' });
}

export function bossPlan(input = {}) {
  const { player, pokemon = [], primary, species = {}, bosses, typeChart, history = [],
    now = Date.now(), mode, bonuses } = input;
  const settings = { ...defaults, ...input.settings };
  const common = commonBlock('boss', { settings, history, now, mode, bonuses });
  if (common && common.code !== 'xp-event') return common;
  if (!positive(player?.level)) return evaluation('checking', 'Bosses', 'Aguardando o nível do treinador.');
  const catalogAvailable = Array.isArray(bosses) && bosses.length > 0;
  const minimumLevel = catalogAvailable
    ? Math.min(...bosses.map((boss) => integer(boss?.minNivelTreinador) ? boss.minNivelTreinador : 300)) : 300;
  if (player.level < minimumLevel) {
    return evaluation('level', 'Bosses', `Requer treinador de nível ${minimumLevel}.`, { minimumLevel });
  }
  if (common) return common;
  if (!catalogAvailable) return evaluation('checking', 'Bosses', 'Aguardando o catálogo oficial de bosses e fichas.');
  const team = pokemon.filter((pk) => pk?.slot != null);
  const candidates = bosses.map((boss) => bossCandidate({ boss, player, team, primary, species, settings, history, now, typeChart }));
  candidates.sort((a, b) => Number(b.ready) - Number(a.ready)
    || Number(a.code === 'level') - Number(b.code === 'level')
    || (a.teamLevel ?? Infinity) - (b.teamLevel ?? Infinity)
    || (a.defensiveMultiplier ?? Infinity) - (b.defensiveMultiplier ?? Infinity)
    || (b.offensiveMultiplier ?? 0) - (a.offensiveMultiplier ?? 0));
  return { ...candidates[0], attempts: dayAttempts(history, 'boss', now), limit: settings.bossAttemptsPerDay };
}
