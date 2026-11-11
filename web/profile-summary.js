const integer = new Intl.NumberFormat('pt-BR');
const rate = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
export const phaseLabels = { progression: 'Progressão', outland: 'Outland', shiny: 'Shiny' };

export function watchScreenVisibility(onChange) {
  return new IntersectionObserver((entries) => {
    for (const entry of entries) onChange(Number(entry.target.dataset.screenProfile), entry.isIntersecting);
  }, { rootMargin: '120px 0px' });
}

export function progressAge(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return 'Sem atividade observada';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return 'Atividade há menos de 1 min';
  if (minutes < 60) return `Atividade há ${minutes} min`;
  return `Atividade há ${Math.floor(minutes / 60)} h`;
}

export function activityConfirmed(profile, now = Date.now()) {
  return profile.status === 'hunting' && Number.isFinite(profile.lastProgressAt)
    && now - profile.lastProgressAt < 180_000;
}

export function phaseStats(profile, period) {
  const { phase } = profile;
  const sample = profile.periods?.[period]?.[phase];
  if (!phase) return [];
  if (phase === 'progression') {
    const measured = profile.huntOptimizer?.ranking?.find(({ slug }) => slug === profile.hunt);
    const xp = measured ? `${integer.format(Math.round(measured.trainerXpPerHour))} XP treinador/h`
      : profile.huntOptimizer?.trial ? 'Medindo XP/h' : 'XP/h sem amostra';
    return [xp, ...(sample?.huntMs ? [`${rate.format(sample.huntMs / 3_600_000)} h de caça`] : [])];
  }
  if (!sample?.huntMs) return ['Sem tempo de caça medido no período'];
  const hours = sample.huntMs / 3_600_000;
  const formatRate = (value) => rate.format((value ?? 0) / hours);
  if (phase === 'outland') return [
    `${formatRate(sample.drops)} drops/h`,
    `${formatRate(sample.gems)} Gemas líquidas/h`,
    `${integer.format(sample.faints ?? 0)} desmaios`,
  ];
  return [
    `${formatRate(sample.encounters)} encontros elegíveis/h`,
    `${integer.format(sample.balls ?? 0)} bolas usadas`,
    `${integer.format(sample.supplyGold ?? 0)} ouro em suprimentos`,
    `${formatRate(sample.gems)} Gemas líquidas/h`,
  ];
}

export function renderAttention(list, profiles, name) {
  const pending = profiles.filter(({ attention }) => attention)
    .sort((a, b) => Number(b.attention.kind === 'action') - Number(a.attention.kind === 'action'));
  const items = pending.map((profile) => {
    const row = document.createElement('li');
    row.className = profile.attention.kind === 'action' ? 'requires-action' : 'recovering';
    const label = document.createElement('strong');
    label.textContent = name(profile);
    const description = document.createElement('span');
    description.textContent = profile.attention.text;
    row.append(label, description);
    return row;
  });
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'no-attention';
    empty.textContent = 'Nenhuma intervenção pendente.';
    items.push(empty);
  }
  list.replaceChildren(...items);
}
