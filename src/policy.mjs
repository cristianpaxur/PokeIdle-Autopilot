const ownNick = (name) => String(name ?? '').trim().toLowerCase();

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
  const values = [...comparable.values()].sort((a, b) => a - b);
  if (values.length < minSamples) return null;
  const lower = values[Math.floor((values.length - 1) / 2)];
  const upper = values[Math.floor(values.length / 2)];
  return { gems: Math.round((lower + upper) / 2), samples: values.length };
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
