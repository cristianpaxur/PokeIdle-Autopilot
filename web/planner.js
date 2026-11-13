const groups = [
  {
    title: 'Autonomia',
    fields: [
      ['autoRewards', 'Resgatar recompensas disponíveis'],
      ['autoEquipment', 'Gerenciar casas e bicicleta'],
      ['autoXpShare', 'Treinar reservas com XP Share'],
      ['autoTeam', 'Gerenciar equipe e principal'],
      ['autoIncubate', 'Incubar Mystery Eggs disponíveis'],
      ['autoBuild', 'Fabricar a primeira casa e bicicleta'],
      ['teamMinGainPercent', 'Ganho mínimo para trocar principal (%)', 10, 200],
      ['teamHoldMinutes', 'Manter principal por pelo menos (min)', 5, 120],
    ],
    notes: ['Ativo por padrão: o robô equilibra progressão, equipe e rendimento. As decisões e seus resultados aparecem no Planejador.',
      'Usa ovos P2–P4 e fragmentos já obtidos. Casas ocupadas e a Coleção são preservadas. Não compra Gemas, Diamantes ou VIP.'],
  },
  {
    title: 'Suprimentos',
    fields: [
      ['autoPotions', 'Comprar e usar poções'],
      ['autoRevives', 'Comprar e usar revives'],
      ['goldReserve', 'Reserva de ouro', 0, 1_000_000_000],
      ['supplyGoldPerHour', 'Limite de ouro por hora', 0, 1_000_000_000],
      ['stockMinutes', 'Estoque desejado (min)', 2, 60],
      ['hpThreshold', 'Curar com HP de até'],
    ],
  },
  {
    title: 'Captura',
    fields: [
      ['captureMode', 'Modo de captura'],
      ['captureTargets', 'Quais espécies capturar'],
      ['captureSpeciesIds', 'Espécies para capturar'],
      ['ballMode', 'Escolha da bola'],
      ['fixedBallId', 'Bola fixa'],
      ['autoBuyBalls', 'Comprar bolas automaticamente'],
      ['captureMinChancePercent', 'Chance mínima no automático (%)', 0, 100],
      ['ballMaxGold', 'Teto de preço por bola (ouro)', 0, 1_000_000_000],
    ],
    notes: [
      'O filtro vale para os encontros da hunt atual. Somente no modo Shiny também exige que a espécie tenha uma versão shiny.',
      'O automático compara ouro por captura estimada entre bolas que atendem à chance mínima e ao teto de preço. Bolas sem preço de ouro só são usadas por escolha fixa.',
      'A bola fixa não é substituída quando acaba. A reposição usa ouro, respeitando o teto por bola, a reserva e o limite por hora dos suprimentos.',
    ],
  },
  {
    title: 'Progressão',
    fields: [
      ['autoEvolve', 'Evoluir automaticamente'],
      ['farmStones', 'Buscar pedras de evolução'],
      ['stoneMinutes', 'Tempo por busca (min)', 1, 30],
      ['prioritizeXpEvents', 'Priorizar XP durante eventos temporários'],
      ['activitiesDuringXpEvents', 'Permitir ginásios e bosses durante eventos de XP'],
    ],
    notes: [
      'Priorizar XP em eventos globais temporários adia a busca de pedras. Bônus como VIP não adiam a busca. Se a pedra já estiver na bolsa, a evolução continua disponível.',
      'As pedras são obtidas na caça. O planejador não compra pedras nem usa gemas.',
      'Ginásios e bosses podem interromper o ganho de XP. No modo Shiny, essas atividades não interrompem o objetivo. Durante eventos de XP priorizados, novas atividades aguardam, a menos que você as permita acima.',
    ],
  },
  {
    title: 'Ginásios',
    fields: [
      ['autoGyms', 'Disputar ginásios automaticamente'],
      ['gymMinAdvantagePercent', 'Margem mínima de força (%)', 0, 200],
      ['gymAttemptsPerDay', 'Tentativas de ginásio (últimas 24 h)', 0, 18],
    ],
    notes: ['Disputas PvP para melhorar o bônus de dano do Pokémon principal. A força é um indicador, não uma probabilidade de vitória.'],
  },
  {
    title: 'Bosses',
    fields: [
      ['autoBosses', 'Enfrentar bosses automaticamente'],
      ['bossTeamLevelPercent', 'Nível mínimo da equipe (% do recomendado)', 100, 300],
      ['bossTokenReserve', 'Reserva de fichas de boss', 0, 1_000_000],
      ['bossAttemptsPerDay', 'Tentativas de boss (últimas 24 h)', 0, 100],
      ['bossMaxMinutes', 'Duração máxima do boss (min)', 1, 60],
    ],
    notes: ['Uma luta por vez, usando fichas que podem ser vendidas. Os drops são incertos; o lucro líquido não é estimado.'],
  },
  {
    title: 'PvP',
    fields: [
      ['autoPvp', 'Participar do PvP automaticamente'],
      ['pvpAttemptsPerDay', 'Tentativas de PvP (últimas 24 h)', 0, 100],
      ['pvpQueueMinutes', 'Espera máxima na fila de PvP (min)', 1, 15],
      ['pvpLossStreak', 'Derrotas seguidas antes da pausa', 1, 10],
      ['pvpRestMinutes', 'Pausa após derrotas de PvP (min)', 5, 1440],
    ],
    notes: ['Ativo por padrão a partir do nível exigido pelo jogo. A fila é gratuita e usa uma equipe própria, preservando a caça. Resultados confirmados definem a pausa após derrotas.'],
  },
  {
    title: 'Safári',
    fields: [
      ['autoSafari', 'Visitar o Safári automaticamente'],
      ['safariTicketsPerDay', 'Tickets de Safári (últimas 24 h)', 0, 3],
      ['safariMinBalls', 'Estoque mínimo de bolas para o Safári', 1, 1000],
      ['safariMinTargets', 'Espécies de interesse mínimas no Safári', 1, 100],
    ],
    notes: ['Usa somente tickets já obtidos, com bolas dentro do orçamento e vagas no Depot. A visita considera lacunas da coleção e possíveis melhorias da equipe, aguardando eventos de XP priorizados.'],
  },
  {
    title: 'Raids semanais',
    fields: [
      ['autoRaids', 'Participar de raids automaticamente'],
      ['raidTokenReserve', 'Reserva de fichas de raid', 0, 1_000_000],
      ['raidMinGainPercent', 'Ganho mínimo para atualizar equipe da raid (%)', 1, 100],
    ],
    notes: ['Inscrição pessoal com fichas próprias e até cinco Pokémon pelo poder no nível atual. A inscrição preserva a caça; calendário, reserva e melhora de equipe orientam as decisões.'],
  },
];
const fields = groups.flatMap((group) => group.fields);
const activityDefaults = {
  autoRewards: true, autoEquipment: true, autoXpShare: true, autoTeam: true,
  autoIncubate: true, autoBuild: true, teamMinGainPercent: 25, teamHoldMinutes: 15,
  autoGyms: true, gymMinAdvantagePercent: 25, gymAttemptsPerDay: 2,
  autoBosses: true, bossTeamLevelPercent: 120, bossTokenReserve: 1,
  bossAttemptsPerDay: 2, bossMaxMinutes: 10, activitiesDuringXpEvents: false,
  autoPvp: true, pvpAttemptsPerDay: 12, pvpQueueMinutes: 3, pvpLossStreak: 2, pvpRestMinutes: 60,
  autoSafari: true, safariTicketsPerDay: 1, safariMinBalls: 40, safariMinTargets: 3,
  autoRaids: true, raidTokenReserve: 1, raidMinGainPercent: 10,
  captureMode: 'shiny', captureTargets: 'all', captureSpeciesIds: [], ballMode: 'economy', fixedBallId: 1,
  autoBuyBalls: true, captureMinChancePercent: .5, ballMaxGold: 10000,
};
const selections = {
  captureMode: [['off', 'Desligada'], ['shiny', 'Somente no modo Shiny'], ['all', 'Em qualquer hunt']],
  captureTargets: [['all', 'Todas as espécies elegíveis'], ['selected', 'Somente as selecionadas']],
  ballMode: [['economy', 'Automático: custo-benefício'], ['fixed', 'Usar uma bola fixa']],
};
let speciesCatalog;
function readSpeciesCatalog() {
  return speciesCatalog ??= fetch('/api/pokemon-atlas').then((r) => {
    if (!r.ok) throw new Error('Catálogo indisponível');
    return r.json();
  }).then(({ species }) => Object.entries(species ?? {}).filter(([id, row]) => Number(id) > 0 && row.name)
    .map(([id, row]) => ({ id: Number(id), name: row.name }))).catch(() => { speciesCatalog = null; return []; });
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const number = (value) => Number.isFinite(value) ? integer.format(value) : '—';
const clock = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const at = (epoch, prefix = '') => Number.isFinite(epoch) ? ` · ${prefix}${clock.format(epoch)}` : '';
const typeNames = {
  NORMAL: 'Normal', FIRE: 'Fogo', WATER: 'Água', ELECTRIC: 'Elétrico', GRASS: 'Planta', ICE: 'Gelo',
  FIGHTING: 'Lutador', POISON: 'Veneno', GROUND: 'Terrestre', FLYING: 'Voador', PSYCHIC: 'Psíquico',
  BUG: 'Inseto', ROCK: 'Pedra', GHOST: 'Fantasma', DRAGON: 'Dragão', DARK: 'Sombrio', STEEL: 'Aço', FAIRY: 'Fada',
};
const stages = {
  disarming: 'Desativando repetição automática', entering: 'Entrando no boss', fighting: 'Em combate',
  preparing: 'Preparando atividade', saving: 'Salvando equipe', joining: 'Entrando na fila', queued: 'Na fila',
  cancelling: 'Cancelando busca', registering: 'Confirmando inscrição', capturing: 'Capturando no Safári',
  challenging: 'Desafiando ginásio', reconciling: 'Verificando resultado',
  returning: 'Retornando à caça', registered: 'Equipe registrada',
};
const activityResults = {
  win: 'Vitória', loss: 'Derrota', registered: 'Equipe registrada', uncertain: 'Resultado incerto',
  rejected: 'Tentativa recusada', timeout: 'Tempo esgotado', cancelled: 'Cancelada',
  completed: 'Concluída', captured: 'Captura confirmada', team: 'Equipe atualizada',
};
const actionStatuses = {
  confirmed: 'Confirmada', pending: 'Pendente', uncertain: 'Resultado incerto',
  failed: 'Falhou', sent: 'Enviada', unverified: 'Sem efeito confirmado', rejected: 'Recusada pelo jogo',
};
const lookup = (labels, key, fallback = '') => typeof labels[key] === 'string' ? labels[key] : fallback;
const activityKinds = { gym: 'Ginásio', boss: 'Boss', pvp: 'PvP', safari: 'Safári', raid: 'Raid semanal' };
const activityKind = (kind) => lookup(activityKinds, kind, 'Atividade');
const assessmentLabels = {
  gym: ['ginásios', 'Ginásios'], boss: ['bosses', 'Bosses'], pvp: ['PvP', 'PvP'],
  safari: ['Safári', 'Safári'], raid: ['raids', 'Raid semanal'],
};
const activityActions = {
  pvp: { save: 'Salvar equipe do PvP', queue: 'Entrar na fila ranqueada' },
  safari: { enter: 'Entrar no Safári' }, raid: { register: 'Inscrever na raid semanal', team: 'Atualizar equipe da raid' },
};
const targetName = (target) => typeof target === 'string'
  ? lookup({ ranked: 'Ranqueado', safari: 'Safári' }, target,
    lookup(typeNames, target.toUpperCase(), target.replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./u, (letter) => letter.toUpperCase())))
  : '';

function duration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const seconds = Math.floor(milliseconds / 1000);
  return seconds >= 60 ? `${number(Math.floor(seconds / 60))} min ${seconds % 60} s` : `${seconds} s`;
}

function line(list, label, detail) {
  const item = document.createElement('li');
  const strong = document.createElement('strong');
  strong.textContent = label;
  item.append(strong, document.createTextNode(` · ${detail}`));
  list.append(item);
}

function activitySection(container, label, heading = label) {
  const section = document.createElement('section');
  section.className = 'planner-activity';
  section.setAttribute('aria-label', label);
  const title = document.createElement('h4');
  title.textContent = heading;
  section.append(title);
  container.append(section);
  return section;
}

function renderAssessment(container, kind, assessment) {
  const [plural, heading] = assessmentLabels[kind];
  const section = activitySection(container, `Avaliação de ${plural}`, heading);
  const title = document.createElement('strong');
  title.textContent = typeof assessment?.title === 'string' && assessment.title || 'Aguardando avaliação';
  const reason = document.createElement('p');
  reason.textContent = typeof assessment?.reason === 'string' && assessment.reason || `Ainda não há dados suficientes para avaliar ${plural}.`;
  section.append(title, reason);
  if (!assessment) return;
  const facts = document.createElement('ul');
  facts.className = 'planner-activity-facts';
  const target = targetName(assessment.target);
  if (target) line(facts, 'Alvo', target);
  const action = lookup(activityActions[kind] ?? {}, assessment.action);
  if (action) line(facts, assessment.ready ? 'Próxima ação' : 'Ação avaliada', action);
  const pokemonIds = Array.isArray(assessment.pokemonIds)
    ? assessment.pokemonIds.filter(id => Number.isSafeInteger(id) && id > 0) : [];
  if (pokemonIds.length) line(facts, 'Equipe selecionada', pokemonIds.map(id => `#${id}`).join(', '));
  if (Number.isFinite(assessment.powerRatio)) line(facts, 'Comparação de força', `${number(assessment.powerRatio)}× a força defensora`);
  if (Number.isFinite(assessment.bonusBefore) || Number.isFinite(assessment.bonusAfter)) {
    line(facts, 'Bônus de dano do principal', `${number(assessment.bonusBefore)}% → ${number(assessment.bonusAfter)}%`);
  }
  if (['boss', 'raid'].includes(kind) && (Number.isFinite(assessment.tokens) || Number.isFinite(assessment.cost) || Number.isFinite(assessment.reserve))) {
    const stock = Number.isFinite(assessment.tokens) ? `${number(assessment.tokens)} ${assessment.tokens === 1 ? 'disponível' : 'disponíveis'}` : '';
    const cost = Number.isFinite(assessment.cost) ? `custo de ${number(assessment.cost)} ${kind === 'boss' ? 'por tentativa' : 'nesta ação'}` : '';
    const reserve = Number.isFinite(assessment.reserve) ? `reserva de ${number(assessment.reserve)}` : '';
    line(facts, kind === 'boss' ? 'Fichas de boss' : 'Fichas de raid', [stock, cost, reserve].filter(Boolean).join(' · '));
  }
  if (kind === 'pvp') line(facts, 'Custo da fila', 'Gratuito');
  if (kind === 'safari') {
    if (Number.isFinite(assessment.cost)) line(facts, 'Tickets de Safári', `custo de ${number(assessment.cost)} por visita`);
    if (Number.isFinite(assessment.ticketsUsed) || Number.isFinite(assessment.limit)) {
      line(facts, 'Tickets usados nas últimas 24 h', `${number(assessment.ticketsUsed)} de ${number(assessment.limit)}`);
    }
    if (Number.isFinite(assessment.ballStock) || Number.isFinite(assessment.minBalls)) {
      line(facts, 'Bolas apropriadas', `${number(assessment.ballStock)} no estoque / mínimo de ${number(assessment.minBalls)}`);
    }
    if (Number.isFinite(assessment.depot?.free)) line(facts, 'Vagas no Depot', number(assessment.depot.free));
  } else if (Number.isFinite(assessment.attempts) || Number.isFinite(assessment.limit)) {
    line(facts, 'Tentativas nas últimas 24 h', `${number(assessment.attempts)} de ${number(assessment.limit)}`);
  }
  for (const [label, value] of [['Inscrições até', assessment.registrationDeadline], ['Equipe até', assessment.teamDeadline]]) {
    if (Number.isFinite(value)) line(facts, label, clock.format(value));
  }
  if (facts.childElementCount) section.append(facts);
}

function renderActivities(container, activities) {
  container.replaceChildren();
  renderAssessment(container, 'gym', activities?.gym);
  renderAssessment(container, 'boss', activities?.boss);
  renderAssessment(container, 'pvp', activities?.pvp);
  renderAssessment(container, 'safari', activities?.safari);
  renderAssessment(container, 'raid', activities?.raid);
  if (activities?.active) {
    const { kind, target, stage, at: started } = activities.active;
    const section = activitySection(container, 'Tentativa em andamento');
    const detail = document.createElement('p');
    const stageLabel = kind === 'safari' && stage === 'entering' ? 'Entrando no Safári'
      : lookup(stages, stage, 'Aguardando confirmação');
    detail.textContent = [activityKind(kind), targetName(target), stageLabel]
      .filter(Boolean).join(' · ') + at(started, 'desde ');
    section.append(detail);
  }
  const section = activitySection(container, 'Histórico de tentativas');
  const history = Array.isArray(activities?.history)
    ? activities.history.filter((item) => item && typeof item === 'object').slice(0, 10) : [];
  if (!history.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Nenhuma tentativa registrada.';
    section.append(empty);
    return;
  }
  const list = document.createElement('ol');
  list.className = 'planner-activity-history';
  for (const attempt of history) {
    const label = [activityKind(attempt.kind), targetName(attempt.target)].filter(Boolean).join(' · ');
    const result = lookup(activityResults, attempt.result);
    const status = lookup(actionStatuses, attempt.status);
    const detail = [...new Set([result, status]), typeof attempt.note === 'string' ? attempt.note : '', duration(attempt.durationMs)]
      .filter(Boolean).join(' · ');
    line(list, label, `${detail || 'Aguardando confirmação'}${at(attempt.at)}`);
  }
  section.append(list);
}

function renderStrategy(container, strategy) {
  container.replaceChildren();
  container.hidden = !strategy;
  if (!strategy) return;
  const heading = document.createElement('h4');
  heading.textContent = strategy.objective || 'Estratégia da conta';
  container.append(heading);
  const labels = { ready: 'Pronto para agir', complete: 'Em dia', waiting: 'Aguardando', disabled: 'Desativado',
    locked: 'Bloqueado por requisito', observing: 'Aguardando dados', supported: 'Automação disponível',
    partial: 'Automação parcial', observed: 'Mapeado; execução não integrada' };
  const opportunities = document.createElement('ul');
  for (const item of strategy.opportunities ?? []) line(opportunities, item.title,
    `${lookup(labels, item.status, 'Avaliando')} · ${item.reason || ''}${at(item.until, 'até ')}`);
  container.append(opportunities);
  if (strategy.pending) {
    const pending = document.createElement('p');
    pending.textContent = `${strategy.pending.title}: aguardando confirmação do jogo. A caça continua.${at(strategy.pending.at)}`;
    container.append(pending);
  }
  for (const [title, entries, format] of [
    ['Próximos desbloqueios', strategy.horizon, (item) => `Nível ${number(item.level)} · faltam ${number(item.remaining)} níveis. ${item.reason}`],
    ['Recursos reservados', strategy.reserves, (item) => `${number(item.quantity)} unidade(s). ${item.reason}`],
    ['Resultados recentes', strategy.history, (item) => `${lookup(actionStatuses, item.status, 'Avaliando')} · ${item.note || ''}${at(item.at)}`],
  ]) {
    if (!entries?.length) continue;
    const section = activitySection(container, title);
    const list = document.createElement('ul');
    for (const item of entries) line(list, item.title || item.name, format(item));
    section.append(list);
  }
  if (strategy.coverage?.length) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Mapa do jogo e cobertura da automação';
    const list = document.createElement('ul');
    for (const item of strategy.coverage) line(list, item.title, `${lookup(labels, item.status, 'Mapeado')} · ${item.reason}`);
    details.append(summary, list);
    container.append(details);
  }
}

function renderDetails(list, planner) {
  list.replaceChildren();
  const { supplies, spending, evolution, bonuses, lastAction } = planner;
  if (supplies?.length) {
    for (const { name, have, target, heal } of supplies) {
      line(list, name, `${number(have)} no estoque / meta de ${number(target)}${heal ? ` · cura ${number(heal)} HP` : ''}`);
    }
  } else line(list, 'Estoque', 'Nenhum suprimento planejado.');
  if (spending) line(list, 'Suprimentos', `${number(spending.used)} de ${number(spending.limit)} ouro no limite por hora · ${number(spending.available)} disponível`);
  if (evolution) {
    const stone = evolution.stoneName ? ` · ${evolution.stoneName}: ${number(evolution.have)} na bolsa` : '';
    line(list, `Evolução para ${evolution.targetName}`, `Nv ${number(evolution.level)}${stone} · ${evolution.reason || (evolution.ready ? 'Pronta' : 'Pendente')}`);
  }
  if (bonuses) {
    const { trainerMultiplier, pokemonMultiplier, sources, event, seasonal } = bonuses;
    line(list, 'Multiplicadores de XP', `${number(trainerMultiplier)}× treinador · ${number(pokemonMultiplier)}× Pokémon`);
    for (const source of sources ?? []) {
      line(list, source.name, `${number(source.trainerMultiplier)}× treinador · ${number(source.pokemonMultiplier)}× Pokémon${at(source.until, 'até ')}`);
    }
    if (event) {
      line(list, 'Evento global', `+${number(event.trainerPercent)}% XP treinador · +${number(event.pokemonPercent)}% XP Pokémon · +${number(event.farmPercent)}% farm${at(event.until, 'até ')}`);
    }
    if (seasonal) line(list, 'Dia sazonal', `${seasonal.type}${at(seasonal.until, 'até ')}`);
  }
  if (lastAction) {
    const status = {
      confirmed: 'confirmada', pending: 'pendente', uncertain: 'incerta', failed: 'falhou', sent: 'enviada',
    }[lastAction.status];
    line(list, 'Última ação', `${lastAction.note || lastAction.kind}${status ? ` · ${status}` : ''}${at(lastAction.at)}`);
  }
}

function renderInputs(state, settings) {
  if (!settings) return;
  for (const [name] of fields) {
    const input = state.form.elements.namedItem(name);
    const value = settings[name] ?? activityDefaults[name];
    if (name === 'captureSpeciesIds') renderSpecies(state, value ?? []);
    else if (name === 'fixedBallId') {
      if (![...input.options].some((option) => option.value === String(value))) input.add(new Option(`Bola ${value} · aguardando catálogo`, value));
      input.value = value;
    } else if (input.type === 'checkbox') input.checked = value === true;
    else input.value = value ?? '';
  }
  captureControls(state);
}

function renderSpecies(state, ids = [...state.form.elements.captureSpeciesIds.selectedOptions].map((o) => Number(o.value))) {
  const selected = new Set(ids);
  const search = state.speciesSearch.value.trim().toLocaleLowerCase('pt-BR');
  const catalog = new Map(state.speciesRows.map((row) => [row.id, row]));
  for (const id of ids) if (!catalog.has(id)) catalog.set(id, { id, name: `Espécie ${id} · aguardando catálogo` });
  const rows = [...catalog.values()].filter((row) => selected.has(row.id) || row.name.toLocaleLowerCase('pt-BR').includes(search))
    .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.name.localeCompare(b.name, 'pt-BR'));
  state.form.elements.captureSpeciesIds.replaceChildren(...rows.map((row) => new Option(row.name, row.id, false, selected.has(row.id))));
}

function captureControls(state) {
  const form = state.form.elements;
  const selected = form.captureTargets.value === 'selected';
  form.captureSpeciesIds.disabled = !selected;
  state.speciesSearch.disabled = !selected;
  form.fixedBallId.disabled = form.ballMode.value !== 'fixed';
  form.captureMinChancePercent.disabled = form.ballMode.value !== 'economy';
}

function renderCapture(state, capture) {
  const section = state.overview.querySelector('.planner-capture');
  const heading = document.createElement('h4');
  heading.textContent = capture?.title ?? 'Captura';
  const reason = document.createElement('p');
  reason.textContent = capture?.reason ?? 'Aguardando os dados da conta para avaliar as bolas.';
  const list = document.createElement('ul');
  for (const target of capture?.targets ?? []) {
    const row = document.createElement('li');
    const ball = target.available ?? target.preferred;
    row.textContent = `${target.name}: ${target.reason ?? ''}`;
    if (Number.isFinite(ball?.chance)) row.textContent += ` Chance: ${number(ball.chance * 100)}%.`;
    if (Number.isFinite(ball?.expectedGold)) row.textContent += ` ${number(ball.expectedGold)} ouro por captura estimada.`;
    list.append(row);
  }
  section.replaceChildren(heading, reason, list);
  if (capture?.lastAttempt) {
    const attempt = capture.lastAttempt, last = document.createElement('p');
    const label = { pending: 'Aguardando resultado', caught: 'Capturado', miss: 'Não capturou', uncertain: 'Resultado não confirmado' };
    last.textContent = `${lookup(label, attempt.status, 'Arremesso')}: ${attempt.ballName} em ${attempt.name}${at(attempt.at)}.`;
    section.append(last);
  }
  const input = state.form.elements.fixedBallId;
  const rows = capture?.balls ?? [];
  const key = JSON.stringify(rows.map(({ id, name, priceGold, purchasable }) => [id, name, priceGold, purchasable]));
  if (key !== state.ballCatalogKey && rows.length) {
    const selected = input.value || String(activityDefaults.fixedBallId);
    input.replaceChildren(...rows.map((b) => new Option(`${b.name} · ${b.purchasable ? `${number(b.priceGold)} ouro` : 'somente estoque'}`, b.id)));
    if (![...input.options].some(o => o.value === selected)) input.add(new Option(`Bola ${selected} · indisponível no catálogo`, selected));
    input.value = selected;
    state.ballCatalogKey = key;
  }
}

function readInputs(form) {
  return Object.fromEntries(fields.map(([name, label, min, max]) => {
    const input = form.elements.namedItem(name);
    if (name === 'captureSpeciesIds') return [name, [...input.selectedOptions].map((o) => Number(o.value)).sort((a, b) => a - b)];
    if (selections[name]) return [name, input.value];
    if (input.type === 'checkbox') return [name, input.checked];
    if (input.validity.badInput || input.value === '' || !input.validity.valid) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      const format = name === 'captureMinChancePercent' ? 'número com até duas casas decimais' : 'número inteiro';
      throw new Error(`${label}: informe um ${format} de ${number(min)} a ${number(max)}.`);
    }
    return [name, Number(input.value)];
  }));
}

export function attachPlanner({ overview, activities, preferences }, id) {
  overview.innerHTML = `<h3>Planejador</h3>
    <p class="planner-decision"><strong></strong><span></span></p>
    <ul class="planner-facts"></ul>
    <section class="planner-capture" role="region" aria-label="Avaliação de captura"></section>
    <section class="planner-strategy" role="region" aria-label="Estratégia da conta"></section>`;
  activities.innerHTML = '<h3>Ginásios, bosses, PvP, Safári e raids</h3><div class="planner-activities"></div>';
  preferences.innerHTML = `<h3>Preferências da conta</h3>
    <form novalidate>
      <fieldset class="planner-preferences" aria-label="Preferências da conta">
        <div class="planner-groups"></div>
        <p>Os limites de tentativas contam as últimas 24 horas, em uma janela móvel.</p>
        <button class="primary" type="submit">Salvar preferências</button>
      </fieldset>
      <p class="planner-feedback" role="status"></p>
    </form>`;
  const form = preferences.querySelector('form');
  const fieldset = form.querySelector('fieldset');
  const feedback = form.querySelector('[role="status"]');
  const state = { form, fieldset, overview, activities, snapshotSettings: null, dirty: false, saving: false, locked: false, speciesRows: [] };
  for (const group of groups) {
    const section = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = group.title;
    const inputs = document.createElement('div');
    inputs.className = 'planner-fields';
    section.append(legend, inputs);
    for (const [name, title, min, max] of group.fields) {
      const label = document.createElement('label');
      const input = document.createElement(name === 'hpThreshold' || selections[name] || ['fixedBallId', 'captureSpeciesIds'].includes(name) ? 'select' : 'input');
      input.name = name;
      if (name === 'captureSpeciesIds') {
        label.className = 'planner-species';
        input.multiple = true; input.size = 6;
        const searchLabel = document.createElement('label');
        searchLabel.className = 'planner-species';
        const searchCaption = document.createElement('span');searchCaption.textContent = 'Buscar espécie para captura';
        state.speciesSearch = document.createElement('input');state.speciesSearch.type = 'search';
        searchLabel.append(searchCaption, state.speciesSearch);inputs.append(searchLabel);
        state.speciesSearch.addEventListener('input', () => renderSpecies(state));
        input.title = 'Use Ctrl/Cmd para selecionar várias espécies no computador.';
      } else if (name === 'fixedBallId') {
        input.add(new Option('Bola 1 · aguardando catálogo', '1'));input.required = true;
      } else if (selections[name]) {
        label.className = 'planner-capture-choice';
        for (const [value, text] of selections[name]) input.add(new Option(text, value));
      } else if (name === 'hpThreshold') {
        for (let percent = 10; percent <= 90; percent += 10) input.add(new Option(`${percent}%`, percent));
      } else if (min === undefined) {
        input.type = 'checkbox';
        label.className = 'planner-toggle';
      } else {
        input.type = 'number';
        input.min = min;
        input.max = max;
        input.step = name === 'captureMinChancePercent' ? .01 : 1;
        input.required = true;
      }
      const caption = document.createElement('span');
      caption.id = `planner-${id}-${name}-label`;
      caption.textContent = title;
      input.setAttribute('aria-labelledby', caption.id);
      label.append(caption, input);
      inputs.append(label);
    }
    for (const note of group.notes ?? []) {
      const paragraph = document.createElement('p');
      paragraph.textContent = note;
      section.append(paragraph);
    }
    form.querySelector('.planner-groups').append(section);
  }
  form.addEventListener('input', (event) => {
    if (!event.target.name) return;
    state.dirty = true;
    event.target.removeAttribute('aria-invalid');
    feedback.textContent = '';
    captureControls(state);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.locked || state.saving) return;
    try {
      const settings = readInputs(form);
      state.saving = true;
      fieldset.disabled = true;
      feedback.textContent = 'Salvando preferências…';
      const result = await fetch(`/api/profiles/${id}/planner`, {
        method: 'POST',
        headers: { 'X-IdleBot': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await result.json().catch(() => null);
      if (!result.ok || !data?.settings) {
        throw new Error(data?.error ?? 'Não foi possível salvar. Tente novamente.');
      }
      state.dirty = false;
      renderInputs(state, data.settings);
      feedback.textContent = 'Preferências salvas.';
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      state.saving = false;
      fieldset.disabled = state.locked;
    }
  });
  void readSpeciesCatalog().then((rows) => { state.speciesRows = rows; renderSpecies(state); });
  return state;
}

export function renderPlanner(state, profile) {
  const planner = profile.planner;
  state.locked = !planner || ['manual', 'pausing'].includes(profile.control);
  state.fieldset.disabled = state.locked || state.saving;
  if (!planner) return;
  const decision = planner.decision;
  const manual = profile.control === 'manual';
  const changing = profile.control === 'pausing';
  const paused = profile.paused || profile.status === 'paused';
  const suspended = manual || changing || paused || !profile.active;
  state.overview.querySelector('.planner-decision strong').textContent = suspended
    ? 'Planejador em pausa'
    : decision?.title ?? 'Planejador aguardando';
  const pauseReason = manual ? 'Controle manual ativo.' : changing ? 'A pausa está em andamento.'
    : paused ? 'Retome a conta para continuar.' : 'Abra a conta para continuar.';
  state.overview.querySelector('.planner-decision span').textContent = suspended
    ? pauseReason
    : `${decision?.reason ?? ''}${at(decision?.until, 'até ')}`;
  renderDetails(state.overview.querySelector('.planner-facts'), planner);
  renderStrategy(state.overview.querySelector('.planner-strategy'), planner.strategy);
  renderCapture(state, planner.capture);
  renderActivities(state.activities.querySelector('.planner-activities'), planner.activities);
  // Other card controls can rerender the last snapshot after a successful save.
  const snapshotSettings = JSON.stringify(fields.map(([name]) => planner.settings?.[name]));
  if (snapshotSettings !== state.snapshotSettings && !state.dirty && !state.saving) {
    renderInputs(state, planner.settings);
  }
  state.snapshotSettings = snapshotSettings;
}
