import assert from 'node:assert/strict';
import test from 'node:test';
import { Ledger } from '../src/ledger.mjs';
import { Session } from '../src/session.mjs';

const now = 1_800_000_000_000;
function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now });
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const session = new Session({ id: 1, marketEnabled: false, display: ':11' }, {}, ledger, () => {});
  const sent = [];
  const browser = { socket: {}, page: { locator: () => ({ first() { return this; }, isVisible: async () => false }) },
    send: async (message) => { sent.push(message); return true; },
    strategyData: async () => ({ pass: { day: 20833, nivelMin: 10, degrau: 1, jaPegouHoje: true, vipPendenteHoje: false },
      ratings: { 1: { power: 100, usable: true }, 2: { power: 400, usable: true } } }) };
  session.browser = browser;
  session.desired = true;
  session.frame({ t: 'welcome', bicicletas: { raridades: [{ id: 'rara', velocidade: 0.5 }] },
    estado: { nick: 'Trainer', activeId: 1, level: 150, gold: 0, huntSlug: 'forest', xp: 0,
      bicicleta: { equipada: null, lista: [{ id: 9, rar: 'rara' }], trocaLiberaEm: 0 },
      items: {}, passe: { ultimo: 20833, degrau: 1 }, automation: {},
      pokemons: [{ id: 1, speciesId: 4, nome: 'Charmander', slot: 0, level: 150, hp: 100, maxHp: 100, tipos: ['FIRE'], xp: 0 },
        { id: 2, speciesId: 5, nome: 'Charmeleon', slot: 1, level: 150, hp: 100, maxHp: 100, tipos: ['FIRE'], xp: 0 }] },
    hunts: [{ slug: 'forest', nivel: 100, especies: [{ pokeId: 11 }] }], tabelaTipos: { FIRE: { BUG: 2 }, BUG: { FIRE: 0.5 } },
  });
  session.planner.species = { 11: { types: ['BUG'] } };
  session.setPlannerSettings({ autoEvolve: false, autoPotions: false, autoRevives: false, autoGyms: false, autoBosses: false, autoTeam: false });
  return { session, ledger, sent, browser, strategy: session.planner.strategy };
}

test('an upgrade intent is persisted before send and confirmed only by a relevant state update', async (t) => {
  const { strategy, session, ledger, browser, sent } = setup(t);
  assert.ok(strategy, 'the account has a strategy coordinator');
  const send = browser.send;
  browser.send = async (message) => {
    assert.equal(ledger.operations('Trainer', 'strategy')[0].state, 'pending');
    return send(message);
  };
  assert.equal(await strategy.run(), true);
  assert.deepEqual(sent, [{ t: 'bicicleta.equipar', bicicletaId: 9 }]);
  session.frame({ t: 'estado', estado: { gold: 100 } });
  assert.equal(strategy.pending().state, 'pending');
  assert.equal(await strategy.run(), false);
  session.frame({ t: 'estado', estado: { bicicleta: { ...session.state.player.bicicleta, equipada: 9, equipadaRar: 'rara' } } });
  assert.equal(strategy.pending(), undefined);
  assert.equal(ledger.operations('Trainer', 'strategy')[0].state, 'confirmed');
  assert.equal(strategy.snapshot().history[0].status, 'confirmed');
});

test('an unconfirmed upgrade survives restart and stale unrelated frames cannot cause a resend', async (t) => {
  const { strategy, session, ledger, sent, browser } = setup(t);
  assert.ok(strategy);
  await strategy.run();
  const restarted = new Session({ id: 1 }, {}, ledger, () => {});
  restarted.state = session.state;
  restarted.online = true; restarted.desired = true; restarted.browser = browser;
  t.mock.timers.tick(130_000);
  restarted.frame({ t: 'estado', estado: { gold: 200 } });
  assert.equal(await restarted.planner.strategy.run(), false);
  assert.equal(sent.length, 1);
  assert.equal(restarted.planner.strategy.pending().state, 'uncertain');
  restarted.frame({ t: 'estado', estado: { bicicleta: session.state.player.bicicleta } });
  assert.equal(restarted.planner.strategy.pending(), undefined);
  assert.equal(ledger.operations('Trainer', 'strategy')[0].state, 'unverified');
  assert.equal(await restarted.planner.strategy.run(), false, 'rejected upgrade waits before retry');
});

test('pause or a new welcome during official rule loading invalidates the prepared action', async (t) => {
  const { strategy, session, browser, sent } = setup(t);
  assert.ok(strategy);
  const data = await browser.strategyData();
  browser.strategyData = async () => { session.pause(); return data; };
  assert.equal(await strategy.run(), false);
  assert.deepEqual(sent, []);
  session.paused = false;
  strategy.reset();
  browser.strategyData = async () => { session.state.consume({ t: 'welcome', estado: { nick: 'Trainer', activeId: 1 } }); return data; };
  assert.equal(await strategy.run(), false);
  assert.deepEqual(sent, []);
});

test('a confirmed principal change updates training once and resets route comparison', async (t) => {
  const { strategy, session, ledger, sent } = setup(t);
  assert.ok(strategy);
  session.setPlannerSettings({ autoEquipment: false, autoTeam: true });
  ledger.setTrainingPokemon('Trainer', 1);
  await strategy.run();
  assert.deepEqual(sent, [{ t: 'team.active', pokemonId: 2 }]);
  assert.equal(ledger.trainingPokemon('Trainer'), 1);
  session.frame({ t: 'estado', estado: { activeId: 2 } });
  assert.equal(ledger.trainingPokemon('Trainer'), 2);
  assert.equal(session.due.hunt, 0);
  assert.equal(await strategy.run(), false);
  assert.equal(sent.length, 1);
});

test('false send and unknown transport failures have distinct retry behavior', async (t) => {
  const { strategy, browser, ledger } = setup(t);
  assert.ok(strategy);
  browser.send = async () => false;
  assert.equal(await strategy.run(), false);
  assert.equal(strategy.pending(), undefined);
  assert.equal(ledger.operations('Trainer', 'strategy')[0].state, 'failed');
  t.mock.timers.tick(16 * 60_000);
  browser.send = async () => { throw new Error('Disconnected'); };
  assert.equal(await strategy.run(), true);
  assert.equal(strategy.pending().state, 'uncertain');
});

test('boss activity and paused profiles never send strategic commands', async (t) => {
  const { strategy, session, sent } = setup(t);
  assert.ok(strategy);
  session.state.player.boss = { arena: { key: 'boss' } };
  assert.equal(await strategy.run(), false);
  session.state.player.boss = null;
  session.pause();
  assert.equal(await strategy.run(), false);
  assert.deepEqual(sent, []);
});

test('market checks strategic stock again after the asynchronous quote', async (t) => {
  const { session, sent } = setup(t);
  session.setPlannerSettings({ autoBosses: true, bossTokenReserve: 1 });
  session.state.bosses = [{ minNivelTreinador: 300, entrada: { itemId: 70000, qtd: 1 } }];
  session.state.player.level = 300;
  session.state.outlandItems = [70000];
  session.state.player.items[70000] = 2;
  let quotes = 0;
  session.itemValuation = async () => { quotes++; session.state.player.items[70000] = 2; return { gems: 10, net: 8, samples: 3 }; };
  await session.listOutlandItem('Trainer', []);
  assert.equal(quotes, 0, 'the reserved pair must not be quoted for sale');
  session.state.player.items[70000] = 3;
  await session.listOutlandItem('Trainer', []);
  assert.equal(quotes, 1);
  assert.deepEqual(sent, []);
  assert.equal(session.ledger.operations('Trainer', 'item-listing').length, 0);
});

test('a consumed egg is not retried after an ambiguous state and a placement receipt resolves it', async (t) => {
  const { strategy, session, browser, sent } = setup(t);
  session.setPlannerSettings({ autoEquipment: false, autoTeam: false });
  session.state.player.items = { 70091: 1 };
  session.state.player.chocadeira = { total: 1, ovos: [] };
  const rules = await browser.strategyData();
  browser.strategyData = async () => ({ ...rules, incubation: { total: 1, ovos: [],
    catalog: [{ id: 'p2', itemId: 70091, potencia: 2, horas: 6 }] } });
  await strategy.run();
  assert.deepEqual(sent, [{ t: 'chocadeira.colocar', slot: 0, ovo: 'p2' }]);
  t.mock.timers.tick(130_000);
  session.frame({ t: 'estado', estado: { items: {}, chocadeira: { total: 1, ovos: [] } } });
  assert.equal(strategy.pending().state, 'uncertain');
  assert.equal(await strategy.run(), false);
  assert.equal(sent.length, 1);
  session.frame({ t: 'batalha', ev: [{ k: 'ovoColocado', slot: 0, ovo: 'p2', fim: now + 21_600_000 }] });
  assert.equal(strategy.pending(), undefined);
  assert.equal(strategy.snapshot().history[0].status, 'confirmed');
});

test('first-house fabrication confirms a new owned house rather than only a reduction of fragments', async (t) => {
  const { strategy, session, sent } = setup(t);
  session.setPlannerSettings({ autoEquipment: false, autoTeam: false });
  session.state.houses = { fragmento: { itemId: 70011, custo: 10 }, raridades: [] };
  session.state.player.casa = { lista: [] };
  session.state.player.items = { 70011: 10 };
  await strategy.run();
  assert.deepEqual(sent, [{ t: 'casa.fabricar' }]);
  session.frame({ t: 'estado', estado: { items: {} } });
  assert.ok(strategy.pending());
  session.frame({ t: 'estado', estado: { casa: { lista: [{ id: 99, rar: 'comum', emUso: true, postos: [null] }] } } });
  assert.equal(strategy.pending(), undefined);
});

test('the normal session loop executes the strategic upgrade before optional activities', async (t) => {
  const { session, sent } = setup(t);
  session.trainPokemon = async () => false;
  session.planner.activities.consider = async () => { throw Error('An activity ran before the improvement'); };
  await session.runTick();
  assert.deepEqual(sent, [{ t: 'bicicleta.equipar', bicicletaId: 9 }]);
});

test('a browser failure after the server confirmation cannot downgrade a completed action', async (t) => {
  const { strategy, session, browser, ledger } = setup(t);
  browser.send = async () => {
    session.frame({ t: 'estado', estado: { bicicleta: { ...session.state.player.bicicleta, equipada: 9, equipadaRar: 'rara' } } });
    throw Error('Browser closed after receiving the server state');
  };
  await strategy.run();
  assert.equal(ledger.operations('Trainer', 'strategy')[0].state, 'confirmed');
  assert.equal(strategy.pending(), undefined);
  assert.equal(session.planner.runtime.lastAction.status, 'confirmed');
});

test('an explicit strategy error releases only its matching action and persists the retry interval', async (t) => {
  const { strategy, session, ledger } = setup(t);
  await strategy.run();
  session.frame({ t: 'erro', chave: 'market.semOuro' });
  assert.ok(strategy.pending());
  session.frame({ t: 'erro', chave: 'bicicleta.trocaEspera' });
  assert.equal(strategy.pending(), undefined);
  assert.equal(ledger.operations('Trainer', 'strategy')[0].state, 'rejected');
});

test('an unresolved intent triggers a bounded resynchronization without resending the action', async (t) => {
  const { strategy, session, browser, sent } = setup(t);
  let reloads = 0;
  browser.page.reload = async () => {};
  session.reloadGame = async () => { reloads++; };
  await strategy.run();
  t.mock.timers.tick(130_000);
  await strategy.run();
  assert.equal(reloads, 1);
  await strategy.run();
  assert.equal(reloads, 1);
  assert.equal(sent.length, 1);
  session.pause();
  t.mock.timers.tick(600_000);
  await strategy.run();
  assert.equal(reloads, 1);
});

test('the session drains known reward windows and never dismisses them during manual control', async (t) => {
  const { session, strategy, browser, sent } = setup(t);
  const closed = [];
  browser.dismissStrategyReward = async (reward, canAct) => { if (!canAct()) return false; closed.push(reward.kind); return true; };
  session.frame({ t: 'batalha', ev: [{ k: 'casaFabricada', casaId: 99, raridade: 'comum' }] });
  await session.runTick();
  assert.deepEqual(closed, ['house']);
  assert.deepEqual(sent, []);
  session.pause();
  session.frame({ t: 'passe', resgate: { degrau: 1, premios: [] } });
  t.mock.timers.tick(600_000);
  assert.equal(await strategy.dismissRewards(), false);
  assert.deepEqual(closed, ['house']);
  session.paused = false;
  assert.equal(await strategy.dismissRewards(), true, 'a delayed receipt survives a long manual pause');
  assert.deepEqual(closed, ['house', 'pass']);
});

test('an obsolete evolution intent does not block independent account improvements', async (t) => {
  const { session, strategy, sent } = setup(t);
  session.planner.runtime.evolution = { pokemonId: 1, to: 5, at: now - 3_600_000 };
  session.planner.persist();
  assert.equal(await strategy.run(), true);
  assert.deepEqual(sent, [{ t: 'bicicleta.equipar', bicicletaId: 9 }]);
});

test('a recent evolution delays team changes only until its confirmation window expires', async (t) => {
  const { session, strategy, sent } = setup(t);
  session.setPlannerSettings({ autoEquipment: false, autoTeam: true });
  session.state.houses = { maxEmUso: 5, raridades: [{ id: 'comum', bonecos: 1, xpShare: 0.1 }] };
  session.state.xpShareHeld = { itemId: 70050, pct: 5 };
  session.state.player.casa = { lista: [{ id: 91, rar: 'comum', emUso: true, postos: [null] }] };
  session.state.player.items = { 70050: 1 };
  session.planner.runtime.evolution = { pokemonId: 1, to: 5, at: now };
  assert.equal(await strategy.run(), false);
  assert.deepEqual(sent, [], 'the candidate stays free for promotion instead of being assigned to passive XP');
  t.mock.timers.tick(121_000);
  assert.equal(await strategy.run(), true);
  assert.deepEqual(sent, [{ t: 'team.active', pokemonId: 2 }]);
});

test('a full snapshot releases an ambiguous consumption while quarantining that spending domain', async (t) => {
  const { strategy, session, browser, sent } = setup(t);
  session.setPlannerSettings({ autoEquipment: false });
  session.state.player.items = { 70091: 1 };
  session.state.player.chocadeira = { total: 1, ovos: [] };
  const rules = await browser.strategyData();
  browser.strategyData = async () => ({ ...rules, incubation: { total: 1, ovos: [],
    catalog: [{ id: 'p2', itemId: 70091, potencia: 2, horas: 6 }] } });
  await strategy.run();
  t.mock.timers.tick(130_000);
  session.frame({ t: 'estado', estado: { ...structuredClone(session.state.player), cheio: true,
    items: {}, chocadeira: { total: 1, ovos: [] } } });
  assert.equal(strategy.pending(), undefined);
  assert.equal(strategy.snapshot().history[0].status, 'unverified');
  session.frame({ t: 'estado', estado: { items: { 70091: 1 } } });
  assert.equal(await strategy.run(), false, 'new stock cannot repeat ambiguous spending');
  session.setPlannerSettings({ autoEquipment: true });
  assert.equal(await strategy.run(), true, 'independent equipment upgrade remains available');
  assert.deepEqual(sent.map(({ t }) => t), ['chocadeira.colocar', 'bicicleta.equipar']);
});
