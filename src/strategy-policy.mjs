const positive = (value) => Number.isFinite(value) && value > 0;
const id = (value) => Number.isSafeInteger(value) && value > 0;
const list = (value) => Array.isArray(value) ? value : [];
const pct = (value) => Math.round(value * 100);
const row = (id, title, status, reason, extra = {}) => ({ id, title, status, reason, ...extra });
const ready = (id, title, reason, priority, command, expected) =>
  row(id, title, 'ready', reason, { priority, command, expected });
const disabled = (id, title) => row(id, title, 'disabled', 'Automação desativada nas preferências da conta.');
const unknown = (id, title) => row(id, title, 'observing', 'Aguardando dados atuais do jogo para avaliar.');
const team = (state) => [...state.pokemon.values()].filter((pk) => Number.isInteger(pk.slot) && pk.slot >= 0 && pk.slot < 5);
const houses = (state) => list(state.player?.casa?.lista);
const assigned = (state) => new Set(houses(state).flatMap((house) => list(house.postos)).filter(id));
const healthy = (pk) => positive(pk?.maxHp) && pk.hp / pk.maxHp >= 0.8;

function passOpportunity({ state, settings, rules }) {
  const title = 'Recompensa do Passe';
  if (!settings.autoRewards) return disabled('pass', title);
  const pass = rules?.pass;
  if (!id(pass?.nivelMin) || !Number.isSafeInteger(pass?.day)
    || typeof pass.jaPegouHoje !== 'boolean' || typeof pass.vipPendenteHoje !== 'boolean') return unknown('pass', title);
  if (!(state.player?.level >= pass.nivelMin)) return row('pass', title, 'locked', `Disponível no nível ${pass.nivelMin}.`);
  if (pass.jaPegouHoje && !pass.vipPendenteHoje) return row('pass', title, 'complete', 'Recompensa de hoje já recebida.');
  return ready('pass', title, `Resgatar o dia ${pass.degrau} da trilha disponível, sem compra.`, 100,
    { t: 'passe.resgatar' }, { kind: 'pass', day: pass.day, vip: pass.jaPegouHoje, step: pass.degrau });
}

function bikeOpportunity({ state, settings, now }) {
  const title = 'Melhorar a bicicleta';
  if (!settings.autoEquipment) return disabled('bike', title);
  const info = state.player?.bicicleta;
  const catalog = state.bicycles?.raridades;
  if (!Array.isArray(info?.lista) || !Array.isArray(catalog)) return unknown('bike', title);
  const speed = (rar) => catalog.find((entry) => entry.id === rar)?.velocidade;
  const current = info.equipada ? speed(info.equipadaRar) : 0;
  if (!Number.isFinite(current)) return unknown('bike', title);
  const best = info.lista.filter((bike) => id(bike.id) && !bike.anunciada && positive(speed(bike.rar)))
    .sort((a, b) => speed(b.rar) - speed(a.rar) || a.id - b.id)[0];
  if (!best || speed(best.rar) <= current) return row('bike', title, 'complete',
    best ? 'A melhor bicicleta disponível já está equipada.' : 'Ainda não há bicicleta própria disponível.');
  if (!Number.isFinite(info.trocaLiberaEm)) return unknown('bike', title);
  if (info.trocaLiberaEm > now) return row('bike', title, 'waiting', 'Aguardando o intervalo de troca do jogo.', { until: info.trocaLiberaEm });
  return ready('bike', title, `Velocidade de movimento: +${pct(current)}% → +${pct(speed(best.rar))}%.`, 90,
    { t: 'bicicleta.equipar', bicicletaId: best.id }, { kind: 'bike', id: best.id });
}

function houseOpportunity({ state, settings }) {
  const title = 'Ativar casa disponível';
  if (!settings.autoEquipment) return disabled('house', title);
  const info = state.player?.casa;
  const catalog = state.houses?.raridades;
  const max = info?.maxEmUso ?? state.houses?.maxEmUso;
  if (!Array.isArray(info?.lista) || !Array.isArray(catalog) || !id(max)) return unknown('house', title);
  const meta = (house) => catalog.find((entry) => entry.id === house.rar);
  const owned = info.lista.filter((house) => id(house.id) && !house.anunciada);
  const active = owned.filter((house) => house.emUso !== false);
  const best = owned.filter((house) => house.emUso === false && positive(meta(house)?.xpShare) && id(meta(house)?.bonecos))
    .sort((a, b) => meta(b).xpShare * meta(b).bonecos - meta(a).xpShare * meta(a).bonecos || a.id - b.id)[0];
  if (!best) return row('house', title, 'complete', owned.length ? `${active.length} casa(s) em uso.` : 'Ainda não há casa própria disponível.');
  if (active.length >= max) return row('house', title, 'waiting', `Limite de ${max} casas em uso. Os ocupantes atuais serão mantidos.`);
  return ready('house', title, `Liberar ${meta(best).bonecos} posto(s) com ${pct(meta(best).xpShare)}% de XP compartilhado.`, 80,
    { t: 'casa.usar', casaId: best.id, usar: true }, { kind: 'house', id: best.id });
}

function reservesToTrain({ state, primary, rules }) {
  const used = assigned(state);
  return team(state).filter((pk) => id(pk.id) && pk.id !== state.player?.activeId && pk.id !== primary?.id
    && !used.has(pk.id) && rules?.ratings?.[pk.id]?.usable === true)
    .sort((a, b) => a.level - b.level || a.id - b.id);
}

function houseXpOpportunity(input) {
  const { state, settings } = input;
  const title = 'Treinar reservas na casa';
  if (!settings.autoXpShare) return disabled('house-xp', title);
  if (!Array.isArray(state.player?.casa?.lista) || !Array.isArray(state.houses?.raridades)
    || !id(state.xpShareHeld?.itemId) || !input.rules?.ratings) return unknown('house-xp', title);
  const candidates = reservesToTrain(input).filter((pk) => pk.heldItemId !== state.xpShareHeld.itemId);
  const available = houses(state).filter((house) => id(house.id) && !house.anunciada && house.emUso !== false)
    .map((house) => ({ house, meta: state.houses.raridades.find((rarity) => rarity.id === house.rar) }))
    .filter(({ house, meta }) => positive(meta?.xpShare) && id(meta?.bonecos)
      && Array.isArray(house.postos) && house.postos.length === meta.bonecos)
    .sort((a, b) => b.meta.xpShare - a.meta.xpShare || a.house.id - b.house.id);
  for (const { house, meta } of available) {
    const slot = house.postos.findIndex((occupant) => occupant === null);
    if (slot < 0 || !candidates.length) continue;
    const pk = candidates[0];
    return ready('house-xp', title, `${pk.nome} recebe ${pct(meta.xpShare)}% do XP da caça em um posto vazio.`, 70,
      { t: 'xpshare.escolher', casaId: house.id, slot, pokemonId: pk.id },
      { kind: 'house-xp', id: house.id, slot, pokemonId: pk.id });
  }
  return row('house-xp', title, 'waiting', 'Sem posto vazio ou reserva elegível. Registros existentes são preservados.');
}

function heldXpOpportunity(input) {
  const { state, settings } = input;
  const title = 'Equipar XP Share';
  if (!settings.autoXpShare) return disabled('held-xp', title);
  const item = state.xpShareHeld;
  if (!id(item?.itemId) || !positive(item?.pct) || !input.rules?.ratings) return unknown('held-xp', title);
  if (!(state.player?.items?.[item.itemId] > 0)) return row('held-xp', title, 'waiting', 'Nenhum XP Share disponível na bolsa.');
  const pk = reservesToTrain(input).find((candidate) => candidate.heldItemId == null || candidate.heldItemId === 0);
  if (!pk) return row('held-xp', title, 'waiting', 'Sem reserva elegível com espaço de equipamento livre.');
  return ready('held-xp', title, `${pk.nome} recebe ${item.pct}% de XP com o item disponível na bolsa.`, 60,
    { t: 'xpshareheld.equipar', pokemonId: pk.id }, { kind: 'held-xp', pokemonId: pk.id, itemId: item.itemId });
}

function matchup(pk, { state, species }) {
  const attacks = pk.tipos ?? species?.[pk.speciesId]?.types;
  const spawns = state.hunts.find((hunt) => hunt.slug === state.player?.huntSlug)?.especies;
  if (!attacks?.length || !spawns?.length) return null;
  let attack = 0; let defense = 0; let total = 0;
  const effect = (type, targets) => {
    if (targets.some((target) => !Number.isFinite(state.typeChart[type]?.[target]))) return null;
    return targets.reduce((value, target) => value * state.typeChart[type][target], 1);
  };
  for (const spawn of spawns) {
    const targets = species?.[spawn.pokeId]?.types;
    const weight = spawn.pontos ?? 1;
    if (!targets?.length || !positive(weight)) return null;
    const offense = attacks.map((type) => effect(type, targets));
    const incoming = targets.map((type) => effect(type, attacks));
    if ([...offense, ...incoming].some((value) => value == null || value < 0)) return null;
    attack += Math.max(...offense) * weight;
    defense += Math.max(...incoming) * weight;
    total += weight;
  }
  return { attack: attack / total, defense: defense / total };
}

function teamOpportunity(input) {
  const { state, settings, rules, primary, mode, now, lastTeamChangeAt = 0 } = input;
  const title = 'Escolher o Pokémon principal';
  if (!settings.autoTeam || mode === 'shiny') return disabled('team', title);
  if (!rules?.ratings || !primary) return unknown('team', title);
  if (lastTeamChangeAt && now < lastTeamChangeAt + settings.teamHoldMinutes * 60_000) return row('team', title, 'waiting',
    `Mantendo o principal por ${settings.teamHoldMinutes} min para medir o resultado.`, { until: lastTeamChangeAt + settings.teamHoldMinutes * 60_000 });
  const current = matchup(primary, input);
  const power = rules.ratings[primary.id]?.power;
  if (!current || !positive(power)) return unknown('team', title);
  const baseline = power * current.attack / Math.max(1, current.defense);
  const used = assigned(state);
  const choices = team(state).filter((pk) => pk.id !== primary.id && healthy(pk) && !used.has(pk.id)
    && rules.ratings[pk.id]?.usable === true && positive(rules.ratings[pk.id]?.power))
    .map((pk) => ({ pk, matchup: matchup(pk, input) }))
    .filter((choice) => choice.matchup && choice.matchup.defense <= current.defense)
    .map((choice) => ({ ...choice, score: rules.ratings[choice.pk.id].power * choice.matchup.attack / Math.max(1, choice.matchup.defense) }))
    .filter((choice) => choice.score > baseline && choice.score >= baseline * (1 + settings.teamMinGainPercent / 100))
    .sort((a, b) => b.score - a.score || a.pk.id - b.pk.id);
  const best = choices[0];
  if (!best) return row('team', title, 'complete', `Mantendo ${primary.nome}: nenhuma melhora de pelo menos ${settings.teamMinGainPercent}% no índice de força/tipos da rota.`);
  return ready('team', title, `${best.pk.nome} melhora o índice de força/tipos da rota; o ganho real será medido na caça.`, 95,
    { t: 'team.active', pokemonId: best.pk.id }, { kind: 'team', pokemonId: best.pk.id });
}

function fillOpportunity(input) {
  const { state, settings, rules, primary, mode } = input;
  const title = 'Completar a equipe';
  if (!settings.autoTeam || mode === 'shiny') return disabled('team-fill', title);
  if (!rules?.ratings || !primary) return unknown('team-fill', title);
  const current = team(state);
  if (current.length >= 5) return row('team-fill', title, 'complete', 'As cinco vagas estão ocupadas.');
  const collection = new Set(list(state.player?.automation?.pokemonTravado).map(Number));
  const used = assigned(state);
  const species = new Set(current.map((pk) => pk.speciesId));
  const candidates = [...state.pokemon.values()].filter((pk) => id(pk.id) && pk.slot == null && !pk.starter
    && !collection.has(pk.id) && !used.has(pk.id) && !pk.heldItemId && !pk.skin && !pk.anunciado
    && !species.has(pk.speciesId) && healthy(pk) && pk.level >= primary.level * 0.8
    && rules.ratings[pk.id]?.usable === true && positive(rules.ratings[pk.id]?.power))
    .sort((a, b) => rules.ratings[b.id].power - rules.ratings[a.id].power || a.id - b.id);
  const best = candidates[0];
  if (!best) return row('team-fill', title, 'waiting', 'Sem candidato utilizável no Depot com nível próximo ao principal. A Coleção é preservada.');
  const slot = [0, 1, 2, 3, 4].find((value) => !current.some((pk) => pk.slot === value));
  return ready('team-fill', title, `Adicionar ${best.nome}, nível ${best.level}, à vaga livre ${slot + 1}.`, 40,
    { t: 'team.move', pokemonId: best.id, slot }, { kind: 'team-fill', pokemonId: best.id, slot });
}

function incubateOpportunity({ state, settings, rules }) {
  const title = 'Incubar ovo disponível';
  if (!settings.autoIncubate) return disabled('incubate', title);
  const incubation = rules?.incubation;
  if (!id(incubation?.total) || !Array.isArray(incubation.ovos) || !Array.isArray(incubation.catalog)) return unknown('incubate', title);
  const slots = Array.from({ length: Math.min(6, incubation.total) }, (_, index) => index);
  const slot = slots.find((index) => !incubation.ovos.some((egg) => egg.slot === index));
  if (slot == null) return row('incubate', title, 'waiting', 'As chocadeiras disponíveis estão ocupadas; o nascimento é automático.');
  const egg = incubation.catalog.filter((egg) => ['p2', 'p3', 'p4'].includes(egg.id) && id(egg.itemId)
    && positive(egg.horas) && id(egg.potencia) && id(state.player?.items?.[egg.itemId]))
    .sort((a, b) => b.potencia - a.potencia || a.horas - b.horas)[0];
  if (!egg) return row('incubate', title, 'waiting', 'Sem Mystery Egg comum na bolsa. Ovos shiny são preservados.');
  return ready('incubate', title, `Usar um Mystery Egg P${egg.potencia} já obtido; nascimento em ${egg.horas} h, sem comprar slots.`, 55,
    { t: 'chocadeira.colocar', slot, ovo: egg.id }, { kind: 'incubate', slot, egg: egg.id, itemId: egg.itemId,
      before: state.player.items[egg.itemId], consumes: true });
}

function buildOpportunity({ state, settings }, kind) {
  const bike = kind === 'bike';
  const key = `build-${kind}`;
  const title = bike ? 'Fabricar a primeira bicicleta' : 'Fabricar a primeira casa';
  if (!settings.autoBuild) return disabled(key, title);
  const info = bike ? state.player?.bicicleta : state.player?.casa;
  const fragment = (bike ? state.bicycles : state.houses)?.fragmento;
  if (!Array.isArray(info?.lista) || !id(fragment?.itemId) || !id(fragment?.custo)) return unknown(key, title);
  if (info.lista.some((item) => id(item.id) && !item.anunciada)) return row(key, title, 'complete',
    'Recurso próprio já disponível. Os próximos fragmentos podem gerar rendimento.');
  const have = state.player?.items?.[fragment.itemId] ?? 0;
  if (have < fragment.custo) return row(key, title, 'waiting', `Guardando fragmentos: ${have}/${fragment.custo}.`);
  return ready(key, title, `Converter ${fragment.custo} fragmentos em um benefício permanente para a conta.`, 65,
    { t: bike ? 'bicicleta.fabricar' : 'casa.fabricar' }, { kind: key, ids: info.lista.map((item) => item.id),
      itemId: fragment.itemId, before: have, consumes: true });
}

export function strategyOpportunities(input) {
  return [passOpportunity, bikeOpportunity, houseOpportunity, houseXpOpportunity, heldXpOpportunity, incubateOpportunity,
    (value) => buildOpportunity(value, 'house'), (value) => buildOpportunity(value, 'bike'), teamOpportunity, fillOpportunity]
    .map((evaluate) => evaluate(input));
}

export function strategicReserves(state, settings, raidRules) {
  const amounts = new Map();
  for (const boss of settings.autoBosses ? state.bosses ?? [] : []) {
    const entry = boss.entrada;
    if (!id(entry?.itemId) || !id(entry?.qtd) || !id(boss.minNivelTreinador)) continue;
    const cost = state.player?.level >= boss.minNivelTreinador ? entry.qtd : 0;
    const previous = amounts.get(entry.itemId);
    if (!previous || cost > 0 && (!previous.cost || cost < previous.cost)) {
      amounts.set(entry.itemId, { itemId: entry.itemId, name: entry.nome ?? 'Ficha de boss', cost,
        quantity: settings.bossTokenReserve + cost, reason: cost ? 'Reserva e uma tentativa de boss acessível.' : 'Reserva de fichas para progressão.' });
    }
  }
  if (settings.autoRaids && id(raidRules?.itemId) && id(raidRules.cost)) {
    const quantity = Math.max(amounts.get(raidRules.itemId)?.quantity ?? 0, settings.raidTokenReserve + raidRules.cost);
    amounts.set(raidRules.itemId, { itemId: raidRules.itemId, name: 'Ficha de boss / raid', quantity,
      reason: 'Preservar a reserva e a inscrição da raid semanal, além da necessidade já prevista para bosses.' });
  }
  if (settings.autoBuild) {
    for (const [catalog, owned, name] of [[state.houses, state.player?.casa?.lista, 'Primeira casa'],
      [state.bicycles, state.player?.bicicleta?.lista, 'Primeira bicicleta']]) {
      const fragment = catalog?.fragmento;
      if (!Array.isArray(owned) || owned.some((item) => id(item.id) && !item.anunciada)
        || !id(fragment?.itemId) || !id(fragment?.custo)) continue;
      amounts.set(fragment.itemId, { itemId: fragment.itemId, name, quantity: fragment.custo,
        reason: 'Fragmentos reservados para obter um benefício permanente.' });
    }
  }
  return [...amounts.values()].filter((entry) => entry.quantity > 0);
}

export function strategyHorizon(state) {
  const level = state.player?.level;
  if (!Number.isFinite(level)) return [];
  const goals = [{ title: 'PvP ranqueado', level: 150, reason: 'Liberar formação e participação automática com limite de partidas e pausa por derrotas.' },
    { title: 'Outland e ginásios', level: 150, reason: 'Desbloquear farm de fragmentos e bônus de dano.' }];
  const nextBoss = [...(state.bosses ?? [])].filter((boss) => id(boss.minNivelTreinador) && boss.minNivelTreinador > level)
    .sort((a, b) => a.minNivelTreinador - b.minNivelTreinador)[0];
  if (nextBoss) goals.push({ title: nextBoss.nome ?? 'Boss', level: nextBoss.minNivelTreinador, reason: 'Também exige equipe e ficha; o nível sozinho não basta.' });
  const route = [...(state.hunts ?? [])].filter((hunt) => id(hunt.nivel) && hunt.nivel > level).sort((a, b) => a.nivel - b.nivel)[0];
  if (route) goals.push({ title: `Hunt ${route.slug.replaceAll('-', ' ')}`, level: route.nivel, reason: 'Avaliar segurança e rendimento depois do desbloqueio.' });
  return goals.filter((goal) => goal.level > level).sort((a, b) => a.level - b.level)
    .map((goal) => ({ ...goal, remaining: goal.level - level }));
}
