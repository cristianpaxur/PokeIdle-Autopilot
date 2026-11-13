import test from 'node:test';
import assert from 'node:assert/strict';
import { raidPlan } from '../src/raid-policy.mjs';

const now = 1_800_000_000_000;
const hour = 3_600_000;
const day = 24 * hour;

function raidInput() {
  return {
    player: { id: 7, level: 1, items: { 70000: 2 } },
    pokemon: [
      { id: 11, speciesId: 4, level: 1, hp: 0, maxHp: 100, slot: 0 },
      { id: 12, speciesId: 4, level: 2, hp: 0, maxHp: 100, slot: null },
    ],
    settings: {}, history: [], now,
    info: { edicao: { id: 'gx-2027-01-18' }, eu: { inscrito: false, equipeIds: null } },
    data: {
      at: now,
      edition: { id: 'gx-2027-01-18', inscricoesDe: now - 3 * day,
        inscricoesAte: now + 2 * day, equipeAte: now + 2 * day + 4 * hour, fimEm: now + 3 * day },
      itemId: 70000, cost: 1, maxTeam: 5, ratings: { 11: 100, 12: 150 },
    },
  };
}

test('raid registers a low-level solo trainer using actual power and preserving the token reserve', () => {
  const input = raidInput();
  input.bonuses = { event: { trainerPercent: 100, until: now + hour } };
  const result = raidPlan(input);
  assert.equal(result.kind, 'raid');
  assert.equal(result.ready, true);
  assert.equal(result.action, 'register');
  assert.equal(result.target, 'gx-2027-01-18');
  assert.deepEqual(result.pokemonIds, [12, 11]);
  assert.equal(result.power, 250);
  assert.equal(result.itemId, 70000);
  assert.equal(result.cost, 1);
  assert.equal(result.reserve, 1);
  assert.equal(result.tokens, 2);
  assert.equal(result.tokensAfter, 1);
  assert.equal(result.priority, 60);
  assert.equal(result.registered, false);
  assert.ok(result.title && result.reason);
  assert.equal(result.expectedProfit, undefined);
  assert.equal(result.guaranteedBonus, undefined);
});

test('raid keeps every observing or disabled decision at priority zero without a write action', () => {
  const disabled = raidPlan({ settings: { autoRaids: false } });
  assert.equal(disabled.code, 'disabled');
  const missing = raidPlan();
  assert.equal(missing.code, 'checking');
  for (const result of [disabled, missing]) {
    assert.equal(result.kind, 'raid');
    assert.equal(result.ready, false);
    assert.equal(result.priority, 0);
    assert.equal(result.action, undefined);
    assert.ok(result.title && result.reason);
  }
});

test('raid requires the matching full participation snapshot instead of treating missing fields as false', () => {
  const cases = [null, {}, { edicao: { id: 'another-edition' }, eu: { inscrito: false } },
    { edicao: { id: 'gx-2027-01-18' }, eu: {} },
    { edicao: { id: 'gx-2027-01-18' }, eu: { inscrito: 0 } },
    { ...raidInput().info, recusa: 'raid.recusa.ja' }];
  for (const info of cases) {
    const result = raidPlan({ ...raidInput(), info });
    assert.equal(result.ready, false, JSON.stringify(info));
    assert.equal(result.code, 'checking');
    assert.equal(result.needsInfo, true);
  }
});

test('raid waits for complete calendar, costs, inventory and every owned power rating', () => {
  const changes = [
    (input) => { input.player = null; },
    (input) => { delete input.player.items; },
    (input) => { input.player.items[70000] = -1; },
    (input) => { input.player.items[70000] = 1.5; },
    (input) => { input.data = null; },
    (input) => { delete input.data.edition.inscricoesDe; },
    (input) => { input.data.edition.equipeAte = input.data.edition.inscricoesAte - 1; },
    (input) => { input.data.edition.fimEm = input.data.edition.equipeAte; },
    (input) => { input.data.cost = undefined; },
    (input) => { input.data.cost = -1; },
    (input) => { input.data.cost = 0.5; },
    (input) => { input.data.cost = '1'; },
    (input) => { input.data.itemId = 0; },
    (input) => { delete input.data.maxTeam; },
    (input) => { input.data.maxTeam = 6; },
    (input) => { delete input.data.ratings[12]; },
    (input) => { input.data.ratings[12] = 0; },
    (input) => { input.data.ratings[12] = Infinity; },
    (input) => { input.pokemon = null; },
    (input) => { input.pokemon.push({ id: 0, level: 5 }); },
    (input) => { input.settings.raidTokenReserve = -1; },
    (input) => { input.settings.raidMinGainPercent = NaN; },
  ];
  for (const change of changes) {
    const input = raidInput();
    change(input);
    const result = raidPlan(input);
    assert.equal(result.ready, false, change.toString());
    assert.equal(result.code, 'checking', change.toString());
    assert.equal(result.priority, 0);
  }
});

test('raid uses only fresh local calendar time and refuses a regressed or invalid clock', () => {
  for (const at of [undefined, now - 60_001, now + 1, NaN]) {
    const input = raidInput();
    input.data.at = at;
    assert.equal(raidPlan(input).code, 'checking');
  }
  for (const invalidNow of [NaN, Infinity, 'later', null]) {
    assert.equal(raidPlan({ ...raidInput(), now: invalidNow }).code, 'checking');
  }
  const input = raidInput();
  input.data.at = now - 60_000;
  input.info.agora = now + 4 * hour;
  assert.equal(raidPlan(input).ready, true, 'server clock must not be applied twice');
});

test('raid honors opening, closing and edition rollover using current time instead of cached flags', () => {
  for (const [time, code] of [[now - 3 * day - 1, 'scheduled'], [now + 2 * day, 'closed'],
    [now + 3 * day, 'checking']]) {
    const input = raidInput();
    input.now = time;
    input.data.at = time;
    input.data.registrationOpen = true;
    const result = raidPlan(input);
    assert.equal(result.ready, false);
    assert.equal(result.code, code);
  }
  const input = raidInput();
  input.now = input.data.at = input.data.edition.inscricoesDe;
  input.data.registrationOpen = false;
  assert.equal(raidPlan(input).action, 'register');
});

test('raid gives expiring enrollment precedence while leaving a short cutoff margin for transport', () => {
  const input = raidInput();
  input.data.edition.inscricoesAte = now + day;
  assert.equal(raidPlan(input).priority, 70);
  input.data.edition.inscricoesAte = now + 2_000;
  const result = raidPlan(input);
  assert.equal(result.ready, false);
  assert.equal(result.code, 'closing');
  assert.equal(result.priority, 0);
});

test('raid preserves the configured reserve and accepts an explicitly free official enrollment', () => {
  const input = raidInput();
  input.player.items[70000] = 1;
  assert.equal(raidPlan(input).code, 'reserve');
  input.settings.raidTokenReserve = 0;
  assert.equal(raidPlan(input).ready, true);
  input.player.items = {};
  assert.equal(raidPlan(input).code, 'reserve');
  input.data.cost = 0;
  assert.equal(raidPlan(input).ready, true);
  assert.equal(raidPlan(input).tokensAfter, 0);
  input.settings.raidTokenReserve = 1;
  assert.equal(raidPlan(input).code, 'reserve');
});

test('raid chooses up to the official limit using distinct owned IDs, including same-species reserves', () => {
  const input = raidInput();
  input.pokemon.push(input.pokemon[0], { id: 13, speciesId: 4, level: 3 },
    { id: 14, speciesId: 4, level: 4 }, { id: 15, speciesId: 4, level: 4 },
    { id: 16, speciesId: 4, level: 1 }, { id: 17, speciesId: 4, level: 5 });
  Object.assign(input.data.ratings, { 13: 400, 14: 400, 15: 400, 16: 500, 17: 90, 999: 99999 });
  const before = structuredClone(input);
  const result = raidPlan(input);
  assert.deepEqual(result.pokemonIds, [16, 15, 14, 13, 12]);
  assert.equal(result.power, 1850);
  assert.deepEqual(input, before, 'the pure policy must not sort or alter cached input');
  input.data.maxTeam = 2;
  assert.deepEqual(raidPlan(input).pokemonIds, [16, 15]);
  input.pokemon = [];
  const empty = raidPlan(input);
  assert.equal(empty.ready, false);
  assert.equal(empty.code, 'team');
});

test('raid registration intents block the whole edition, including refusals and uncertainty older than one day', () => {
  for (const details of [{ status: 'pending' }, { status: 'uncertain' }, { result: 'rejected', status: 'confirmed' },
    { result: 'registered', status: 'confirmed' }, { status: 'failed' }, { status: 'pending', at: now + 1 }]) {
    const input = raidInput();
    input.history = [{ kind: 'raid', target: input.data.edition.id, action: 'register', at: now - 2 * day, ...details }];
    const result = raidPlan(input);
    assert.equal(result.ready, false, JSON.stringify(details));
    assert.equal(result.code, 'checking');
    assert.equal(result.needsInfo, true);
    assert.equal(result.priority, 0);
  }
});

test('raid deduplication is per edition and cannot be cleared merely by a fresh unregistered snapshot', () => {
  const input = raidInput();
  input.history = [{ kind: 'raid', target: 'gx-2027-01-11', action: 'register', at: now - 2 * day, status: 'pending' },
    { kind: 'pvp', target: input.data.edition.id, at: now, status: 'pending' },
    { kind: 'raid', target: input.data.edition.id, action: 'team', at: now, status: 'confirmed' }];
  assert.equal(raidPlan(input).action, 'register');
  input.history.push({ kind: 'raid', target: input.data.edition.id, action: 'register', at: now - hour, status: 'uncertain' });
  assert.equal(raidPlan(input).code, 'checking');
});

test('raid allows one bounded registration retry only after explicit same-edition reconciliation', () => {
  const input = raidInput();
  const row = { kind: 'raid', target: input.data.edition.id, action: 'register', at: now - hour,
    sentAt: now - hour + 1, endedAt: now - 30_000, result: 'rejected', status: 'confirmed',
    resolved: true, registered: false, resolvedAt: now - 1_000 };
  input.history = [row];
  assert.equal(raidPlan(input).action, 'register');
  for (const patch of [{ resolved: false }, { registered: undefined }, { resolvedAt: now + 1 },
    { resolvedAt: row.endedAt }, { result: 'registered' }]) {
    input.history = [{ ...row, ...patch }];
    assert.equal(raidPlan(input).code, 'checking', JSON.stringify(patch));
  }
  input.history = [row, { ...row, at: now - 20_000, sentAt: now - 19_000, endedAt: now - 18_000 }];
  assert.equal(raidPlan(input).code, 'checking', 'reconciliation must not create an unbounded retry loop');
});

test('raid requires a usable history snapshot before any registration write', () => {
  assert.equal(raidPlan({ ...raidInput(), history: null }).code, 'checking');
  assert.equal(raidPlan({ ...raidInput(), history: {} }).code, 'checking');
});

test('raid saves an explicit ordered team after confirmed enrollment without charging or reserving tokens again', () => {
  const input = raidInput();
  input.player.items = {};
  input.info.eu.inscrito = true;
  input.history = [{ kind: 'raid', target: input.data.edition.id, action: 'register', at: now - hour, status: 'uncertain' }];
  const result = raidPlan(input);
  assert.equal(result.ready, true);
  assert.equal(result.action, 'team');
  assert.equal(result.registered, true);
  assert.equal(result.cost, 0);
  assert.equal(result.registrationCost, 1);
  assert.deepEqual(result.pokemonIds, [12, 11]);
  assert.equal(result.power, 250);
});

test('raid team updates remain possible after enrollment closes but stop at the team deadline', () => {
  const input = raidInput();
  input.info.eu.inscrito = true;
  input.now = input.data.at = input.data.edition.inscricoesAte;
  const open = raidPlan(input);
  assert.equal(open.ready, true);
  assert.equal(open.action, 'team');
  assert.equal(open.priority, 70);
  input.now = input.data.at = input.data.edition.equipeAte - 1_000;
  assert.equal(raidPlan(input).code, 'closing');
  input.now = input.data.at = input.data.edition.equipeAte;
  const locked = raidPlan(input);
  assert.equal(locked.ready, false);
  assert.equal(locked.code, 'locked');
  assert.equal(locked.priority, 0);
});

test('raid retains a valid saved order when the same IDs grow or sorting alone would change their order', () => {
  const input = raidInput();
  input.info.eu = { inscrito: true, equipeIds: [12, 11] };
  assert.equal(raidPlan(input).code, 'registered');
  input.data.ratings[11] = 300;
  const changedOrder = raidPlan(input);
  assert.equal(changedOrder.ready, false);
  assert.equal(changedOrder.code, 'no-gain');
  assert.deepEqual(changedOrder.pokemonIds, [12, 11]);
  assert.equal(changedOrder.action, undefined);
  assert.equal(changedOrder.priority, 0);
});

test('raid replaces a valid saved team only for the configured power gain, including the exact threshold', () => {
  const input = raidInput();
  input.info.eu = { inscrito: true, equipeIds: [11, 12] };
  input.data.maxTeam = 2;
  input.pokemon.push({ id: 13, speciesId: 4, level: 2 });
  input.data.ratings = { 11: 100, 12: 100, 13: 119 };
  const below = raidPlan(input);
  assert.equal(below.ready, false);
  assert.equal(below.code, 'no-gain');
  assert.deepEqual(below.pokemonIds, [11, 12]);
  input.data.ratings[13] = 120;
  const enough = raidPlan(input);
  assert.equal(enough.action, 'team');
  assert.deepEqual(enough.pokemonIds, [13, 12]);
  assert.equal(enough.previousPower, 200);
  assert.equal(enough.power, 220);
  assert.equal(enough.gainPercent, 10);
  input.settings.raidMinGainPercent = 20;
  assert.equal(raidPlan(input).code, 'no-gain');
});

test('raid repairs a missing or invalid saved team without demanding an improvement percentage', () => {
  for (const equipeIds of [null, [], [11, 11], [999], [0], [11, 12, 999, 998, 997, 996]]) {
    const input = raidInput();
    input.info.eu = { inscrito: true, equipeIds };
    input.settings.raidMinGainPercent = 100;
    const result = raidPlan(input);
    assert.equal(result.action, 'team', JSON.stringify(equipeIds));
    assert.deepEqual(result.pokemonIds, [12, 11]);
    assert.equal(result.repairTeam, true);
  }
});

test('raid distinguishes missing team snapshot data from the explicit hunt-team fallback', () => {
  for (const equipeIds of [undefined, {}, '11,12']) {
    const input = raidInput();
    input.info.eu = { inscrito: true, equipeIds };
    const result = raidPlan(input);
    assert.equal(result.ready, false);
    assert.equal(result.code, 'checking');
    assert.equal(result.needsInfo, true);
  }
});

test('raid does not loop an unconfirmed identical team write and accepts an exact ordered confirmation', () => {
  const input = raidInput();
  input.info.eu.inscrito = true;
  input.history = [{ kind: 'raid', target: input.data.edition.id, action: 'team', pokemonIds: [12, 11],
    at: now - 5_000, status: 'uncertain' }];
  assert.equal(raidPlan(input).code, 'checking');
  input.info.eu.equipeIds = [12, 11];
  assert.equal(raidPlan(input).code, 'registered');
  input.info.eu.equipeIds = null;
  input.data.ratings[11] = 200;
  assert.equal(raidPlan(input).action, 'team', 'a revised ordered payload can repair the earlier attempt');
});
