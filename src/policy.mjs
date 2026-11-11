const ownNick = (name) => String(name ?? '').trim().toLowerCase();
const positive = (value) => Number.isSafeInteger(value) && value > 0;

export const OUTLAND_LEVEL = 150;
export const farmPhase = (mode, level) => mode === 'shiny' ? 'shiny'
  : level >= OUTLAND_LEVEL ? 'outland' : 'progression';
export const isOutland = (hunt) => hunt?.regiao === 'outland';
export const hasShiny = (hunt, looks) => hunt?.especies?.some(({ pokeId }) => looks[pokeId] != null);

export function pickFarmHunt(phase, candidates, samples, current) {
  const minimum = phase === 'outland' ? 20 * 60_000 : 6 * 60_000;
  const product = phase === 'outland' ? 'drops' : 'encounters';
  const data = new Map(samples.map((row) => [row.slug, row]));
  const options = phase === 'outland' ? [...candidates].sort((a, b) => b.nivel - a.nivel) : candidates;
  const currentHunt = options.find(({ slug }) => slug === current);
  if (currentHunt && (data.get(current)?.huntMs ?? 0) < minimum) return currentHunt;
  const bestUnmeasured = options.find(({ slug }) => (data.get(slug)?.huntMs ?? 0) < minimum);
  const ranked = options.filter(({ slug }) => (data.get(slug)?.huntMs ?? 0) >= minimum)
    .map((hunt) => {
      const row = data.get(hunt.slug);
      const hours = row.huntMs / 3_600_000;
      const yieldRate = (row[product] ?? 0) / hours;
      const penalty = 1 + (row.faints ?? 0) / hours + (row.supplyGold ?? 0) / hours / 10_000;
      return { hunt, score: yieldRate / penalty };
    }).sort((a, b) => b.score - a.score);
  if (phase === 'outland' && bestUnmeasured && bestUnmeasured.nivel >= (currentHunt?.nivel ?? 0)) return bestUnmeasured;
  if (phase === 'shiny' && bestUnmeasured && ranked.length < 3) return bestUnmeasured;
  const best = ranked[0];
  const baseline = ranked.find(({ hunt }) => hunt.slug === current);
  return baseline && baseline.score >= (best?.score ?? 0) * 0.9
    ? currentHunt : best?.hunt ?? bestUnmeasured ?? options[0];
}

export function listingDecision(quote, minimum) {
  if (!quote) return { code: 'comparables', text: 'Aguardando pelo menos três vendas comparáveis.' };
  if (quote.gems < minimum || !quote.net) {
    return { code: 'below-floor', text: `Preço de referência abaixo do mínimo de ${minimum} Gemas.` };
  }
  return { code: 'ready', text: 'Cotação disponível.' };
}

export function itemQuantity(sale) {
  if (sale.qtd != null) return Number(sale.qtd);
  const description = String(sale.descricao ?? '');
  const lot = description.match(/^\s*([\d.,]+)\s*[x×]\s+/i) ?? description.match(/\s+[x×]\s*([\d.,]+)\s*$/i);
  return lot ? Number(lot[1].replace(/[.,]/g, '')) : 1;
}

export function identifyItemSale(sale, catalog) {
  if (sale.tipo !== 'item' || positive(Number(sale.itemId))) return sale;
  const name = String(sale.descricao ?? '').replace(/^\s*[\d.,]+\s*[x×]\s+/i, '')
    .replace(/\s+[x×]\s*[\d.,]+\s*$/i, '').trim().toLowerCase();
  const matches = new Set(catalog.filter((item) => positive(Number(item.id))
    && [item.name, item.nome].some((label) => label && label.trim().toLowerCase() === name))
    .map(({ id }) => Number(id)));
  return matches.size === 1 ? { ...sale, itemId: [...matches][0] } : sale;
}

export function nextHunt(hunts, player, {
  pinned, ready, blocked = new Set(), lastHunt, phase, shinyLooks = {},
  species = {}, typeChart = {}, attackTypes = [],
  select,
} = {}) {
  if (player.boss?.arena || player.mistico || player.safari?.dentro || player.casa?.dentro) return null;
  const effectiveness = (hunt) => {
    const spawns = hunt.especies ?? [];
    const total = spawns.reduce((sum, entry) => sum + (entry.pontos ?? 1), 0);
    if (!total || !attackTypes.length) return 1;
    return spawns.reduce((sum, entry) => {
      const targets = species[entry.pokeId]?.types ?? [];
      const matchup = Math.max(...attackTypes.map((type) => targets.reduce(
        (multiplier, target) => multiplier * (typeChart[type]?.[target] ?? 1), 1)));
      return sum + matchup * (entry.pontos ?? 1);
    }, 0) / total;
  };
  const unlocked = hunts.filter((hunt) => hunt.slug && Number.isFinite(hunt.nivel) && hunt.nivel <= player.level)
    .filter((hunt) => !phase || (phase === 'outland' ? isOutland(hunt)
      : !isOutland(hunt) && (phase !== 'shiny' || hasShiny(hunt, shinyLooks))))
    .sort((a, b) => a.nivel - b.nivel || effectiveness(b) - effectiveness(a));
  const current = unlocked.find(({ slug }) => slug === (player.huntSlug || lastHunt));
  const safe = unlocked.filter(({ slug }) => !blocked.has(slug));
  const fixed = safe.find(({ slug }) => slug === pinned);
  const advantageous = phase === 'progression' ? safe.filter((hunt) => effectiveness(hunt) > 1) : [];
  const preferred = advantageous.length ? advantageous : safe;
  let chosen;
  if (fixed) chosen = fixed;
  else if (select) chosen = select(preferred);
  else if (!current) chosen = preferred[0];
  else if (!preferred.some(({ slug }) => slug === current.slug)) {
    chosen = preferred.filter(({ nivel }) => nivel <= current.nivel)
      .sort((a, b) => b.nivel - a.nivel || effectiveness(b) - effectiveness(a))[0] ?? preferred[0];
  } else {
    const advance = !phase || phase === 'progression';
    const better = preferred.find((hunt) => hunt.nivel === current.nivel && effectiveness(hunt) > effectiveness(current));
    chosen = better || (advance && ready && !player.noCentro && preferred.find(({ nivel }) => nivel > current.nivel)) || current;
  }
  return chosen && (chosen.slug !== player.huntSlug || player.noCentro) ? chosen : null;
}

export function quoteItem(itemId, sales, ownAccounts) {
  const own = new Set(ownAccounts.map(ownNick));
  const samples = new Map();
  for (const sale of sales) {
    if (sale.tipo !== 'item' || sale.moeda !== 'orb' || Number(sale.itemId) !== itemId
      || own.has(ownNick(sale.vendedor)) || own.has(ownNick(sale.comprador))) continue;
    const id = sale.id ?? (sale.em && sale.comprador && sale.vendedor
      ? JSON.stringify([sale.em, sale.vendedor, sale.comprador, sale.bruto, sale.qtd]) : null);
    const quantity = itemQuantity(sale);
    if (id != null && positive(quantity) && positive(Number(sale.bruto))) {
      samples.set(String(id), Number(sale.bruto) / quantity);
    }
  }
  return medianQuote(samples, 3);
}

function medianQuote(samples, minimum) {
  const values = [...samples.values()].sort((a, b) => a - b);
  if (values.length < minimum) return null;
  const lower = values[Math.floor((values.length - 1) / 2)];
  const upper = values[Math.floor(values.length / 2)];
  return { gems: Math.round((lower + upper) / 2), samples: values.length };
}

export function quote(capture, sales, ownAccounts, minSamples = 3) {
  if (!capture.speciesId || !capture.power || !capture.level) return null;
  const own = new Set(ownAccounts.map(ownNick));
  const comparable = new Map();
  for (const sale of sales) {
    const { ficha, bruto } = sale;
    const id = sale.id ?? sale.anuncioId ?? (sale.em && sale.pokemonId ? `${sale.em}:${sale.pokemonId}` : null);
    if (sale.tipo !== 'pokemon' || sale.moeda !== 'orb' || !ficha || id == null) continue;
    if (own.has(ownNick(sale.vendedor)) || own.has(ownNick(sale.comprador))) continue;
    if (Number(ficha.speciesId) !== capture.speciesId || Boolean(ficha.shiny) !== capture.shiny) continue;
    if (Number(ficha.potencia) !== capture.power || !Number.isFinite(ficha.level)
      || Math.abs(ficha.level - capture.level) > 25) continue;
    if (capture.quality != null && (!Number.isFinite(ficha.quality) || Math.abs(ficha.quality - capture.quality) > 0.12)) continue;
    if (capture.iv != null) {
      const iv = Object.values(ficha.ivs ?? {}).reduce((sum, value) => sum + value, 0);
      if (!ficha.ivs || !Number.isFinite(iv) || Math.abs(iv - capture.iv) > 25) continue;
    }
    if (Number.isSafeInteger(bruto) && bruto > 0) comparable.set(id, bruto);
  }
  return medianQuote(comparable, minSamples);
}

export function withdrawalAmount(panel, config) {
  if (!config.enabled || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(config.wallet ?? '')) return 0;
  if (panel.saqueTravado || !Array.isArray(panel.saques)) return 0;
  if (panel.saques.some((row) => !['confirmado', 'cancelado'].includes(row.status))) return 0;
  const minimum = panel.precos?.minimo;
  if (!Number.isSafeInteger(minimum) || minimum < 1000 || !Number.isSafeInteger(panel.saldo)) return 0;
  const amount = Math.min(panel.saldo - config.reserveGems, config.maxGems, 1_000_000);
  return Number.isSafeInteger(amount) && amount >= minimum ? amount : 0;
}

export function netGems(gross) {
  const basis = Math.min(500, gross) * 1300
    + Math.min(4500, Math.max(0, gross - 500)) * 1000
    + Math.max(0, gross - 5000) * 750;
  return gross - Math.ceil(basis / 10_000);
}
