const positive = (value) => Number.isFinite(value) && value > 0;
const count = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
const percent = (value) => `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

export function captureEnabled(settings, phase) {
  return settings.captureMode === 'all' || settings.captureMode === 'shiny' && phase === 'shiny';
}

export function captureTargets({ settings, phase, hunt, shinyLooks = {} }) {
  if (!captureEnabled(settings, phase)) return [];
  const selected = new Set(settings.captureSpeciesIds);
  const seen = new Set();
  return (hunt?.especies ?? []).filter(({ pokeId, nome }) => {
    if (!Number.isSafeInteger(pokeId) || !nome || seen.has(pokeId)) return false;
    seen.add(pokeId);
    return (settings.captureMode !== 'shiny' || shinyLooks[pokeId] != null)
      && (settings.captureTargets === 'all' || selected.has(pokeId));
  }).map(({ pokeId, nome, pontos }) => ({ id: pokeId, name: nome, weight: positive(pontos) ? pontos : 1 }));
}

export function capturePlan({ settings, phase, hunt, shinyLooks, balls = [], player = {}, chances = {}, rate = 0 }) {
  const enabled = captureEnabled(settings, phase);
  const pool = captureTargets({ settings, phase, hunt, shinyLooks });
  const targetStock = Math.min(500, Math.max(40, Math.ceil(Math.max(0, rate) * settings.stockMinutes)));
  const catalog = balls.filter((b) => Number.isSafeInteger(b.id) && b.id > 0).map((b) => ({
    id: b.id, name: b.nome ?? b.name ?? `Bola ${b.id}`, priceGold: b.priceGold,
    purchasable: b.compravel === true && Number.isSafeInteger(b.priceGold) && b.priceGold > 0,
    have: count(player.balls?.[b.id]),
  }));
  const targets = pool.map((target) => {
    const candidates = catalog.map((ball) => {
      const value = chances[target.id]?.[ball.id];
      const chance = positive(value) && value <= 1 ? value : null;
      return { ...ball, chance, expectedGold: chance && ball.purchasable ? ball.priceGold / chance : null };
    });
    let preferred, available;
    if (settings.ballMode === 'fixed') {
      preferred = candidates.find(({ id }) => id === settings.fixedBallId) ?? null;
      available = preferred?.have ? preferred : null;
    } else {
      const eligible = candidates.filter((ball) => ball.purchasable && ball.priceGold <= settings.ballMaxGold
        && ball.chance != null && ball.chance * 100 + 1e-9 >= settings.captureMinChancePercent)
        .sort((a, b) => a.expectedGold - b.expectedGold || b.chance - a.chance || a.id - b.id);
      preferred = eligible[0] ?? null;
      available = eligible.find(({ have }) => have > 0) ?? null;
    }
    const chosen = available ?? preferred;
    const detail = chosen ? `${chosen.name}${chosen.chance == null ? ' · chance indisponível' : ` · chance base ${percent(chosen.chance)}`}` : null;
    const reason = !preferred ? settings.ballMode === 'fixed'
      ? 'A bola escolhida não consta no catálogo desta conta.'
      : !Object.keys(chances[target.id] ?? {}).length ? 'Aguardando os dados de chance do jogo.'
        : `Nenhuma bola de ouro atende à chance mínima de ${settings.captureMinChancePercent}% e ao teto de preço.`
      : !available ? `${detail}. Sem estoque. ${!settings.autoBuyBalls ? 'Reposição automática desligada.'
        : !preferred.purchasable ? 'Esta bola só pode ser usada do estoque; não há compra com ouro.'
          : preferred.priceGold > settings.ballMaxGold ? 'A compra excede o teto de preço por bola.' : 'Aguardando reposição da bola escolhida.'}`
        : `${detail}. ${settings.ballMode === 'fixed' ? 'Escolha fixa da conta.' : 'Menor custo por captura entre as bolas disponíveis que atendem ao mínimo.'}`;
    return { ...target, preferred, available, reason };
  });
  const byBall = new Map();
  for (const target of [...targets].sort((a, b) => b.weight - a.weight)) {
    if (target.preferred && !byBall.has(target.preferred.id)) byBall.set(target.preferred.id, target.preferred);
  }
  const stocks = [...byBall.values()].map((ball) => ({ category: 'ball', itemId: ball.id, name: ball.name,
    have: ball.have, target: targetStock }));
  const restocks = settings.autoBuyBalls ? [...byBall.values()].filter((ball) => ball.purchasable
    && ball.priceGold <= settings.ballMaxGold && ball.have <= Math.max(8, targetStock / 2)) : [];
  const ready = targets.filter(({ available }) => available).length;
  const title = !enabled ? 'Captura desativada nesta fase' : settings.ballMode === 'fixed' ? 'Bola fixa' : 'Bolas por custo-benefício';
  const reason = !enabled ? settings.captureMode === 'off' ? 'Captura automática desligada.' : 'Captura configurada somente para o modo Shiny.'
    : !pool.length ? settings.captureTargets === 'selected' ? 'Nenhuma espécie selecionada está entre os alvos elegíveis da hunt atual.' : 'A hunt atual não tem alvos elegíveis para esta configuração.'
      : ready ? `${ready} de ${targets.length} espécies com bola disponível. As chances são estimativas base do jogo, sem bônus temporários e sem garantia de captura.`
        : targets[0].reason;
  return { enabled, title, reason, targets, stocks, restocks, restock: restocks[0] ?? null };
}
