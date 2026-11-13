import { isOutland } from './policy.mjs';

const defaults = {
  autoPotions: true, autoRevives: true, goldReserve: 10000, supplyGoldPerHour: 10000,
  stockMinutes: 10, hpThreshold: 50, autoEvolve: true, farmStones: true,
  stoneMinutes: 10, prioritizeXpEvents: true,
  autoGyms: true, gymMinAdvantagePercent: 25, gymAttemptsPerDay: 2,
  autoBosses: true, bossTeamLevelPercent: 120, bossTokenReserve: 1,
  bossAttemptsPerDay: 2, bossMaxMinutes: 10, activitiesDuringXpEvents: false,
  autoRewards: true, autoEquipment: true, autoXpShare: true, autoTeam: true,
  autoIncubate: true, autoBuild: true,
  teamMinGainPercent: 25, teamHoldMinutes: 15,
  autoPvp: true, pvpAttemptsPerDay: 12, pvpQueueMinutes: 3, pvpLossStreak: 2, pvpRestMinutes: 60,
  autoSafari: true, safariTicketsPerDay: 1, safariMinBalls: 40, safariMinTargets: 3,
  autoRaids: true, raidTokenReserve: 1, raidMinGainPercent: 10,
  captureMode: 'shiny', captureTargets: 'all', captureSpeciesIds: [],
  ballMode: 'economy', fixedBallId: 1, autoBuyBalls: true, captureMinChancePercent: .5, ballMaxGold: 10000,
};
const limits = {
  goldReserve: [0, 1e9], supplyGoldPerHour: [0, 1e9], stockMinutes: [2, 60],
  hpThreshold: [10, 90, 10], stoneMinutes: [1, 30],
  gymMinAdvantagePercent: [0, 200], gymAttemptsPerDay: [0, 18],
  bossTeamLevelPercent: [100, 300], bossTokenReserve: [0, 1_000_000],
  bossAttemptsPerDay: [0, 100], bossMaxMinutes: [1, 60],
  teamMinGainPercent: [10, 200], teamHoldMinutes: [5, 120],
  pvpAttemptsPerDay: [0, 100], pvpQueueMinutes: [1, 15], pvpLossStreak: [1, 10], pvpRestMinutes: [5, 1440],
  safariTicketsPerDay: [0, 3], safariMinBalls: [1, 1000], safariMinTargets: [1, 100],
  raidTokenReserve: [0, 1_000_000], raidMinGainPercent: [1, 100],
  fixedBallId: [1, 1_000_000], captureMinChancePercent: [0, 100], ballMaxGold: [0, 1e9],
};
const choices = { captureMode: ['off', 'shiny', 'all'], captureTargets: ['all', 'selected'], ballMode: ['economy', 'fixed'] };
const badSettings = (message) => Object.assign(new Error(message), { status: 400 });

export function plannerSettings(input = {}, base = {}) {
  for (const values of [base, input]) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw badSettings('Preferências do planejador inválidas.');
    }
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(defaults, key)) throw badSettings(`Preferência desconhecida: ${key}.`);
      const range = limits[key];
      const valid = key === 'captureSpeciesIds'
        ? Array.isArray(value) && value.length <= 200 && new Set(value).size === value.length
          && value.every((id) => Number.isSafeInteger(id) && id > 0 && id <= 1_000_000)
        : key === 'captureMinChancePercent' ? Number.isFinite(value) && value >= 0 && value <= 100
          && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
        : choices[key] ? choices[key].includes(value) : range
        ? Number.isSafeInteger(value) && value >= range[0] && value <= range[1] && value % (range[2] ?? 1) === 0
        : typeof value === 'boolean';
      if (!valid) throw badSettings(`Valor inválido para ${key}.`);
    }
  }
  const result = { ...defaults, ...base, ...input };
  return { ...result, captureSpeciesIds: [...result.captureSpeciesIds].sort((a, b) => a - b) };
}

const positive = (value) => Number.isFinite(value) && value > 0;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const factor = (value) => positive(value) ? value : 1;
const expiry = (value) => positive(value) ? value : null;
const percent = (value) => Number.isFinite(value) && value > -100 ? value : 0;
const count = (value) => positiveInteger(value) ? value : 0;
const bonusNames = {
  evento: 'Evento global', vip: 'VIP', boostXp: 'Bônus de XP do treinador', boostPokexp: 'Bônus de XP Pokémon',
  twitch: 'Twitch', kick: 'Kick', atrasados: 'Bônus de recuperação', sacrificio: 'Sacrifício',
  guild: 'Guilda', guildBoost: 'Bônus da guilda', raid: 'Raid', outros: 'Outros bônus',
};

function bonusSource(id, tr, pk, until, name) {
  return { id, name: name || (Object.hasOwn(bonusNames, id) ? bonusNames[id] : id), trainerMultiplier: factor(tr),
    pokemonMultiplier: factor(pk), until: expiry(until) };
}

const product = (sources, key) => sources.reduce((total, source) => total * factor(source?.[key]), 1);

function residual(total, parts, key) {
  if (!positive(total)) return 1;
  const ratio = factor(total / product(parts, key));
  return Math.abs(ratio - 1) < 1e-4 ? 1 : ratio;
}

export function gameBonuses(player, now = Date.now()) {
  const eventState = player?.evento;
  const event = positive(eventState?.terminaEm) && eventState.terminaEm > now ? {
    trainerPercent: percent(eventState.xpTreinadorPct), pokemonPercent: percent(eventState.xpPokemonPct),
    farmPercent: percent(eventState.farmPct), until: eventState.terminaEm,
  } : null;
  const day = player?.diaSazonal;
  const seasonal = typeof day?.tipo === 'string' && day.tipo && positive(day.fim) && day.fim > now
    ? { type: day.tipo, until: day.fim } : null;
  const totals = player?.bonusXp;
  const sources = [];
  if (totals) {
    const parts = Array.isArray(totals.partes) ? totals.partes : [];
    for (const part of parts) {
      if (part && (!expiry(part.ate) || part.ate > now)) {
        sources.push(bonusSource(part.id || 'outros', part.tr, part.pk, part.ate, part.nome ?? part.name));
      }
    }
    const otherTrainer = residual(totals.tr, parts, 'tr');
    const otherPokemon = residual(totals.pk, parts, 'pk');
    if (otherTrainer !== 1 || otherPokemon !== 1) sources.push(bonusSource('outros', otherTrainer, otherPokemon));
  } else {
    if (event) sources.push(bonusSource('evento', 1 + event.trainerPercent / 100, 1 + event.pokemonPercent / 100, event.until));
    const vipUntil = player?.loja?.vipAte;
    if (positive(vipUntil) && vipUntil > now) sources.push(bonusSource('vip', 1.5, 1.5, vipUntil));
  }
  const trainerMultiplier = factor(product(sources, 'trainerMultiplier'));
  const pokemonMultiplier = factor(product(sources, 'pokemonMultiplier'));
  const ids = [...new Set([...sources.map(({ id }) => id), ...(event ? ['evento'] : [])])].sort();
  const context = JSON.stringify([trainerMultiplier, pokemonMultiplier, ids, seasonal?.type ?? null]);
  return { trainerMultiplier, pokemonMultiplier, sources, event, seasonal, context };
}

const supplyCategories = [
  { category: 'heal', floor: 12, minimum: 3, label: 'poções', flag: 'autoPotions' },
  { category: 'revive', floor: 3, minimum: 2, label: 'revives', flag: 'autoRevives' },
  { category: 'ball', floor: 40, minimum: 8, label: 'Poké Bolas' },
];

function healing(item, maxHp) {
  if (!positive(maxHp)) return undefined;
  if (positive(item.healPct) && item.healPct <= 1) return Math.max(1, Math.floor(item.healPct * maxHp));
  return positive(item.healAmount) ? Math.min(item.healAmount, maxHp) : undefined;
}

const adequateHealing = (item, maxHp) => positive(maxHp) && (item?.heal ?? 0) >= maxHp * 0.3;
const itemPrice = ({ unitPrice }) => positiveInteger(unitPrice) ? unitPrice : Infinity;

function purchaseOrder(category, maxHp, settings) {
  const cheapest = (a, b) => itemPrice(a) - itemPrice(b) || a.id - b.id;
  if (category !== 'heal' || !positive(maxHp)) return cheapest;
  const missing = maxHp * (1 - settings.hpThreshold / 100);
  return (a, b) => {
    const aUseful = adequateHealing(a, maxHp);
    const bUseful = adequateHealing(b, maxHp);
    if (aUseful !== bUseful) return aUseful ? -1 : 1;
    if (!aUseful) return cheapest(a, b);
    return itemPrice(a) / Math.min(a.heal, missing) - itemPrice(b) / Math.min(b.heal, missing) || cheapest(a, b);
  };
}

export function supplyPlan({ player, pokemon, items = [], balls = [], phase,
  settings = plannerSettings(), spentGold = 0, rates = {}, capture }) {
  const budget = Math.max(0, Math.min(count(player?.gold) - settings.goldReserve, settings.supplyGoldPerHour - count(spentGold)));
  const automation = { autoPotion: settings.autoPotions, autoRevive: settings.autoRevives,
    hpLimiar: settings.hpThreshold / 100, potionIds: [], reviveIds: [] };
  const supplies = [];
  for (const { category, floor, minimum, flag, label } of supplyCategories) {
    if (category === 'ball' && capture) {
      for (const stock of capture.stocks) {
        const ball = capture.restocks.find(({ id }) => id === stock.itemId);
        const selected = ball && ball.priceGold <= budget
          ? { id: ball.id, name: ball.name, unitPrice: ball.priceGold, have: stock.have } : null;
        supplies.push({ category, label: stock.name, stock, selected,
          purchasable: ball ? [ball] : [], restockHave: stock.have,
          low: Boolean(ball) });
      }
      continue;
    }
    if (flag ? !settings[flag] : phase !== 'shiny') continue;
    const isBall = category === 'ball';
    const maxHp = pokemon?.maxHp;
    const inventory = (isBall ? player?.balls : player?.items) ?? {};
    const catalog = isBall ? balls : items.filter((item) => item.category === category);
    const candidates = catalog.filter(({ id }) => positiveInteger(id)).map((item) => ({
      id: item.id, name: item.name ?? item.nome,
      unitPrice: isBall ? item.compravel && item.priceGold : item.npcPrice,
      have: count(inventory[item.id]), heal: category === 'heal' ? healing(item, maxHp) : undefined,
    })).sort(purchaseOrder(category, maxHp, settings));
    const purchasable = candidates.filter(({ unitPrice }) => positiveInteger(unitPrice));
    const selected = purchasable.find(({ unitPrice }) => unitPrice <= budget);
    const owned = candidates.filter(({ have }) => have > 0);
    const adequateOwned = owned.filter((item) => adequateHealing(item, maxHp));
    const buyingAdequate = adequateHealing(selected, maxHp);
    const tracksAdequate = buyingAdequate || adequateOwned.length > 0;
    const counted = tracksAdequate ? adequateOwned : owned;
    const display = (buyingAdequate ? selected : counted[0]) ?? selected ?? purchasable[0];
    const groupedHealing = category === 'heal' && counted.some(({ id }) => id !== display?.id);
    const stockItem = groupedHealing ? null : display;
    const stockLabel = tracksAdequate ? 'Poções adequadas' : label;
    const totalHave = isBall
      ? Object.values(inventory).reduce((sum, quantity) => sum + count(quantity), 0)
      : owned.reduce((sum, item) => sum + item.have, 0);
    const have = tracksAdequate ? adequateOwned.reduce((sum, item) => sum + item.have, 0) : totalHave;
    const restockHave = buyingAdequate ? have : totalHave;
    const target = Math.min(500, Math.max(floor, Math.ceil((positive(rates[category]) ? rates[category] : 0) * settings.stockMinutes)));
    if (!isBall) {
      const ids = [...new Set(candidates.filter((item) => item.have > 0 || item === selected).map(({ id }) => id))];
      automation[category === 'heal' ? 'potionIds' : 'reviveIds'] = ids;
    }
    supplies.push({ category, label, selected, purchasable, restockHave, low: restockHave <= Math.max(minimum, target / 2),
      stock: { category, itemId: stockItem?.id ?? null, name: stockItem?.name ?? stockLabel, have, target,
        ...(stockItem?.heal === undefined ? {} : { heal: stockItem.heal }) } });
  }
  const stocks = supplies.map(({ stock }) => stock);
  const low = supplies.filter((supply) => supply.low);
  const urgent = low.filter(({ category, stock }) => category !== 'ball' && stock.have === 0);
  const due = [...urgent, ...low.filter((supply) => !urgent.includes(supply))];
  const refill = due.find(({ selected }) => selected);
  if (!refill) {
    const shortage = due[0];
    const reason = shortage ? shortage.purchasable.length
      ? `Limite de ouro atingido para repor ${shortage.label}.`
      : `Sem opção de compra para repor ${shortage.label}.`
      : 'Estoque de suprimentos suficiente.';
    return { action: null, purchase: null, stocks, reason, blocked: Boolean(shortage), automation };
  }
  const { category, selected, stock, restockHave } = refill;
  const { id, name, unitPrice, have } = selected;
  const quantity = Math.min(stock.target - restockHave, Math.floor(budget / unitPrice));
  return { action: { t: 'shop.buy', kind: category === 'ball' ? 'ball' : 'item', id, qty: quantity },
    purchase: { name, unitPrice, cost: unitPrice * quantity, before: have, quantity, category },
    stocks, reason: `Reposição de ${name} (${restockHave}/${stock.target}).`, blocked: false, automation };
}

const starterEvolutions = {
  1: [2, 40, 'GRASS', 'Ivysaur'], 2: [3, 80, 'GRASS', 'Venusaur'],
  4: [5, 40, 'FIRE', 'Charmeleon'], 5: [6, 80, 'FIRE', 'Charizard'],
  7: [8, 40, 'WATER', 'Wartortle'], 8: [9, 80, 'WATER', 'Blastoise'],
};
// Kanto and Johto entries from the game's evolucoes-ramificadas.mjs.
const branching = new Set([25, 44, 61, 79, 102, 104, 109, 123, 133, 156, 236]);
const flyingStoneOverrides = new Set([16, 17, 21, 163]);
// The game applies these corrections after loading the raw species catalog.
const correctedLevels = { 172: 60, 173: 40, 174: 40, 238: 100, 239: 100, 240: 100 };
const laterGenerationTargets = new Set([57, 82, 108, 176, 190, 193, 198, 200, 203, 206, 207, 215, 217, 221, 233, 234]);
const captureCapOverrides = new Set([112, 113, 114, 125, 126, 137]);
const classicSpecies = (id) => positiveInteger(id) && id <= 251;

export function evolutionGoal({ pokemon, species = {}, stones = {}, items = {} }) {
  const from = pokemon?.speciesId;
  if (!positiveInteger(pokemon?.id) || !classicSpecies(from) || pokemon.shiny || branching.has(from)) return null;
  if (laterGenerationTargets.has(from) || captureCapOverrides.has(from)) return null;
  const current = species[from];
  const fallback = starterEvolutions[from];
  const to = current?.evolvesTo ?? fallback?.[0];
  const rawLevel = current?.evolveLevel ?? fallback?.[1];
  const level = correctedLevels[from] ?? (rawLevel === 600 ? 100 : rawLevel);
  if (!classicSpecies(to) || to === from || !positiveInteger(level) || level > 100) return null;
  const type = flyingStoneOverrides.has(from) ? 'FLYING'
    : current?.types?.[0]?.toUpperCase() ?? fallback?.[2];
  const stone = stones[type];
  if (!positiveInteger(stone?.itemId)) return null;
  const stoneId = stone.itemId;
  const stoneName = stone.nome ?? stone.name ?? type;
  const targetName = species[to]?.name ?? (to === fallback?.[0] ? fallback[3] : `Pokémon #${to}`);
  const have = count(items[stoneId]);
  const meetsLevel = pokemon.level >= level;
  const ready = meetsLevel && have > 0;
  const reason = ready ? `Pode evoluir para ${targetName}.` : !meetsLevel
    ? `Requer nível ${level} para evoluir para ${targetName}.`
    : `Falta ${stoneName} para evoluir para ${targetName}.`;
  return { pokemonId: pokemon.id, from, to, targetName, level, stoneId, stoneName, have, ready, reason };
}

function stoneShare(hunt, species, stones, stoneId) {
  let total = 0;
  let eligible = 0;
  for (const spawn of hunt.especies ?? []) {
    const weight = positive(spawn.pontos) ? spawn.pontos : 1;
    total += weight;
    if (species[spawn.pokeId]?.types?.some((type) => stones[type.toUpperCase()]?.itemId === stoneId)) {
      eligible += weight;
    }
  }
  return total ? eligible / total : 0;
}

export function stoneRoute({ hunts = [], player, pokemon, species = {}, stones = {}, goal, blocked = new Set() }) {
  if (!positiveInteger(goal?.stoneId) || !positive(player?.level) || !positive(pokemon?.level)) return null;
  const level = Math.min(player.level, pokemon.level);
  const candidates = hunts.filter((hunt) => hunt.slug && Number.isFinite(hunt.nivel) && hunt.nivel <= level
    && !isOutland(hunt) && !blocked.has(hunt.slug))
    .map((hunt) => ({ hunt, share: stoneShare(hunt, species, stones, goal.stoneId) }))
    .filter(({ share }) => share > 0);
  const current = candidates.find(({ hunt }) => hunt.slug === player.huntSlug);
  return (current ?? candidates.sort((a, b) => a.hunt.nivel - b.hunt.nivel || b.share - a.share)[0])?.hunt ?? null;
}
