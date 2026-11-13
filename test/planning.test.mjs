import { test } from 'node:test';
import assert from 'node:assert/strict';

import { plannerSettings, gameBonuses, supplyPlan, evolutionGoal, stoneRoute } from '../src/planning.mjs';

test('planner settings keep the inherited reserve and reject invalid or unknown values', () => {
  assert.equal(plannerSettings({ hpThreshold: 70 }, { goldReserve: 45 }).goldReserve, 45);
  assert.equal(plannerSettings().stockMinutes, 10);
  for (const input of [{ enabled: true }, { autoPotions: 1 }, { hpThreshold: 55 },
    { goldReserve: Number.MAX_SAFE_INTEGER + 1 }, { stoneMinutes: 31 }, { stockMinutes: '10' }]) {
    assert.throws(() => plannerSettings(input), { status: 400 });
  }
  assert.throws(() => plannerSettings({ goldReserve: 0 }, { goldReserve: -1 }), { status: 400 });
});

test('canonical bonuses expire by server time without counting the global event twice', () => {
  const player = {
    bonusXp: { tr: 3, pk: 3, partes: [
      { id: 'vip', tr: 1.2, pk: 1, ate: 200 },
      { id: 'evento', tr: 2, pk: 3, ate: 300 },
    ] },
    evento: { xpTreinadorPct: 100, xpPokemonPct: 200, farmPct: 20, terminaEm: 300 },
    diaSazonal: { tipo: 'xp', fim: 400 },
  };
  const active = gameBonuses(player, 100);
  assert.equal(active.trainerMultiplier, 3);
  assert.equal(active.pokemonMultiplier, 3);
  assert.equal(active.event.farmPercent, 20);
  assert.equal(active.context, gameBonuses(player, 199).context);
  assert.equal(gameBonuses(player, 200).trainerMultiplier, 2.5);
  assert.equal(gameBonuses(player, 300).pokemonMultiplier, 1);
  assert.equal(gameBonuses(player, 300).event, null);
  assert.deepEqual(gameBonuses(player, 399).seasonal, { type: 'xp', until: 400 });
  assert.notEqual(gameBonuses(player, 400).context, gameBonuses(player, 399).context);
});

test('global event metadata supplies multipliers when canonical totals are absent', () => {
  const player = { evento: { xpTreinadorPct: 25, xpPokemonPct: 50, terminaEm: 200 } };
  assert.equal(gameBonuses(player, 199).trainerMultiplier, 1.25);
  assert.equal(gameBonuses(player, 199).pokemonMultiplier, 1.5);
  assert.equal(gameBonuses(player, 200).trainerMultiplier, 1);
});

test('fallback uses active shop VIP and never propagates invalid XP multipliers', () => {
  assert.equal(gameBonuses({ loja: { vipAte: 200 } }, 199).trainerMultiplier, 1.5);
  assert.equal(gameBonuses({ loja: { vipAte: 200 } }, 200).trainerMultiplier, 1);
  const broken = gameBonuses({ bonusXp: { tr: NaN, pk: -3, partes: [{ id: 'guild', tr: 0, pk: Infinity }] } });
  assert.equal(broken.trainerMultiplier, 1);
  assert.equal(broken.pokemonMultiplier, 1);
});

const items = [
  { id: 1, name: 'Potion', category: 'heal', npcPrice: 20, healAmount: 20 },
  { id: 2, name: 'Max Potion', category: 'heal', npcPrice: 100, healPct: 0.5 },
  { id: 3, name: 'Revive', category: 'revive', npcPrice: 50 },
];

test('potion selection accounts for max HP and preserves usable owned potions in the configured order', () => {
  const plan = supplyPlan({ player: { gold: 5000, items: { 1: 2, 3: 3 } },
    pokemon: { maxHp: 200 }, items, phase: 'progression',
    settings: plannerSettings({ goldReserve: 0 }), rates: { heal: 2 } });
  assert.deepEqual(plan.action, { t: 'shop.buy', kind: 'item', id: 2, qty: 20 });
  assert.deepEqual(plan.automation.potionIds, [2, 1]);
  assert.equal(plan.stocks.find(({ category }) => category === 'heal').target, 20);
});

test('weak backup potions do not mask a shortage of adequate healing', () => {
  const catalog = [
    { id: 1, name: 'Potion', category: 'heal', npcPrice: 20, healAmount: 10 },
    { id: 2, name: 'Super Potion', category: 'heal', npcPrice: 100, healAmount: 400 },
  ];
  const settings = plannerSettings({ goldReserve: 0, autoRevives: false, supplyGoldPerHour: 1220 });
  const pokemon = { maxHp: 1000 };
  const initial = supplyPlan({ player: { gold: 1500, items: { 1: 100 } }, pokemon, items: catalog, settings });
  assert.deepEqual(initial.action, { t: 'shop.buy', kind: 'item', id: 2, qty: 12 });
  assert.deepEqual(initial.stocks[0], { category: 'heal', itemId: 2, name: 'Super Potion', have: 0, target: 12, heal: 400 });
  const after = supplyPlan({ player: { gold: 300, items: { 1: 100, 2: 12 } }, pokemon, items: catalog,
    settings, spentGold: 1200 });
  assert.equal(after.action, null);
  assert.equal(after.stocks[0].have, 12);
  assert.deepEqual(after.automation.potionIds, initial.automation.potionIds);
});

test('stock labels describe aggregated healing from several adequate potion types', () => {
  const catalog = [
    { id: 1, name: 'Potion A', category: 'heal', npcPrice: 90, healAmount: 30 },
    { id: 2, name: 'Potion B', category: 'heal', npcPrice: 100, healAmount: 40 },
  ];
  const settings = plannerSettings({ goldReserve: 0, autoRevives: false });
  const plan = supplyPlan({ player: { gold: 1000, items: { 1: 6, 2: 7 } },
    pokemon: { maxHp: 100 }, items: catalog, settings });
  assert.deepEqual(plan.stocks[0], { category: 'heal', itemId: null, name: 'Poções adequadas', have: 13, target: 12 });
});

test('supply purchasing falls back to affordable healing and observes the reserve and hourly limit', () => {
  const plan = supplyPlan({ player: { gold: 1050 }, pokemon: { maxHp: 200 }, items,
    settings: plannerSettings({ goldReserve: 1000, supplyGoldPerHour: 100 }), spentGold: 60 });
  assert.deepEqual(plan.action, { t: 'shop.buy', kind: 'item', id: 1, qty: 2 });
  assert.deepEqual(plan.automation.potionIds, [1]);
  assert.equal(plan.purchase.cost, 40);
});

test('a potion order is due at half the target and consumption cannot increase the target above 500', () => {
  const settings = plannerSettings({ goldReserve: 0, autoRevives: false });
  const options = { player: { gold: 50000, items: { 1: 6 } }, items, settings };
  const plan = supplyPlan(options);
  assert.equal(plan.action?.qty, 6);
  assert.equal(supplyPlan({ ...options, rates: { heal: 1000 } }).stocks[0].target, 500);
});

test('zero revives take precedence over low shiny capture stock', () => {
  const balls = [{ id: 5, name: 'Poké Ball', compravel: true, priceGold: 10 }];
  const settings = plannerSettings({ goldReserve: 0, autoPotions: false });
  const player = { gold: 5000, balls: { 5: 1, 6: 8 } };
  assert.deepEqual(supplyPlan({ player, items, balls, phase: 'shiny', settings }).action,
    { t: 'shop.buy', kind: 'item', id: 3, qty: 3 });
  const disabled = plannerSettings({ ...settings, autoRevives: false });
  const shiny = supplyPlan({ player, items, balls, phase: 'shiny', settings: disabled });
  assert.deepEqual(shiny.action, { t: 'shop.buy', kind: 'ball', id: 5, qty: 31 });
  assert.equal(shiny.automation.autoPotion, false);
  assert.equal(shiny.automation.autoRevive, false);
  assert.equal(supplyPlan({ player, items, balls, phase: 'progression', settings: disabled }).action, null);
});

const species = {
  5: { name: 'Charmeleon', types: ['FIRE'] },
  16: { name: 'Pidgey', types: ['NORMAL', 'FLYING'], evolvesTo: 17, evolveLevel: 20 },
  17: { name: 'Pidgeotto', types: ['NORMAL', 'FLYING'] },
  133: { name: 'Eevee', types: ['NORMAL'], evolvesTo: 134, evolveLevel: 20 },
  134: { name: 'Vaporeon', types: ['WATER'] },
};
const stones = { FIRE: { itemId: 103, nome: 'Fire Stone' }, FLYING: { itemId: 104, nome: 'Feather Stone' } };

test('a captured starter species can use the deterministic fallback chain', () => {
  const goal = evolutionGoal({ pokemon: { id: 1, speciesId: 4, level: 40 }, stones, items: { 103: 1 } });
  assert.equal(goal.to, 5);
  assert.equal(goal.stoneId, 103);
  assert.equal(goal.ready, true);
});

test('normal/flying birds use Feather Stones and branching or shiny evolutions are excluded', () => {
  const pokemon = { id: 1, speciesId: 16, level: 19 };
  const goal = evolutionGoal({ pokemon, species, stones, items: { 104: 1 } });
  assert.equal(goal.stoneId, 104);
  assert.equal(goal.level, 20);
  assert.equal(goal.ready, false);
  assert.equal(evolutionGoal({ pokemon: { ...pokemon, shiny: true }, species, stones }), null);
  assert.equal(evolutionGoal({ pokemon: { ...pokemon, speciesId: 133 }, species, stones }), null);
});

test('Doduo uses the stone of its primary type', () => {
  const goal = evolutionGoal({
    pokemon: { id: 1, speciesId: 84, level: 80 },
    species: { 84: { types: ['NORMAL', 'FLYING'], evolvesTo: 85, evolveLevel: 50 } },
    stones: { ...stones, NORMAL: { itemId: 105, nome: 'Sun Stone' } },
    items: { 104: 1, 105: 1 },
  });
  assert.equal(goal?.stoneId, 105);
});

const additionalBranches = [
  [25, 26, 'ELECTRIC'],
  [102, 103, 'GRASS'],
  [104, 105, 'GROUND'],
  [109, 110, 'POISON'],
  [123, 212, 'BUG'],
  [156, 157, 'FIRE'],
];
for (const [from, to, type] of additionalBranches) {
  test(`species ${from} does not evolve automatically along the atlas default branch`, () => {
    assert.equal(evolutionGoal({
      pokemon: { id: 1, speciesId: from, level: 100 },
      species: { [from]: { types: [type], evolvesTo: to, evolveLevel: 50 } },
      stones: { [type]: { itemId: 100 } },
      items: { 100: 1 },
    }), null);
  });
}

test('Smoochum needs the corrected level of 100 despite the raw atlas value of 80', () => {
  const options = {
    species: { 238: { types: ['ICE', 'PSYCHIC'], evolvesTo: 124, evolveLevel: 80 } },
    stones: { ICE: { itemId: 100 } },
    items: { 100: 1 },
  };
  assert.equal(evolutionGoal({ ...options, pokemon: { id: 1, speciesId: 238, level: 80 } })?.ready, false);
  assert.equal(evolutionGoal({ ...options, pokemon: { id: 1, speciesId: 238, level: 100 } })?.ready, true);
});

test('Porygon with a capture-cap adjusted level is omitted from the automatic scope', () => {
  assert.equal(evolutionGoal({
    pokemon: { id: 1, speciesId: 137, level: 100 },
    species: { 137: { types: ['NORMAL'], evolvesTo: 233, evolveLevel: 80 } },
    stones: { NORMAL: { itemId: 100 } },
    items: { 100: 1 },
  }), null);
});

test('stone routes hold the current eligible hunt and select by safety then spawn share after a lock', () => {
  const hunts = [
    { slug: 'higher', nivel: 11, especies: [{ pokeId: 5 }] },
    { slug: 'lower-share', nivel: 10, especies: [{ pokeId: 5 }, { pokeId: 16, pontos: 3 }] },
    { slug: 'better-share', nivel: 10, especies: [{ pokeId: 5, pontos: 3 }, { pokeId: 16 }] },
    { slug: 'outland', nivel: 1, regiao: 'outland', especies: [{ pokeId: 5 }] },
    { slug: 'fire-slug', nivel: 1, especies: [{ pokeId: 999 }] },
  ];
  const options = { hunts, pokemon: { level: 12 }, player: { level: 20, huntSlug: 'higher' },
    species, stones, goal: { stoneId: 103 } };
  assert.equal(stoneRoute(options).slug, 'higher');
  assert.equal(stoneRoute({ ...options, blocked: new Set(['higher']) }).slug, 'better-share');
  assert.equal(stoneRoute({ ...options, pokemon: { level: 9 } }), null);
});
