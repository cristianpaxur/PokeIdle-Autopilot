const groups = [
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
];
const fields = groups.flatMap((group) => group.fields);
const activityDefaults = {
  autoGyms: true, gymMinAdvantagePercent: 25, gymAttemptsPerDay: 2,
  autoBosses: true, bossTeamLevelPercent: 120, bossTokenReserve: 1,
  bossAttemptsPerDay: 2, bossMaxMinutes: 10, activitiesDuringXpEvents: false,
};

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const number = (value) => Number.isFinite(value) ? integer.format(value) : '—';
const clock = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const at = (epoch, prefix = '') => Number.isFinite(epoch) ? ` · ${prefix}${clock.format(epoch)}` : '';
const states = new WeakMap();
const typeNames = {
  NORMAL: 'Normal', FIRE: 'Fogo', WATER: 'Água', ELECTRIC: 'Elétrico', GRASS: 'Planta', ICE: 'Gelo',
  FIGHTING: 'Lutador', POISON: 'Veneno', GROUND: 'Terrestre', FLYING: 'Voador', PSYCHIC: 'Psíquico',
  BUG: 'Inseto', ROCK: 'Pedra', GHOST: 'Fantasma', DRAGON: 'Dragão', DARK: 'Sombrio', STEEL: 'Aço', FAIRY: 'Fada',
};
const stages = {
  disarming: 'Desativando repetição automática', entering: 'Entrando no boss', fighting: 'Em combate',
  saving: 'Registrando equipe', challenging: 'Desafiando ginásio', reconciling: 'Verificando resultado',
  returning: 'Retornando à caça', registered: 'Equipe registrada',
};
const activityResults = {
  win: 'Vitória', loss: 'Derrota', registered: 'Equipe registrada', uncertain: 'Resultado incerto',
  rejected: 'Tentativa recusada', timeout: 'Tempo esgotado', cancelled: 'Cancelada',
};
const actionStatuses = {
  confirmed: 'Confirmada', pending: 'Pendente', uncertain: 'Resultado incerto',
  failed: 'Falhou', sent: 'Enviada',
};
const lookup = (labels, key, fallback = '') => typeof labels[key] === 'string' ? labels[key] : fallback;
const activityKind = (kind) => kind === 'gym' ? 'Ginásio' : kind === 'boss' ? 'Boss' : 'Atividade';
const targetName = (target) => typeof target === 'string'
  ? lookup(typeNames, target.toUpperCase(), target.replaceAll('_', ' ').replaceAll('-', ' ').replace(/^./u, (letter) => letter.toUpperCase()))
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
  const plural = kind === 'gym' ? 'ginásios' : 'bosses';
  const section = activitySection(container, `Avaliação de ${plural}`, kind === 'gym' ? 'Ginásios' : 'Bosses');
  const title = document.createElement('strong');
  title.textContent = assessment?.title || 'Aguardando avaliação';
  const reason = document.createElement('p');
  reason.textContent = assessment?.reason || `Ainda não há dados suficientes para avaliar ${plural}.`;
  section.append(title, reason);
  if (!assessment) return;
  const facts = document.createElement('ul');
  facts.className = 'planner-activity-facts';
  const target = targetName(assessment.target);
  if (target) line(facts, 'Alvo', target);
  if (Number.isFinite(assessment.powerRatio)) line(facts, 'Comparação de força', `${number(assessment.powerRatio)}× a força defensora`);
  if (Number.isFinite(assessment.bonusBefore) || Number.isFinite(assessment.bonusAfter)) {
    line(facts, 'Bônus de dano do principal', `${number(assessment.bonusBefore)}% → ${number(assessment.bonusAfter)}%`);
  }
  if (Number.isFinite(assessment.tokens) || Number.isFinite(assessment.cost)) {
    const stock = Number.isFinite(assessment.tokens) ? `${number(assessment.tokens)} ${assessment.tokens === 1 ? 'disponível' : 'disponíveis'}` : '';
    const cost = Number.isFinite(assessment.cost) ? `custo de ${number(assessment.cost)} por tentativa` : '';
    line(facts, 'Fichas de boss', [stock, cost].filter(Boolean).join(' · '));
  }
  if (Number.isFinite(assessment.attempts) || Number.isFinite(assessment.limit)) {
    line(facts, 'Tentativas nas últimas 24 h', `${number(assessment.attempts)} de ${number(assessment.limit)}`);
  }
  if (facts.childElementCount) section.append(facts);
}

function renderActivities(container, activities) {
  container.replaceChildren();
  renderAssessment(container, 'gym', activities?.gym);
  renderAssessment(container, 'boss', activities?.boss);
  if (activities?.active) {
    const { kind, target, stage, at: started } = activities.active;
    const section = activitySection(container, 'Tentativa em andamento');
    const detail = document.createElement('p');
    detail.textContent = [activityKind(kind), targetName(target), lookup(stages, stage, 'Aguardando confirmação')]
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
    if (input.type === 'checkbox') input.checked = value === true;
    else input.value = value ?? '';
  }
}

function readInputs(form) {
  return Object.fromEntries(fields.map(([name, label, min, max]) => {
    const input = form.elements.namedItem(name);
    if (input.type === 'checkbox') return [name, input.checked];
    if (input.validity.badInput || input.value === '' || !input.validity.valid) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      throw new Error(`${label}: informe um número inteiro de ${number(min)} a ${number(max)}.`);
    }
    return [name, Number(input.value)];
  }));
}

export function attachPlanner(anchor, id) {
  anchor.innerHTML = `<p class="planner-decision"><strong></strong><span></span></p>
    <details>
      <summary>Planejador</summary>
      <ul class="planner-facts"></ul>
      <div class="planner-activities"></div>
      <form novalidate>
        <fieldset class="planner-preferences">
          <legend>Preferências da conta</legend>
          <div class="planner-groups"></div>
          <p>Os limites de tentativas contam as últimas 24 horas, em uma janela móvel.</p>
          <button class="primary" type="submit">Salvar preferências</button>
        </fieldset>
        <p class="planner-feedback" role="status"></p>
      </form>
    </details>`;
  const form = anchor.querySelector('form');
  const fieldset = form.querySelector('fieldset');
  const feedback = form.querySelector('[role="status"]');
  const state = { form, fieldset, snapshotSettings: null, dirty: false, saving: false, locked: false };
  states.set(anchor, state);
  for (const group of groups) {
    const section = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = group.title;
    const inputs = document.createElement('div');
    inputs.className = 'planner-fields';
    section.append(legend, inputs);
    for (const [name, title, min, max] of group.fields) {
      const label = document.createElement('label');
      const input = document.createElement(name === 'hpThreshold' ? 'select' : 'input');
      input.name = name;
      if (name === 'hpThreshold') {
        for (let percent = 10; percent <= 90; percent += 10) input.add(new Option(`${percent}%`, percent));
      } else if (min === undefined) {
        input.type = 'checkbox';
        label.className = 'planner-toggle';
      } else {
        input.type = 'number';
        input.min = min;
        input.max = max;
        input.step = 1;
        input.required = true;
      }
      const caption = document.createElement('span');
      caption.textContent = title;
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
    state.dirty = true;
    event.target.removeAttribute('aria-invalid');
    feedback.textContent = '';
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
}

export function renderPlanner(anchor, profile) {
  const state = states.get(anchor);
  const planner = profile.planner;
  anchor.hidden = !planner;
  state.locked = !planner || ['manual', 'pausing'].includes(profile.control);
  state.fieldset.disabled = state.locked || state.saving;
  if (!planner) return;
  const decision = planner.decision;
  const manual = profile.control === 'manual';
  const changing = profile.control === 'pausing';
  const paused = profile.paused || profile.status === 'paused';
  const suspended = manual || changing || paused || !profile.active;
  anchor.querySelector('.planner-decision strong').textContent = suspended
    ? 'Planejador em pausa'
    : decision?.title ?? 'Planejador aguardando';
  const pauseReason = manual ? 'Controle manual ativo.' : changing ? 'A pausa está em andamento.'
    : paused ? 'Retome a conta para continuar.' : 'Abra a conta para continuar.';
  anchor.querySelector('.planner-decision span').textContent = suspended
    ? pauseReason
    : `${decision?.reason ?? ''}${at(decision?.until, 'até ')}`;
  renderDetails(anchor.querySelector('.planner-facts'), planner);
  renderActivities(anchor.querySelector('.planner-activities'), planner.activities);
  // Other card controls can rerender the last snapshot after a successful save.
  const snapshotSettings = JSON.stringify(fields.map(([name]) => planner.settings?.[name]));
  if (snapshotSettings !== state.snapshotSettings && !state.dirty && !state.saving) {
    renderInputs(state, planner.settings);
  }
  state.snapshotSettings = snapshotSettings;
}
