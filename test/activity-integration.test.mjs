import assert from 'node:assert/strict';
import test from 'node:test';
import { Ledger } from '../src/ledger.mjs';
import { Session } from '../src/session.mjs';

const boss = { key: 'moltres', nome: 'Moltres', level: 300, minNivelTreinador: 300,
  teamLevel: 300, equipeIdeal: 5, type1: 'FIRE', entrada: { itemId: 70000, qtd: 1 }, drops: [] };
const team = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, speciesId: i + 7, nome: 'Water ' + i,
  slot: i, level: 400, hp: 100, maxHp: 100, xp: 100, tipos: ['WATER'] }));

function setup(t, extra = {}, ledger) {
  if (!ledger) { ledger = new Ledger(':memory:'); t.after(() => ledger.close()); }
  const session = new Session({ id: 1, display: ':11', marketEnabled: false }, {}, ledger, () => {});
  const sent = [];
  session.desired = true;
  session.browser = { socket: {}, page: { locator: () => ({ first() { return this; }, isVisible: async () => false }) },
    send: async (m) => { sent.push(m); return true; } };
  session.frame({ t: 'welcome', bossesJogaveis: [boss], tabelaTipos: { WATER: { FIRE: 2 }, FIRE: { WATER: .5 } },
    hunts: [{ slug: 'paras', nivel: 10 }], estado: { nick: 'Trainer', level: 400, activeId: 1, xp: 100,
      gold: 10000, huntSlug: 'paras', noCentro: false, pokemons: team.map((p) => ({ ...p })),
      items: { 70000: 4 }, boss: { auto: true, arena: null, vitorias: {} }, ...extra } });
  return { session, sent, ledger };
}

test('low level accounts explain both locks without attempting either activity', async (t) => {
  const { session, sent } = setup(t, { level: 79 });
  assert.ok(session.planner.activities, 'planner includes activity coordinator');
  session.planner.refresh();
  const activities = session.snapshot().planner.activities;
  assert.equal(activities.gym.ready, false);
  assert.match(activities.gym.reason, /150/);
  assert.equal(activities.boss.ready, false);
  assert.match(activities.boss.reason, /300/);
  await session.planner.activities.consider();
  assert.deepEqual(sent, []);
});

test('boss entry waits for confirmed auto off and persists intent before sending once', async (t) => {
  const { session, sent, ledger } = setup(t);
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  assert.deepEqual(sent, [{ t: 'boss.auto', ativo: false, key: 'moltres' }]);
  assert.equal(ledger.plannerState('Trainer').activity.stage, 'disarming');
  await session.planner.activities.run();
  assert.equal(sent.length, 1);
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: null, vitorias: {} } } });
  session.browser.send = async (m) => {
    if (m.t === 'boss.entrar') assert.equal(ledger.plannerState('Trainer').activity.stage, 'entering');
    sent.push(m); return true;
  };
  await session.planner.activities.run();
  assert.deepEqual(sent.at(-1), { t: 'boss.entrar', key: 'moltres' });
  await session.planner.activities.run();
  assert.equal(sent.filter((m) => m.t === 'boss.entrar').length, 1);
});

test('a boss win waits for Center, heals and confirms return to hunt before finishing', async (t) => {
  const { session, sent } = setup(t);
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: null } } });
  await session.planner.activities.run();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  session.frame({ t: 'batalha', ev: [{ k: 'bossMorto', key: 'moltres', nome: 'Moltres', drops: [{ itemId: 99, qtd: 1 }] }] });
  await session.planner.activities.run();
  assert.equal(sent.some((m) => m.t === 'hunt.select'), false);
  session.frame({ t: 'estado', estado: { noCentro: true, boss: { auto: false, arena: null }, pkMud: [{ ...team[0], hp: 40 }] } });
  await session.planner.activities.run();
  assert.deepEqual(sent.at(-1), { t: 'centro.curar' });
  session.frame({ t: 'estado', estado: { pkMud: [{ ...team[0], hp: 100 }] } });
  await session.planner.activities.run();
  assert.deepEqual(sent.at(-1), { t: 'hunt.select', slug: 'paras' });
  session.frame({ t: 'estado', estado: { noCentro: false, huntSlug: 'paras' } });
  assert.equal(session.planner.activities.current, null);
  assert.equal(session.snapshot().planner.activities.history[0].result, 'win');
});

test('an unconfirmed boss entry is reconciled after restart and never sent twice', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session, ledger, sent } = setup(t, { boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  assert.equal(sent.filter((m) => m.t === 'boss.entrar').length, 1);
  const restarted = setup(t, { boss: { auto: false, arena: null } }, ledger);
  t.mock.timers.tick(121_000);
  await restarted.session.planner.activities.run();
  await restarted.session.planner.activities.consider();
  assert.equal(restarted.sent.some((m) => m.t === 'boss.entrar'), false);
  assert.equal(restarted.session.snapshot().planner.activities.history[0].result, 'uncertain');
});

test('pause prevents boss timeout exit and resume exits at most once before fresh state', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session, sent } = setup(t, { boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false, bossMaxMinutes: 1 });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  session.pause();
  t.mock.timers.tick(61_000);
  await session.planner.activities.run();
  assert.equal(sent.some((m) => m.t === 'boss.sair'), false);
  session.paused = false;
  await session.planner.activities.run();
  await session.planner.activities.run();
  assert.equal(sent.filter((m) => m.t === 'boss.sair').length, 1);
});

test('a gym result only completes the matching persisted challenge', (t) => {
  const { session } = setup(t);
  assert.ok(session.planner.activities);
  session.planner.runtime.activity = { id: 'gym-1', kind: 'gym', target: 'WATER', stage: 'challenging', at: Date.now(), sentAt: Date.now() };
  session.planner.runtime.activityHistory = [{ ...session.planner.runtime.activity, status: 'pending' }];
  session.planner.persist();
  session.frame({ t: 'ginasio', desafio: { tipo: 'FIRE', venci: true, tomouLideranca: true } });
  assert.equal(session.planner.activities.current.target, 'WATER');
  session.frame({ t: 'ginasio', desafio: { tipo: 'WATER', venci: true, tomouLideranca: false } });
  assert.equal(session.planner.activities.current, null);
  const result = session.snapshot().planner.activities.history[0];
  assert.equal(result.result, 'win');
  assert.equal(result.tookLead, false);
});

test('changing the gym bonus creates a new XP comparison context', (t) => {
  const { session } = setup(t, { level: 79, ginasiosPodio: {} });
  session.observeOptimization();
  const previous = session.optimizer.context;
  session.frame({ t: 'estado', estado: { ginasiosPodio: { WATER: 2 } } });
  assert.notEqual(session.optimizer.context, previous);
});

test('the Center state arriving before the boss result does not lose the win', async (t) => {
  const { session } = setup(t, { boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  session.frame({ t: 'estado', estado: { noCentro: true, boss: { auto: false, arena: null } } });
  session.frame({ t: 'batalha', ev: [{ k: 'bossMorto', key: 'moltres', nome: 'Moltres', drops: [] }] });
  assert.equal(session.planner.activities.current.result, 'win');
});

test('gym registration and challenge share one budgeted attempt with a fresh server check between them', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session, sent } = setup(t, { level: 160 });
  session.setPlannerSettings({ autoBosses: false, gymAttemptsPerDay: 1 });
  const info = { nivelMin: 150, timeMax: 5, podeRegistrar: true, pokemonEmGinasio: {},
    ginasios: [{ tipo: 'WATER', meuLugar: null, souLider: false, lider: { playerId: 999, poder: 100 }, meuTime: null }] };
  const panel = { tipo: 'WATER', total: 1, minhaPos: null, desafioCooldownMs: 0, meuTime: null,
    ranking: [{ pos: 1, playerId: 999, poder: 100, pokemons: [] }] };
  session.frame({ t: 'ginasio', info, painel: panel });
  session.planner.activities.ratings = Object.fromEntries(team.map((p) => [p.id, 100]));
  session.planner.activities.ratingsAt = Date.now();
  session.browser.gymData = async () => ({ ratings: session.planner.activities.ratings,
    casas: { 1: 2, 2: 3, 3: 1, 4: 4, 5: 0 } });
  await session.planner.activities.consider();
  assert.equal(sent.at(-1).t, 'ginasio.salvar');
  const ids = sent.at(-1).pokemonIds;
  session.frame({ t: 'ginasio', salvo: { tipo: 'WATER', pokemonIds: ids } });
  await session.planner.activities.run();
  assert.equal(sent.at(-1).t, 'ginasio.info');
  session.frame({ t: 'ginasio', info: { ...info, ginasios: [{ ...info.ginasios[0], meuTime: { poder: 500, pokemonIds: ids } }] },
    painel: { ...panel, meuTime: { poder: 500, pokemons: ids.map((id) => ({ id })) } } });
  // Hunting continues while registering. A level-up invalidates the old arena rating.
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, json: async () =>
    String(url).includes('marker-atlas') ? { slots: [], cols: 1, rows: 1 } : { creatures: [] } }));
  session.frame({ t: 'estado', estado: { pkMud: [{ ...team[0], level: 401 }] } });
  await session.planner.activities.run();
  await session.planner.activities.run();
  assert.deepEqual(sent.at(-1), { t: 'ginasio.desafiar', tipo: 'WATER' });
  assert.equal(session.planner.activities.history.length, 1);
});

test('a timed out boss retries exit only after a fresh state confirms it is still in the arena', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session, sent } = setup(t, { boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false, bossMaxMinutes: 1 });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  t.mock.timers.tick(61_000);
  session.browser.send = async (m) => { sent.push(m); if (m.t === 'boss.sair') throw Error('connection lost'); return true; };
  await session.planner.activities.run();
  t.mock.timers.tick(20_000);
  await session.planner.activities.run();
  assert.equal(sent.filter((m) => m.t === 'boss.sair').length, 1);
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  await session.planner.activities.run();
  assert.equal(sent.filter((m) => m.t === 'boss.sair').length, 2);
});

test('reconnect already outside a previous boss reconciles the attempt without overriding the current hunt', async (t) => {
  const { session, ledger } = setup(t, { boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  const restarted = setup(t, { boss: { auto: false, arena: null }, noCentro: false, huntSlug: 'other-hunt' }, ledger);
  await restarted.session.planner.activities.run();
  assert.equal(restarted.session.planner.activities.current, null);
  assert.equal(restarted.session.snapshot().planner.activities.history[0].result, 'uncertain');
  assert.equal(restarted.sent.some((m) => m.t === 'boss.entrar' || m.t === 'hunt.select'), false);
});

test('a supply purchase pending confirmation prevents starting a new activity', async (t) => {
  const { session, sent, ledger } = setup(t, { boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false });
  ledger.begin('Trainer', 'supply', 'supply-1', { cost: 100 });
  await session.planner.activities.consider();
  assert.deepEqual(sent, []);
});

test('fresh official gym ratings invalidate an apparently beneficial registration before send', async (t) => {
  const { session, sent } = setup(t, { level: 160, ginasiosPodio: { WATER: 2 } });
  session.setPlannerSettings({ autoBosses: false });
  const info = { nivelMin: 150, timeMax: 5, podeRegistrar: true, pokemonEmGinasio: { 1: 'WATER' },
    ginasios: [{ tipo: 'WATER', meuLugar: 2, souLider: false, lider: { playerId: 999, poder: 100 },
      meuTime: { poder: 10, pokemonIds: [1] } }] };
  const panel = { tipo: 'WATER', total: 2, minhaPos: 2, desafioCooldownMs: 0,
    meuTime: { poder: 10, pokemons: [{ id: 1 }] }, ranking: [
      { pos: 1, playerId: 999, poder: 100, pokemons: [] },
      { pos: 2, playerId: 1, poder: 10, pokemons: [{ id: 1 }] }] };
  session.frame({ t: 'ginasio', info, painel: panel });
  session.planner.activities.ratings = Object.fromEntries(team.map((p) => [p.id, 100]));
  session.planner.activities.ratingsAt = Date.now();
  session.browser.gymData = async () => ({ ratings: Object.fromEntries(team.map((p) => [p.id, 10])),
    casas: { 1: 2, 2: 3, 3: 1, 4: 4, 5: 0 } });
  await session.planner.activities.consider();
  assert.equal(sent.some((m) => ['ginasio.salvar', 'ginasio.desafiar'].includes(m.t)), false);
});

test('a confirmed boss victory racing with the timeout takes precedence over the requested exit', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session } = setup(t, { boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false, bossMaxMinutes: 1 });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  t.mock.timers.tick(61_000);
  await session.planner.activities.run();
  session.frame({ t: 'batalha', ev: [{ k: 'bossMorto', key: 'moltres', drops: [{ itemId: 99, nome: 'Reward', qtd: 1 }] }] });
  assert.equal(session.planner.activities.current.result, 'win');
  assert.equal(session.planner.activities.current.drops[0].quantity, 1);
});

test('the first offline boss victory is reconciled from an initially empty official counter map', async (t) => {
  const { session, ledger } = setup(t, { boss: { auto: false, arena: null, vitorias: {} } });
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' }, vitorias: {} } } });
  const restarted = setup(t, { boss: { auto: false, arena: null, vitorias: { moltres: 1 } }, noCentro: true }, ledger);
  assert.equal(restarted.session.planner.activities.current.result, 'win');
});

test('a boss is not entered until the intended primary is confirmed active', async (t) => {
  const { session, sent } = setup(t, { activeId: 2, boss: { auto: false, arena: null } });
  session.ledger.setTrainingPokemon('Trainer', 1);
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  assert.equal(sent.some((m) => m.t === 'boss.entrar'), false);
});

test('an XP event still active by server time prevents boss entry when the local clock runs ahead', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session, sent } = setup(t, { servidorAgora: 880_000,
    evento: { xpTreinadorPct: 100, xpPokemonPct: 100, terminaEm: 940_000 }, boss: { auto: false, arena: null } });
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  assert.equal(session.snapshot().planner.activities.boss.code, 'xp-event');
  assert.deepEqual(sent, []);
});

test('gym reconciliation has a deadline even while data requests remain unanswered', async (t) => {
  const { session, sent } = setup(t, { level: 160 });
  const a = { id: 'gym-old', kind: 'gym', target: 'WATER', stage: 'registered', challengerReady: true,
    at: Date.now() - 121_000, sentAt: Date.now() - 121_000 };
  session.planner.runtime.activity = a;
  session.planner.runtime.activityHistory = [{ ...a, status: 'pending' }];
  await session.planner.activities.run();
  assert.equal(session.planner.activities.current, null);
  assert.equal(session.snapshot().planner.activities.history[0].result, 'uncertain');
  assert.equal(sent.some((m) => m.t === 'ginasio.desafiar'), false);
});

test('time spent paused before entry does not consume the allowed boss fighting duration', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session, sent } = setup(t);
  session.setPlannerSettings({ autoGyms: false, bossMaxMinutes: 1 });
  await session.planner.activities.consider();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: null } } });
  session.pause();
  t.mock.timers.tick(61_000);
  session.paused = false;
  await session.planner.activities.run();
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: { key: 'moltres' } } } });
  await session.planner.activities.run();
  assert.equal(sent.filter((m) => m.t === 'boss.entrar').length, 1);
  assert.equal(sent.some((m) => m.t === 'boss.sair'), false);
});

test('an expired boss preparation is cancelled before spending a token', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { session, sent } = setup(t);
  session.setPlannerSettings({ autoGyms: false });
  await session.planner.activities.consider();
  t.mock.timers.tick(121_000);
  session.frame({ t: 'estado', estado: { boss: { auto: false, arena: null } } });
  await session.planner.activities.run();
  assert.equal(sent.some((m) => m.t === 'boss.entrar'), false);
  assert.equal(session.planner.activities.current, null);
});

test('querying unavailable gym data leaves the normal hunt tick free to continue', async (t) => {
  const { session, sent } = setup(t, { level: 160 });
  session.setPlannerSettings({ autoBosses: false });
  const handled = await session.planner.activities.consider();
  assert.deepEqual(sent, [{ t: 'ginasio.info' }]);
  assert.equal(handled, false);
});
