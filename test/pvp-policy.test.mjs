import test from 'node:test';
import assert from 'node:assert/strict';
import { pvpPlan } from '../src/pvp-policy.mjs';

const now = 1_800_000_000_000;
const day = 86_400_000;
const minute = 60_000;

function input() {
  return {
    player: { id: 5, level: 150, gold: 0, items: {} },
    pokemon: [11, 12, 13, 14, 15, 16, 17].map((id) => ({ id, speciesId: 4, level: 150, hp: 0, slot: null })),
    species: { 4: { types: ['FIRE'] } },
    now,
    history: [],
    info: { regras: { nivelMin: 150 }, time: [], fila: { na: false }, cooldownUntil: 0 },
    data: { minimumLevel: 150, minTeam: 1, maxTeam: 5,
      ratings: { 11: 50, 12: 100, 13: 90, 14: 80, 15: 70, 16: 60, 17: 40 } },
  };
}

function queuedInput() {
  const value = input();
  value.info.time = [12, 13, 14, 15, 16];
  return value;
}

function attempt(at, patch = {}) {
  return { kind: 'pvp', target: 'ranked', action: 'queue', at, status: 'confirmed', result: 'cancelled', ...patch };
}

test('defaults prepare the five strongest individual Pokémon without consuming hunt resources', () => {
  const plan = pvpPlan(input());
  assert.equal(plan.kind, 'pvp');
  assert.equal(plan.priority, 40);
  assert.equal(plan.target, 'ranked');
  assert.equal(plan.ready, true);
  assert.equal(plan.action, 'save');
  assert.deepEqual(plan.pokemonIds, [12, 13, 14, 15, 16]);
  assert.equal(plan.power, 400);
  assert.equal(plan.attempts, 0);
  assert.equal(plan.limit, 12);
  assert.equal(plan.queueTimeoutMs, 180_000);
});

test('an identical ordered saved team permits a queue attempt', () => {
  const plan = pvpPlan(queuedInput());
  assert.equal(plan.ready, true);
  assert.equal(plan.action, 'queue');
  assert.deepEqual(plan.pokemonIds, [12, 13, 14, 15, 16]);
  assert.equal(plan.winProbability, undefined);
});

test('a saved team with different order is saved before entering the queue', () => {
  const value = queuedInput();
  value.info.time = [13, 12, 14, 15, 16];
  const plan = pvpPlan(value);
  assert.equal(plan.action, 'save');
  assert.deepEqual(plan.pokemonIds, [12, 13, 14, 15, 16]);
});

test('ties use Pokémon level followed by individual ID and never duplicate an ID', () => {
  const value = input();
  value.pokemon = [14, 13, 12, 11, 11].map((id) => ({ id, speciesId: 4, level: id === 13 ? 151 : 150 }));
  value.data.ratings = { 11: 100, 12: 100, 13: 100, 14: 100 };
  const plan = pvpPlan(value);
  assert.deepEqual(plan.pokemonIds, [13, 11, 12, 14]);
  assert.equal(plan.power, 400);
});

test('a smaller collection uses all known valid Pokémon up to the official team maximum', () => {
  const value = input();
  value.pokemon = value.pokemon.slice(0, 3);
  assert.deepEqual(pvpPlan(value).pokemonIds, [12, 13, 11]);
  value.data.maxTeam = 2;
  assert.deepEqual(pvpPlan(value).pokemonIds, [12, 13]);
  value.data.maxTeam = 20;
  value.pokemon = input().pokemon;
  assert.equal(pvpPlan(value).pokemonIds.length, 5);
});

test('a missing rating anywhere in the collection postpones selection instead of silently using a partial team', () => {
  const value = input();
  delete value.data.ratings[11];
  const plan = pvpPlan(value);
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'checking');
  assert.equal(plan.needsData, true);
  assert.deepEqual(plan.unknownPokemonIds, [11]);
});

test('ratings must be positive finite numbers calculated from complete Pokémon', () => {
  for (const power of [0, -1, NaN, Infinity, '900', { power: 900 }]) {
    const value = input();
    value.data.ratings[11] = power;
    assert.equal(pvpPlan(value).code, 'checking');
  }
  for (const field of ['level', 'speciesId']) {
    const value = input();
    delete value.pokemon[0][field];
    assert.equal(pvpPlan(value).code, 'checking');
  }
});

test('invalid individual IDs cannot enter a formation and an empty collection cannot queue', () => {
  const value = input();
  value.pokemon = [null, { id: 0 }, { id: '12' }, { id: -1 }, value.pokemon[0]];
  assert.deepEqual(pvpPlan(value).pokemonIds, [11]);
  value.pokemon = [];
  assert.equal(pvpPlan(value).code, 'team');
  value.pokemon = [input().pokemon[0]];
  value.data.minTeam = 2;
  assert.equal(pvpPlan(value).code, 'team');
});

test('an explicit opt out stops new mutations before requesting game data', () => {
  const plan = pvpPlan({ settings: { autoPvp: false } });
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'disabled');
});

test('unknown player and minimum team data produce checking instead of assuming eligibility', () => {
  assert.equal(pvpPlan().code, 'checking');
  for (const patch of [{ player: null }, { data: null }, { data: { ratings: {} } }]) {
    const value = { ...input(), ...patch };
    assert.equal(pvpPlan(value).code, 'checking');
  }
  for (const patch of [{ minTeam: 0 }, { maxTeam: 0 }, { minTeam: 6, maxTeam: 5 }]) {
    const value = input();
    Object.assign(value.data, patch);
    assert.equal(pvpPlan(value).code, 'checking');
  }
});

test('level 150 is the floor even when stale rules claim a lower requirement', () => {
  const value = input();
  value.player.level = 149;
  value.info.regras.nivelMin = 1;
  value.data.minimumLevel = 1;
  const plan = pvpPlan(value);
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'level');
  assert.equal(plan.minimumLevel, 150);
});

test('current server minimum level takes precedence over helper rules', () => {
  const value = input();
  value.info.regras.nivelMin = 200;
  assert.equal(pvpPlan(value).minimumLevel, 200);
  assert.equal(pvpPlan(value).code, 'level');
  value.info.regras.nivelMin = 150;
  value.data.minimumLevel = 175;
  assert.equal(pvpPlan(value).ready, true);
  delete value.info.regras;
  assert.equal(pvpPlan(value).minimumLevel, 175);
  assert.equal(pvpPlan(value).code, 'level');
});

test('missing or malformed queue, cooldown and saved team information must be reconsulted', () => {
  for (const info of [null, {}, { fila: { na: false } },
    { time: [], cooldownUntil: 0 }, { time: [], fila: { na: false } },
    { time: [], fila: { na: 'false' }, cooldownUntil: 0 },
    { time: [], fila: { na: false }, cooldownUntil: -1 },
    { time: [null], fila: { na: false }, cooldownUntil: 0 },
    { time: [11, 11], fila: { na: false }, cooldownUntil: 0 }]) {
    const plan = pvpPlan({ ...input(), info });
    assert.equal(plan.ready, false);
    assert.equal(plan.code, 'checking');
    assert.equal(plan.needsInfo, true);
  }
});

test('a queue already active is adopted even with partial state or disabled new entries', () => {
  const plan = pvpPlan({ info: { fila: { na: true, desde: now - minute } },
    settings: { autoPvp: false }, now });
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'waiting');
  assert.equal(plan.adopt, true);
  assert.equal(plan.action, undefined);
  assert.equal(plan.queueTimeoutMs, 180_000);
});

test('a server cooldown blocks queue until its local deadline but permits free formation preparation', () => {
  const value = queuedInput();
  value.info.cooldownUntil = now + 20_000;
  const waiting = pvpPlan(value);
  assert.equal(waiting.code, 'cooldown');
  assert.equal(waiting.ready, false);
  assert.equal(waiting.retryAt, now + 20_000);
  assert.equal(waiting.cooldownMs, 20_000);
  value.info.time = [];
  assert.equal(pvpPlan(value).action, 'save');
  value.info.time = [12, 13, 14, 15, 16];
  value.now = now + 20_000;
  assert.equal(pvpPlan(value).action, 'queue');
});

test('the mystical arena postpones new PvP entries', () => {
  const value = queuedInput();
  value.player.mistico = { arena: 'active' };
  const plan = pvpPlan(value);
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'busy');
});

test('shiny hunting and XP events do not block PvP that runs alongside hunts', () => {
  const value = queuedInput();
  value.mode = 'shiny';
  value.settings = { prioritizeXpEvents: true, activitiesDuringXpEvents: false };
  value.bonuses = { event: { until: now + minute, trainerPercent: 100, pokemonPercent: 100 } };
  assert.equal(pvpPlan(value).action, 'queue');
});

test('only queue reservations consume the default twelve attempts in the last 24 hours', () => {
  const value = queuedInput();
  value.history = Array.from({ length: 11 }, (_, index) => attempt(now - (index + 1) * minute));
  value.history.push(...Array.from({ length: 20 }, (_, index) => attempt(now - index * minute, { action: 'save' })));
  const allowed = pvpPlan(value);
  assert.equal(allowed.action, 'queue');
  assert.equal(allowed.attempts, 11);
  value.history.push(attempt(now));
  const stopped = pvpPlan(value);
  assert.equal(stopped.ready, false);
  assert.equal(stopped.code, 'daily-limit');
  assert.equal(stopped.attempts, 12);
});

test('queue limits permit free team preparation and apply configured limits to the next entry', () => {
  const value = input();
  value.settings = { pvpAttemptsPerDay: 1, pvpQueueMinutes: 5 };
  value.history = [attempt(now)];
  const preparation = pvpPlan(value);
  assert.equal(preparation.action, 'save');
  assert.equal(preparation.attempts, 1);
  assert.equal(preparation.queueTimeoutMs, 300_000);
  value.info.time = [12, 13, 14, 15, 16];
  assert.equal(pvpPlan(value).code, 'daily-limit');
  value.history = [];
  value.settings.pvpAttemptsPerDay = 0;
  assert.equal(pvpPlan(value).code, 'daily-limit');
});

test('expired, future, malformed, other mode and save records do not consume queue reservations', () => {
  const value = queuedInput();
  value.history = [attempt(now - day), attempt(now + 1), attempt('invalid'),
    attempt(now, { kind: 'gym' }), attempt(now, { action: 'save' }),
    attempt(now - day + 1), attempt(now, { result: 'rejected' })];
  const plan = pvpPlan(value);
  assert.equal(plan.action, 'queue');
  assert.equal(plan.attempts, 2);
});

test('pending or uncertain queue reservations block repeats and team mutation for 24 hours', () => {
  for (const patch of [{ status: 'pending' }, { status: 'uncertain' }, { result: 'uncertain' }]) {
    const value = input();
    value.history = [attempt(now - minute, patch)];
    const blocked = pvpPlan(value);
    assert.equal(blocked.ready, false);
    assert.equal(blocked.code, 'recent-attempt');
    assert.equal(blocked.retryAt, now + day - minute);
    value.now = now + day - minute;
    assert.equal(pvpPlan(value).action, 'save');
  }
});

test('uncertain preparation alone is not treated as an attempted queue entry', () => {
  const value = queuedInput();
  value.history = [attempt(now, { action: 'save', status: 'uncertain' })];
  const plan = pvpPlan(value);
  assert.equal(plan.action, 'queue');
  assert.equal(plan.attempts, 0);
});

test('two confirmed consecutive losses rest for sixty minutes from the latest result', () => {
  const value = queuedInput();
  value.history = [attempt(now - 10 * minute, { result: 'loss', resultAt: now - 9 * minute }),
    attempt(now - 2 * minute, { result: 'loss', resultAt: now - minute })];
  const plan = pvpPlan(value);
  assert.equal(plan.ready, false);
  assert.equal(plan.code, 'loss-streak');
  assert.equal(plan.lossStreak, 2);
  assert.equal(plan.retryAt, now + 59 * minute);
  value.now = now + 59 * minute;
  assert.equal(pvpPlan(value).action, 'queue');
});

test('confirmed wins break the loss streak using result time rather than input order', () => {
  const value = queuedInput();
  value.history = [attempt(now - 2 * minute, { result: 'loss', resultAt: now - minute }),
    attempt(now - 10 * minute, { result: 'loss', resultAt: now - 9 * minute }),
    attempt(now - 5 * minute, { result: 'win', resultAt: now - 4 * minute })];
  const plan = pvpPlan(value);
  assert.equal(plan.action, 'queue');
  assert.equal(plan.lossStreak, 1);
});

test('only confirmed match outcomes contribute to a losing streak', () => {
  const value = queuedInput();
  value.history = [attempt(now - 10 * minute, { result: 'loss' }),
    attempt(now - 9 * minute, { result: 'timeout' }),
    attempt(now - 8 * minute, { result: 'rejected' }),
    attempt(now - 7 * minute, { result: 'loss', status: 'completed' }),
    attempt(now - 6 * minute, { result: 'loss', action: 'save' })];
  const plan = pvpPlan(value);
  assert.equal(plan.action, 'queue');
  assert.equal(plan.lossStreak, 1);
  value.history.push(attempt(now - minute, { result: 'loss' }));
  assert.equal(pvpPlan(value).code, 'loss-streak');
});

test('loss streak settings control the threshold and rest duration without forbidding preparation', () => {
  const value = queuedInput();
  value.settings = { pvpLossStreak: 1, pvpRestMinutes: 5 };
  value.history = [attempt(now - minute, { result: 'loss', endedAt: now - 30_000 })];
  const plan = pvpPlan(value);
  assert.equal(plan.code, 'loss-streak');
  assert.equal(plan.retryAt, now + 270_000);
  value.info.time = [];
  assert.equal(pvpPlan(value).action, 'save');
});

test('old confirmed outcomes do not prolong an elapsed rest and future outcomes are ignored', () => {
  const value = queuedInput();
  value.history = [attempt(now - day - minute, { result: 'loss' }),
    attempt(now - day, { result: 'loss' }),
    attempt(now + minute, { result: 'loss' }),
    attempt(now - minute, { result: 'loss', resultAt: now + minute })];
  const plan = pvpPlan(value);
  assert.equal(plan.action, 'queue');
  assert.equal(plan.attempts, 1);
});

test('recent results from an old reservation still enforce the loss rest', () => {
  const value = queuedInput();
  value.history = [attempt(now - day - minute, { result: 'loss', resultAt: now - 2 * minute }),
    attempt(now - minute, { result: 'loss', resultAt: now })];
  const plan = pvpPlan(value);
  assert.equal(plan.code, 'loss-streak');
  assert.equal(plan.attempts, 1);
  assert.equal(plan.retryAt, now + 60 * minute);
});

test('nonfinite total power cannot become a ready formation even if individual ratings are finite', () => {
  const value = input();
  for (const pk of value.pokemon) value.data.ratings[pk.id] = 1e308;
  assert.equal(pvpPlan(value).code, 'checking');
});

test('evaluating the plan leaves collection, saved formation and history unchanged', () => {
  const value = input();
  value.history = [attempt(now - minute)];
  const before = structuredClone(value);
  pvpPlan(value);
  assert.deepEqual(value, before);
});
