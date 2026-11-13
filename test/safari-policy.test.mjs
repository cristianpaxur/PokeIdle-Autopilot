import test from 'node:test';
import assert from 'node:assert/strict';
import { safariPlan, safariTargets } from '../src/safari-policy.mjs';

const now = 1_800_000_000_000;
const day = 86_400_000;

function input() {
  const poolIds = [1, 4, 7, 25, 63, 94];
  return {
    now, history: [], settings: {},
    player: { level: 150, gold: 0, items: { 70095: 2 }, balls: { 1: 100, 2: 40, 3: 0, 5: 999 },
      teto: { maxDepot: 10 }, automation: { pokemonTravado: [14] } },
    pokemon: [
      { id: 11, speciesId: 4, level: 70, slot: 0, hp: 100, maxHp: 100 },
      { id: 12, speciesId: 25, level: 5, slot: null, hp: 100, maxHp: 100 },
      { id: 14, speciesId: 94, level: 180, slot: null, hp: 100, maxHp: 100 },
    ],
    species: { 1: { name: 'Bulbasaur' }, 4: { name: 'Charmander' }, 7: { name: 'Squirtle' },
      25: { name: 'Pikachu' }, 63: { name: 'Abra' }, 94: { name: 'Gengar' } },
    info: { ticketId: 70095, durationMs: 3_600_000, poolCount: 6 },
    data: { poolIds, poolComplete: true,
      captureLevels: { 1: 40, 4: 30, 7: 80, 25: 100, 63: 200, 94: 200 },
      eligibleLevels: { 1: 35, 4: 25, 7: 75, 25: 95, 63: 195, 94: 195 },
      balls: [
        { id: 1, nome: 'Poké Ball', compravel: true, priceGold: 10 },
        { id: 2, nome: 'Great Ball', compravel: true, priceGold: 50 },
        { id: 3, nome: 'Ultra Ball', compravel: true, priceGold: 120 },
        { id: 5, nome: 'Master Ball', compravel: false },
      ],
      chances: Object.fromEntries(poolIds.map(id => [id, { 1: .001, 2: .1, 3: .2, 5: 1 }])),
    },
  };
}

test('safari spends one owned ticket only after known targets, stock and depot space are available', () => {
  const i = input();
  const before = structuredClone(i);
  const plan = safariPlan(i);
  assert.equal(plan.ready, true);
  assert.equal(plan.kind, 'safari');
  assert.equal(plan.action, 'enter');
  assert.equal(plan.target, 'safari');
  assert.equal(plan.itemId, 70095);
  assert.equal(plan.cost, 1);
  assert.equal(plan.tickets, 1);
  assert.equal(plan.durationMs, 3_600_000);
  assert.ok(plan.priority < 40);
  assert.equal(plan.ballStock, 40);
  assert.equal(plan.depot.used, 1);
  assert.equal(plan.depot.free, 9);
  assert.equal(plan.restock, undefined);
  assert.equal(plan.command, undefined);
  assert.deepEqual(i, before);
});

test('safari disabled and zero daily allowance cannot spend inventory', () => {
  for (const [settings, code] of [[{ autoSafari: false }, 'disabled'], [{ safariTicketsPerDay: 0 }, 'daily-limit']]) {
    const plan = safariPlan({ ...input(), settings });
    assert.equal(plan.ready, false);
    assert.equal(plan.code, code);
  }
});

test('safari waits for a temporal XP event only when XP events have priority', () => {
  const i = input();
  i.bonuses = { event: { trainerPercent: 100, until: now + 1_000 } };
  assert.equal(safariPlan(i).code, 'xp-event');
  i.bonuses.event = { pokemonPercent: 50, until: now + 1_000 };
  assert.equal(safariPlan(i).code, 'xp-event');
  assert.equal(safariPlan({ ...i, settings: { prioritizeXpEvents: false } }).ready, true);
  assert.equal(safariPlan({ ...i, settings: { activitiesDuringXpEvents: true } }).ready, true);
  for (const event of [{ trainerPercent: 100, until: now }, { trainerPercent: 100 },
    { farmPercent: 100, until: now + 1_000 }]) {
    assert.equal(safariPlan({ ...i, bonuses: { event } }).ready, true);
  }
});

test('safari refuses missing tickets without buying a replacement', () => {
  for (const ticket of [0, -1, .5, undefined, '1']) {
    const i = input();
    i.player.items[70095] = ticket;
    const plan = safariPlan(i);
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'ticket');
    assert.equal(plan.purchase, undefined);
  }
});

test('safari counts only appropriate owned balls and does not multiply stock by target count', () => {
  const i = input();
  i.player.balls[2] = 39;
  const plan = safariPlan(i);
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'stock');
  assert.equal(plan.ballStock, 39);
  i.player.balls[2] = 0;
  assert.equal(safariPlan(i).code, 'stock');
  i.player.balls[3] = 40;
  const available = safariPlan(i);
  assert.equal(available.ready, true);
  assert.equal(available.ballStock, 40);
  assert.ok(available.targets.every(target => target.ballId === 3));
});

test('safari does not treat unknown, invalid or below-floor probabilities as suitable stock', () => {
  for (const chances of [{}, { 2: 0 }, { 2: NaN }, { 2: Infinity }, { 2: 2 }, { 2: .001 }]) {
    const i = input();
    i.data.chances = Object.fromEntries(i.data.poolIds.map(id => [id, chances]));
    const plan = safariPlan(i);
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'stock');
  }
});

test('safari protects a known depot capacity and excludes team and collection from its use', () => {
  const i = input();
  i.player.teto.maxDepot = 1;
  assert.equal(safariPlan(i).code, 'depot');
  i.player.teto.maxDepot = 3;
  assert.equal(safariPlan(i).code, 'depot');
  i.player.teto.maxDepot = 4;
  assert.equal(safariPlan(i).ready, true);
  for (const capacity of [undefined, 0, NaN, '10']) {
    i.player.teto.maxDepot = capacity;
    const plan = safariPlan(i);
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'checking');
  }
});

test('safari waits for the full authoritative pool rather than guessing unknown species', () => {
  const cases = [
    i => { delete i.info; },
    i => { i.data.poolComplete = false; },
    i => { i.info.poolCount = 7; },
    i => { i.data.poolIds = [1, 4, 7, 25, 63, 63]; },
    i => { delete i.species[63]; },
    i => { i.data.poolIds = []; },
  ];
  for (const change of cases) {
    const i = input();
    change(i);
    const plan = safariPlan(i);
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'checking');
    assert.deepEqual(safariTargets(i), []);
  }
});

test('safari requires official capture level and trainer eligibility evidence for every selected species', () => {
  for (const change of [
    i => { delete i.data.captureLevels[7]; },
    i => { i.data.captureLevels[7] = 0; },
    i => { i.data.captureLevels[7] = 201; },
    i => { delete i.data.eligibleLevels[7]; },
    i => { i.data.eligibleLevels[7] = 0; },
    i => { delete i.player.level; },
  ]) {
    const i = input();
    change(i);
    const plan = safariPlan(i);
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'checking');
  }
});

test('safari ranks collection gaps and possible level upgrades without predicting hidden capture attributes', () => {
  const targets = safariTargets(input());
  assert.deepEqual(targets.map(target => target.id), [1, 7, 25, 63]);
  assert.equal(targets[0].missingSpecies, true);
  assert.equal(targets[0].captureLevel, 40);
  assert.equal(targets[0].minTrainerLevel, 35);
  assert.equal(targets[0].usableNow, true);
  assert.equal(targets[2].missingSpecies, false);
  assert.equal(targets[2].possibleLevelUpgrade, true);
  assert.equal(targets[2].bestOwnedLevel, 5);
  assert.equal(targets[3].captureLevel, 200);
  assert.equal(targets[3].usableNow, false);
  assert.ok(targets.every(target => target.baseChance === .1 && target.chanceBasis === 'base'));
  assert.ok(targets.every(target => target.potencia === undefined && target.quality === undefined && target.shiny === undefined));
  assert.match(safariPlan(input()).reason, /base/i);
});

test('safari refresh removes a filled collection gap after a capture instead of chasing speculative quality', () => {
  const i = input();
  i.pokemon.push({ id: 99, speciesId: 1, level: 40, slot: null, potencia: 1, quality: 'poor', shiny: false });
  assert.deepEqual(safariTargets(i).map(target => target.id), [7, 25, 63]);
  i.pokemon.push({ id: 100, speciesId: 7, level: 80, slot: null });
  assert.equal(safariPlan(i).code, 'targets');
  assert.equal(safariPlan({ ...i, settings: { safariMinTargets: 1 } }).ready, true);
});

test('safari does not infer an upgrade from a missing owned level or an unusable future catch', () => {
  const i = input();
  delete i.pokemon[1].level;
  const targets = safariTargets(i);
  assert.deepEqual(targets.map(target => target.id), [1, 7, 63]);
  assert.ok(!targets.some(target => target.id === 94));
});

test('safari enforces the rolling ticket budget using persisted pending and uncertain attempts', () => {
  for (const status of ['pending', 'uncertain', 'completed']) {
    const i = input();
    i.history = [{ kind: 'safari', at: now - 1, status, cost: 1 }];
    const plan = safariPlan(JSON.parse(JSON.stringify(i)));
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'daily-limit');
    assert.equal(plan.ticketsUsed, 1);
  }
  const i = input();
  i.settings.safariTicketsPerDay = 3;
  i.history = [{ kind: 'safari', at: now - 1, status: 'completed', cost: 3 }];
  assert.equal(safariPlan(i).code, 'daily-limit');
});

test('safari blocks repeated spending after bad, cancelled or ambiguous results even with spare daily budget', () => {
  for (const outcome of ['bad', 'cancelled', 'canceled', 'failed', 'rejected', 'timeout', 'pending', 'uncertain']) {
    const i = input();
    i.settings.safariTicketsPerDay = 3;
    i.history = [{ kind: 'safari', at: now - 1_000, status: 'completed', result: outcome }];
    const plan = safariPlan(i);
    assert.equal(plan.ready, false, outcome);
    assert.equal(plan.code, 'recent-attempt', outcome);
    i.history[0].at = now - day;
    assert.equal(safariPlan(i).ready, true, outcome);
  }
});

test('safari rolling limits ignore unrelated attempts and charge no second ticket for an adopted visit', () => {
  const i = input();
  i.history = [
    { kind: 'safari', at: now - day, status: 'pending' },
    { kind: 'safari', at: now + 1, status: 'pending' },
    { kind: 'safari', at: 'invalid', status: 'pending' },
    { kind: 'safari', at: now - 1, status: 'completed', result: 'completed', cost: 0 },
    { kind: 'pvp', at: now, status: 'pending' },
  ];
  assert.equal(safariPlan(i).ready, true);
  i.history.push({ kind: 'safari', at: now - 1, status: 'completed' });
  assert.equal(safariPlan(i).code, 'daily-limit');
});

test('safari refuses a second entry while inside and waits for a live team before spending', () => {
  const i = input();
  i.player.safari = { dentro: true, fim: now + 3_600_000 };
  assert.equal(safariPlan(i).code, 'active');
  delete i.player.safari;
  i.pokemon[0].hp = 0;
  assert.equal(safariPlan(i).code, 'health');
  i.pokemon[0].hp = 100;
  i.pokemon[0].slot = null;
  assert.equal(safariPlan(i).code, 'team');
});

test('safari handles absent input conservatively without creating actions', () => {
  const plan = safariPlan();
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'checking');
  assert.deepEqual(safariTargets(), []);
});

test('safari waits for a valid clock before evaluating rolling budgets and event expiry', () => {
  for (const clock of [NaN, Infinity, 'now', null]) {
    const plan = safariPlan({ ...input(), now: clock });
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'checking');
  }
});

test('safari does not infer collection gaps or depot room from incomplete ownership records', () => {
  for (const record of [{}, null, { id: 90 }, { id: 90, speciesId: '7' }]) {
    const i = input();
    i.pokemon.push(record);
    const plan = safariPlan(i);
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'checking');
    assert.deepEqual(safariTargets(i), []);
  }
});
