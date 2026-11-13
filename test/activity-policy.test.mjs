import test from 'node:test';
import assert from 'node:assert/strict';
import { dayAttempts, gymPlan, bossPlan } from '../src/activity-policy.mjs';

const now = 1_800_000_000_000;
const day = 86_400_000;

function gymInput() {
  const primary = { id: 11, speciesId: 4, level: 350, slot: 0, hp: 100, maxHp: 100, tipos: ['FIRE'] };
  return { player: { id: 5, level: 350, items: {} }, pokemon: [primary], primary, species: {}, now, mode: 'farm',
    settings: { autoGyms: true, gymMinAdvantagePercent: 25, gymAttemptsPerDay: 2,
      prioritizeXpEvents: true, activitiesDuringXpEvents: false }, history: [], ratings: { 11: 150 },
    info: { nivelMin: 150, timeMax: 5, podeRegistrar: true, pokemonEmGinasio: { 11: 'FIRE' },
      ginasios: [{ tipo: 'FIRE', souLider: false, meuLugar: 2, lider: { poder: 100 },
        meuTime: { poder: 150, pokemonIds: [11], casas: [] } }] },
    panel: { tipo: 'FIRE', total: 2, minhaPos: 2, desafioCooldownMs: 0,
      meuTime: { poder: 150, pokemons: [{ id: 11 }], casas: [] },
      ranking: [{ pos: 1, playerId: 6, poder: 100, pokemons: [{ id: 20 }] },
        { pos: 2, playerId: 5, poder: 150, pokemons: [{ id: 11 }] }] } };
}

function bossInput() {
  const primary = { id: 11, speciesId: 4, level: 360, slot: 0, hp: 100, maxHp: 100, tipos: ['FIRE'] };
  return { player: { id: 5, level: 350, items: { 700: 3 } }, pokemon: [primary,
    { id: 12, speciesId: 5, level: 360, slot: 1, hp: 80, maxHp: 100, tipos: ['FIRE'] },
    { id: 13, speciesId: 7, level: 1, slot: null, hp: 0, maxHp: 100, tipos: ['WATER'] }],
  primary, species: {}, now, mode: 'farm', history: [],
  settings: { autoBosses: true, bossTeamLevelPercent: 120, bossTokenReserve: 1, bossAttemptsPerDay: 2,
    prioritizeXpEvents: true, activitiesDuringXpEvents: false },
  typeChart: { FIRE: { GRASS: 2 }, GRASS: { FIRE: 0.5 } },
  bosses: [{ key: 'vine', nome: 'Boss Planta', level: 300, minNivelTreinador: 300,
    teamLevel: 300, equipeIdeal: 2, type1: 'GRASS', type2: null,
    entrada: { itemId: 700, qtd: 2, nome: 'Ficha Verde' },
    drops: [{ itemId: 800, nome: 'Recompensa', chance: 0.1, qtd: [1, 2] }] }] };
}

test('dayAttempts counts all recent intents rather than the displayed last ten', () => {
  const history = Array.from({ length: 15 }, (_, id) => ({ id, kind: 'boss', at: now - id * 1_000,
    status: id % 2 ? 'pending' : 'completed', result: id % 2 ? null : 'won' }));
  history.push({ id: 20, kind: 'boss', at: now - day, status: 'pending' },
    { id: 21, kind: 'boss', at: now + 1, status: 'pending' },
    { id: 22, kind: 'gym', at: now, status: 'pending' },
    { id: 23, kind: 'boss', at: 'invalid', status: 'pending' });
  assert.equal(dayAttempts(history, 'boss', now), 15);
  assert.equal(dayAttempts(history, 'gym', now), 1);
  assert.equal(dayAttempts(undefined, 'gym', now), 0);
});

test('gym uses the official team rating and margin for an already registered challenge', () => {
  const input = gymInput();
  const result = gymPlan(input);
  assert.equal(result?.ready, true);
  assert.equal(result.action, 'challenge');
  assert.equal(result.target, 'FIRE');
  assert.deepEqual(result.pokemonIds, [11]);
  assert.equal(result.power, 150);
  assert.equal(result.leaderPower, 100);
  assert.equal(result.powerRatio, 1.5);
  assert.equal(result.bonusBefore, 10);
  assert.equal(result.bonusAfter, 25);
});

test('gym checks access, preferences, rolling attempts and the XP or shiny priority before acting', () => {
  const cases = [
    { change: { player: { level: 149 } }, code: 'level' },
    { change: { info: null }, code: 'checking' },
    { change: { info: { ...gymInput().info, nivelMin: 400 } }, code: 'level' },
    { change: { settings: { autoGyms: false } }, code: 'disabled' },
    { change: { mode: 'shiny' }, code: 'shiny' },
    { change: { bonuses: { event: { trainerPercent: 20, pokemonPercent: 0, until: now + 1_000 } } }, code: 'xp-event' },
    { change: { history: [{ kind: 'gym', at: now, status: 'pending' },
      { kind: 'gym', at: now - 10_000, status: 'completed', result: 'won' }] }, code: 'daily-limit' },
    { change: { settings: { gymAttemptsPerDay: 0 } }, code: 'daily-limit' },
  ];
  for (const { change, code } of cases) {
    const input = gymInput();
    const result = gymPlan({ ...input, ...change, settings: { ...input.settings, ...change.settings } });
    assert.equal(result?.ready, false, code);
    assert.equal(result.code, code);
    assert.ok(result.title && result.reason, code);
  }
  assert.equal(gymPlan({ ...gymInput(), settings: { ...gymInput().settings, activitiesDuringXpEvents: true },
    bonuses: { event: { trainerPercent: 20, until: now + 1_000 } } }).ready, true);
  assert.equal(gymPlan({ ...gymInput(), settings: { ...gymInput().settings, prioritizeXpEvents: false },
    bonuses: { event: { pokemonPercent: 20, until: now + 1_000 } } }).ready, true);
  assert.equal(gymPlan({ ...gymInput(), bonuses: { event: { trainerPercent: 20, until: now - 1 } } }).ready, true);
});

test('gym shows the trainer requirement before the XP event while keeping explicit priorities', () => {
  const input = gymInput();
  input.bonuses = { event: { trainerPercent: 100, until: now + 1_000 } };
  for (const level of [52, 69, 79]) {
    input.player.level = level;
    for (const info of [input.info, undefined]) {
      const result = gymPlan({ ...input, info });
      assert.equal(result.code, 'level');
      assert.equal(result.minimumLevel, 150);
      assert.equal(result.ready, false);
    }
  }
  assert.equal(gymPlan({ ...input, mode: 'shiny' }).code, 'shiny');
  assert.equal(gymPlan({ ...input, settings: { ...input.settings, autoGyms: false } }).code, 'disabled');
  assert.equal(gymPlan({ ...input, settings: { ...input.settings, gymAttemptsPerDay: 0 } }).code, 'daily-limit');
  input.player.level = 150;
  assert.equal(gymPlan(input).code, 'xp-event');
  input.info.nivelMin = 400;
  assert.equal(gymPlan(input).code, 'level');
  assert.equal(gymPlan(input).minimumLevel, 400);
});

test('gym asks for official ratings and a matching current panel, never using raw power', () => {
  const input = gymInput();
  input.pokemon[0].poder = 999_999;
  for (const ratings of [{}, { 11: NaN }, { 11: -1 }, { 11: '150' }]) {
    const result = gymPlan({ ...input, ratings });
    assert.equal(result?.ready, false);
    assert.equal(result.needsRatings, true);
    assert.equal(result.power, undefined);
  }
  const result = gymPlan({ ...input, panel: { ...input.panel, tipo: 'WATER' } });
  assert.equal(result?.ready, false);
  assert.equal(result.needsPanel, true);
  assert.equal(result.target, 'FIRE');
});

test('gym empty registration picks at most five distinct eligible species and preserves other registrations', () => {
  const input = gymInput();
  input.primary = { ...input.primary, tipos: undefined };
  input.species = { 4: { types: ['fire'] } };
  input.pokemon = [
    input.primary,
    { id: 12, speciesId: 4, shiny: true, tipos: ['FIRE'] },
    { id: 13, speciesId: 5, tipos: ['FIRE'] },
    { id: 14, speciesId: 6, tipos: ['FIRE', 'FLYING'] },
    { id: 15, speciesId: 7, tipos: ['WATER'] },
    { id: 16, speciesId: 8, tipos: ['FIRE'] },
    { id: 17, speciesId: 9, tipos: ['FIRE'] },
    { id: 18, speciesId: 10, tipos: ['FIRE'] },
    { id: 19, speciesId: 11, tipos: ['FIRE'] },
    { id: 19, speciesId: 11, tipos: ['FIRE'] },
  ];
  input.ratings = { 11: 30, 12: 50, 13: 40, 14: 1_000, 15: 2_000, 16: 20, 17: 15, 18: 10, 19: 5 };
  input.info.pokemonEmGinasio = { 14: 'FLYING' };
  input.info.ginasios = [{ tipo: 'FIRE', souLider: false, meuLugar: null, lider: null, meuTime: null },
    { tipo: 'FLYING', souLider: true, meuLugar: 1, lider: { poder: 1_000 },
      meuTime: { poder: 1_000, pokemonIds: [14], casas: [] } }];
  input.panel = null;
  const result = gymPlan(input);
  assert.equal(result?.ready, true);
  assert.equal(result.action, 'register');
  assert.deepEqual(result.pokemonIds, [12, 13, 16, 17, 18]);
  assert.equal(result.power, 135);
  assert.equal(result.bonusBefore, 0);
  assert.equal(result.bonusAfter, 25);
});

test('gym dual types use the highest existing bonus and skip when the principal already has leadership', () => {
  const input = gymInput();
  input.primary.tipos = ['FIRE', 'FLYING'];
  input.info.ginasios.push({ tipo: 'FLYING', souLider: true, meuLugar: 1,
    lider: { poder: 10 }, meuTime: { poder: 10, pokemonIds: [20], casas: [] } });
  input.ratings = {};
  const result = gymPlan(input);
  assert.equal(result?.ready, false);
  assert.equal(result.code, 'no-gain');
  assert.equal(result.bonusBefore, 25);
  assert.equal(result.needsRatings, undefined);
});

test('gym can register for a better second or third position without challenging a stronger leader', () => {
  for (const [power, expectedBonus] of [[150, 10], [70, 5]]) {
    const input = gymInput();
    input.info.pokemonEmGinasio = {};
    input.info.ginasios[0] = { tipo: 'FIRE', souLider: false, meuLugar: null,
      lider: { poder: 1_000 }, meuTime: null };
    input.panel = { tipo: 'FIRE', total: 3, minhaPos: null, desafioCooldownMs: 9_999, meuTime: null,
      ranking: [{ pos: 1, playerId: 6, poder: 1_000 }, { pos: 2, playerId: 7, poder: 100 },
        { pos: 3, playerId: 8, poder: 50 }] };
    input.ratings = { 11: power };
    const result = gymPlan(input);
    assert.equal(result?.ready, true);
    assert.equal(result.action, 'register');
    assert.equal(result.bonusAfter, expectedBonus);
  }
});

test('gym does not resave an unchanged team or challenge below margin or during server cooldown', () => {
  const input = gymInput();
  assert.equal(gymPlan({ ...input, ratings: { 11: 124 } })?.ready, false);
  assert.equal(gymPlan({ ...input, ratings: { 11: 125 } })?.ready, true);
  const cooldown = gymPlan({ ...input, panel: { ...input.panel, desafioCooldownMs: 1 } });
  assert.equal(cooldown?.ready, false);
  assert.equal(cooldown.code, 'cooldown');
  const unchanged = gymPlan({ ...input, ratings: { 11: 110 } });
  assert.equal(unchanged?.ready, false);
  assert.notEqual(unchanged.action, 'register');
});

test('gym pending, lost, uncertain and rejected attempts block the same target for 24 hours', () => {
  for (const attempt of [{ status: 'pending' }, { status: 'completed', result: 'lost' },
    { status: 'uncertain' }, { status: 'rejected' }, { status: 'confirmed', result: 'loss' },
    { status: 'confirmed', result: 'timeout' }, { status: 'confirmed', action: 'challenge', result: 'win' }]) {
    const input = { ...gymInput(), history: [{ id: 1, kind: 'gym', target: 'FIRE', at: now - 1, ...attempt }] };
    assert.equal(gymPlan(input)?.ready, false);
    assert.equal(gymPlan(input).code, 'recent-attempt');
    input.history[0].at = now - day;
    assert.equal(gymPlan(input).ready, true);
  }
});

test('gym refuses unknown opponent power and never infers an empty gym from a missing leader field', () => {
  const input = gymInput();
  for (const power of [NaN, 0, -1, undefined, '100']) {
    const result = gymPlan({ ...input, panel: { ...input.panel,
      ranking: [{ pos: 1, playerId: 6, poder: power }] } });
    assert.equal(result?.ready, false);
  }
  delete input.info.ginasios[0].lider;
  assert.equal(gymPlan({ ...input, panel: null })?.ready, false);
});

test('gym registers a new team before challenging and recognizes its confirmed registration on reevaluation', () => {
  const input = gymInput();
  input.info.pokemonEmGinasio = {};
  input.info.ginasios[0].meuLugar = null;
  input.info.ginasios[0].meuTime = null;
  input.panel.meuTime = null;
  input.panel.minhaPos = null;
  input.panel.total = 1;
  input.panel.ranking.pop();
  const registration = gymPlan(input);
  assert.equal(registration.action, 'register');
  assert.equal(registration.challengerReady, true);
  assert.equal(registration.bonusAfter, 10);
  input.info.pokemonEmGinasio = { 11: 'FIRE' };
  input.panel.meuTime = { poder: 150, pokemons: [{ id: 11 }], casas: [] };
  input.panel.minhaPos = 2;
  input.history = [{ kind: 'gym', target: 'FIRE', action: 'register', result: 'registered', status: 'confirmed', at: now - 1 }];
  assert.equal(gymPlan(input).action, 'challenge');
});

test('gym respects current panel leadership even when the overview is stale', () => {
  const input = gymInput();
  input.panel.minhaPos = 1;
  input.panel.ranking[0].playerId = input.player.id;
  input.ratings = {};
  const result = gymPlan(input);
  assert.equal(result.code, 'no-gain');
  assert.equal(result.bonusBefore, 25);
});

test('gym never replaces a leadership team while overview and panel disagree', () => {
  const input = gymInput();
  input.info.ginasios[0].souLider = true;
  input.info.ginasios[0].meuLugar = 1;
  input.pokemon.push({ id: 12, speciesId: 5, tipos: ['FIRE'] });
  input.ratings[12] = 200;
  const result = gymPlan(input);
  assert.equal(result.ready, false);
  assert.equal(result.code, 'no-gain');
});

test('gym does not infer leadership from a stale empty overview or an incomplete podium', () => {
  const input = gymInput();
  input.info.ginasios[0].lider = null;
  input.info.ginasios[0].meuTime = null;
  input.info.ginasios[0].meuLugar = null;
  input.panel.meuTime = null;
  input.panel.minhaPos = null;
  input.panel.ranking = [{ pos: 1, playerId: 6, poder: 1_000 },
    { pos: 2, playerId: 7, poder: 500 }, { pos: 3, playerId: 8, poder: 300 }];
  input.panel.total = 3;
  assert.equal(gymPlan(input).ready, false);
  input.panel.ranking = [{ pos: 1, playerId: 6, poder: 1_000 }, { pos: 3, playerId: 8, poder: 10 }];
  assert.equal(gymPlan(input).ready, false);
});

test('gym refuses an overflowing ratio of otherwise finite powers', () => {
  const input = gymInput();
  input.ratings = { 11: 1e308 };
  input.panel.ranking[0].poder = 1e-308;
  assert.equal(gymPlan(input).ready, false);
});

test('boss spends only surplus tokens and reports the actual entrance, reserve and per-member level requirement', () => {
  const result = bossPlan(bossInput());
  assert.equal(result?.ready, true);
  assert.equal(result.target, 'vine');
  assert.equal(result.name, 'Boss Planta');
  assert.equal(result.itemId, 700);
  assert.equal(result.cost, 2);
  assert.equal(result.tokens, 3);
  assert.equal(result.tokensAfter, 1);
  assert.equal(result.reserve, 1);
  assert.equal(result.teamLevel, 300);
  assert.equal(result.requiredTeamLevel, 360);
  assert.equal(result.offensiveMultiplier, 2);
  assert.equal(result.defensiveMultiplier, 0.5);
  assert.ok(result.title && result.reason);
  const input = bossInput();
  input.player.items[700] = 2;
  assert.equal(bossPlan(input).ready, false);
  assert.equal(bossPlan(input).code, 'tokens');
});

test('boss uses trainer requirements from the official catalog and a 300 fallback while catalog is unavailable', () => {
  const input = bossInput();
  assert.equal(bossPlan({ ...input, player: { ...input.player, level: 299 }, bosses: [] })?.code, 'level');
  assert.equal(bossPlan({ ...input, bosses: [] })?.code, 'checking');
  input.bosses[0].minNivelTreinador = 400;
  assert.equal(bossPlan(input)?.ready, false);
  assert.equal(bossPlan(input).code, 'level');
});

test('boss shows the lowest trainer requirement before the XP event and still defers eligible accounts', () => {
  const input = bossInput();
  input.bonuses = { event: { trainerPercent: 100, until: now + 1_000 } };
  input.bosses.unshift({ ...input.bosses[0], key: 'locked', minNivelTreinador: 500 });
  for (const level of [52, 69, 79]) {
    input.player.level = level;
    for (const bosses of [input.bosses, []]) {
      const result = bossPlan({ ...input, bosses });
      assert.equal(result.code, 'level');
      assert.equal(result.minimumLevel, 300);
      assert.equal(result.ready, false);
    }
  }
  assert.equal(bossPlan({ ...input, mode: 'shiny' }).code, 'shiny');
  assert.equal(bossPlan({ ...input, settings: { ...input.settings, autoBosses: false } }).code, 'disabled');
  assert.equal(bossPlan({ ...input, settings: { ...input.settings, bossAttemptsPerDay: 0 } }).code, 'daily-limit');
  input.player.level = 300;
  assert.equal(bossPlan(input).code, 'xp-event');
  input.bosses[1].minNivelTreinador = 400;
  assert.equal(bossPlan(input).code, 'level');
  assert.equal(bossPlan(input).minimumLevel, 400);
});

test('boss does not average away a weak member or include depot Pokémon in the participating team', () => {
  const input = bossInput();
  input.pokemon[0].level = 1_000;
  input.pokemon[1].level = 359;
  assert.equal(bossPlan(input)?.ready, false);
  assert.equal(bossPlan(input).code, 'team-level');
  input.pokemon[1].level = 360;
  assert.equal(bossPlan(input).ready, true);
  input.pokemon[1].slot = null;
  assert.equal(bossPlan(input).ready, false);
  assert.equal(bossPlan(input).code, 'team');
});

test('boss requires every participant healthy with real HP data and at least 80 percent', () => {
  for (const health of [{ hp: 79, maxHp: 100 }, { hp: 0, maxHp: 100 },
    { hp: 100, maxHp: undefined }, { hp: NaN, maxHp: 100 }]) {
    const input = bossInput();
    Object.assign(input.pokemon[1], health);
    const result = bossPlan(input);
    assert.equal(result?.ready, false);
    assert.equal(result.code, 'health');
  }
});

test('boss requires real offensive advantage and no defensive weakness or immunity using both target types', () => {
  const cases = [
    { chart: { FIRE: { GRASS: 1 }, GRASS: { FIRE: 0.5 } } },
    { chart: { FIRE: { GRASS: 0 }, GRASS: { FIRE: 0.5 } } },
    { chart: { FIRE: { GRASS: 2 }, GRASS: { FIRE: 2 } } },
    { chart: { FIRE: { GRASS: 2 } } },
    { chart: {} },
    { second: 'WATER', chart: { FIRE: { GRASS: 2, WATER: 0.5 }, GRASS: { FIRE: 0.5 }, WATER: { FIRE: 2 } } },
    { second: 'GHOST', chart: { FIRE: { GRASS: 2, GHOST: 0 }, GRASS: { FIRE: 0.5 }, GHOST: { FIRE: 1 } } },
  ];
  for (const { chart, second } of cases) {
    const input = bossInput();
    input.typeChart = chart;
    if (second) input.bosses[0].type2 = second;
    const result = bossPlan(input);
    assert.equal(result?.ready, false);
    assert.equal(result.code, 'types');
  }
  const input = bossInput();
  delete input.primary.tipos;
  input.species = { 4: { types: ['fire'] } };
  assert.equal(bossPlan(input)?.ready, true);
});

test('boss respects automation, rolling attempts including pending, and event or shiny priorities', () => {
  const cases = [
    { change: { settings: { autoBosses: false } }, code: 'disabled' },
    { change: { settings: { bossAttemptsPerDay: 0 } }, code: 'daily-limit' },
    { change: { mode: 'shiny' }, code: 'shiny' },
    { change: { bonuses: { event: { trainerPercent: 10, until: now + 1_000 } } }, code: 'xp-event' },
    { change: { history: [{ kind: 'boss', at: now, status: 'pending' },
      { kind: 'boss', at: now - 10_000, status: 'confirmed', result: 'win' }] }, code: 'daily-limit' },
  ];
  for (const { change, code } of cases) {
    const input = bossInput();
    const result = bossPlan({ ...input, ...change, settings: { ...input.settings, ...change.settings } });
    assert.equal(result?.ready, false);
    assert.equal(result.code, code);
  }
  const input = bossInput();
  input.bonuses = { event: { pokemonPercent: 10, until: now + 1_000 } };
  input.settings.activitiesDuringXpEvents = true;
  assert.equal(bossPlan(input)?.ready, true);
});

test('boss blocks a failed or uncertain target for 24 hours but permits a winning target within the limit', () => {
  for (const attempt of [{ status: 'pending' }, { status: 'confirmed', result: 'loss' },
    { status: 'uncertain' }, { status: 'failed', result: 'rejected' }, { result: 'timeout' }]) {
    const input = { ...bossInput(), history: [{ id: 1, kind: 'boss', target: 'vine', at: now - 1, ...attempt }] };
    assert.equal(bossPlan(input)?.ready, false);
    assert.equal(bossPlan(input).code, 'recent-attempt');
    input.history[0].at = now - day;
    assert.equal(bossPlan(input).ready, true);
  }
  assert.equal(bossPlan({ ...bossInput(), history: [{ kind: 'boss', target: 'vine', at: now - 1,
    status: 'confirmed', result: 'win' }] })?.ready, true);
});

test('boss selects the lower requirement with suitable types and skips unavailable targets', () => {
  const input = bossInput();
  input.bosses.unshift({ ...input.bosses[0], key: 'harder', teamLevel: 301 },
    { ...input.bosses[0], key: 'locked', minNivelTreinador: 400 });
  assert.equal(bossPlan(input)?.target, 'vine');
  input.bosses.push({ ...input.bosses[2], key: 'easier', teamLevel: 200 });
  assert.equal(bossPlan(input)?.target, 'easier');
  input.history = [{ kind: 'boss', target: 'easier', status: 'confirmed', result: 'loss', at: now - 1 }];
  assert.equal(bossPlan(input)?.target, 'vine');
});

test('boss refuses malformed cost, requirements, or a principal outside the team without inventing estimates', () => {
  for (const change of [{ teamLevel: undefined }, { equipeIdeal: 0 }, { entrada: { itemId: 700, qtd: -1 } },
    { entrada: { itemId: 700, qtd: '2' } }]) {
    const input = bossInput();
    Object.assign(input.bosses[0], change);
    assert.equal(bossPlan(input)?.ready, false);
  }
  const input = bossInput();
  input.primary = { ...input.primary, id: 999 };
  assert.equal(bossPlan(input)?.ready, false);
});
