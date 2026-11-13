import assert from 'node:assert/strict';
import test from 'node:test';
import { Ledger } from '../src/ledger.mjs';
import { Session } from '../src/session.mjs';
import { createDashboard } from '../src/dashboard.mjs';

function setup(t, extra = {}) {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const session = new Session({ id: 1, display: ':11', goldReserve: 10000, marketEnabled: false }, {}, ledger, () => {});
  const commands = [];
  session.desired = true;
  session.browser = { socket: {},
    page: { locator: () => ({ first() { return this; }, isVisible: async () => false }) },
    send: async (message) => { commands.push(message); return true; } };
  session.frame({ t: 'welcome', pedrasEvolucao: { FIRE: { itemId: 30, nome: 'Fire Stone' } },
    itensNossos: [{ id: 1, name: 'Potion', category: 'heal', npcPrice: 100, healAmount: 60 },
      { id: 2, name: 'Revive', category: 'revive', npcPrice: 200 }],
    hunts: [{ slug: 'charmander', nivel: 20, regiao: 'kanto', especies: [{ pokeId: 4, pontos: 10 }] },
      { slug: 'metapod', nivel: 10, regiao: 'kanto', especies: [{ pokeId: 11, pontos: 10 }] }],
    estado: { nick: 'Ash', activeId: 10, level: 57, gold: 14000, huntSlug: 'metapod', xp: 2000,
      items: { 1: 0, 2: 4, 30: 0 },
      automation: { autoPotion: true, autoRevive: true, autoVoltarHunt: true, hpLimiar: 0.5, potionIds: [1], reviveIds: [2] },
      pokemons: [{ id: 10, nome: 'Charmander', speciesId: 4, level: 57, hp: 100, maxHp: 100, slot: 0, xp: 5000 }],
      ...extra } });
  return { session, ledger, commands };
}

test('planner settings survive a new session and reject invalid changes without losing valid options', (t) => {
  const { session, ledger } = setup(t);
  assert.equal(typeof session.setPlannerSettings, 'function');
  session.setPlannerSettings({ goldReserve: 7000, autoPotions: false });
  const restarted = new Session({ id: 1 }, {}, ledger, () => {});
  assert.equal(restarted.planner.settings.goldReserve, 7000);
  assert.equal(restarted.planner.settings.autoPotions, false);
  assert.throws(() => session.setPlannerSettings({ goldReserve: -1 }), { status: 400 });
  assert.equal(session.planner.settings.goldReserve, 7000);
});

test('a supply purchase reserves the budget before send, is confirmed by the game and is never duplicated while pending', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session, ledger, commands } = setup(t);
  await session.tick();
  assert.deepEqual(commands[0], { t: 'shop.buy', kind: 'item', id: 1, qty: 12 });
  assert.equal(ledger.pending('Ash', 'supply'), true);
  assert.equal(ledger.supplySpent('Ash'), 1200);
  session.frame({ t: 'batalha', ev: [{ k: 'compra', nome: 'Potion', qtd: 12, gasto: 1200 }] });
  assert.equal(ledger.pending('Ash', 'supply'), false);
  assert.equal(ledger.operations('Ash', 'supply')[0].state, 'confirmed');
  assert.equal(session.snapshot().planner.lastAction.status, 'confirmed');
});

test('an unacknowledged supply purchase stays reserved across reconnects and a fresh planner', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session, ledger, commands } = setup(t);
  await session.tick();
  assert.equal(ledger.pending('Ash', 'supply'), true);
  const restarted = new Session({ id: 1 }, {}, ledger, () => {});
  assert.equal(restarted.planner.spent(), 1200);
  t.mock.timers.tick(30_000);
  await session.planner.buySupplies();
  assert.equal(commands.filter((x) => x.t === 'shop.buy').length, 1);
});

test('stone hunting bypasses XP preference and returns to evolution once the drop arrives', async (t) => {
  const { session, commands } = setup(t, { items: { 1: 20, 2: 4, 30: 0 } });
  assert.ok(session.planner);
  session.planner.species = { 4: { name: 'Charmander', types: ['FIRE'], evolvesTo: 5, evolveLevel: 40 },
    5: { name: 'Charmeleon', types: ['FIRE'] }, 11: { name: 'Metapod', types: ['BUG'] } };
  session.planner.refresh();
  assert.equal(session.planner.route.slug, 'charmander');
  assert.equal(session.snapshot().planner.decision.code, 'stone');
  session.frame({ t: 'estado', estado: { items: { 1: 20, 2: 4, 30: 1 } } });
  session.planner.refresh();
  await session.trainPokemon(session.state.player);
  assert.deepEqual(commands.at(-1), { t: 'pokemon.evoluir', pokemonId: 10, alvoId: 5 });
});

test('a timed XP event can defer stone hunting and its expiry restores the resource objective', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session } = setup(t, { items: { 1: 20, 2: 4, 30: 0 },
    evento: { xpTreinadorPct: 50, xpPokemonPct: 50, terminaEm: 160_000 } });
  assert.ok(session.planner);
  session.planner.species = { 4: { types: ['FIRE'], evolvesTo: 5, evolveLevel: 40 }, 5: { types: ['FIRE'] } };
  session.planner.refresh();
  assert.equal(session.planner.route, null);
  assert.equal(session.snapshot().planner.decision.code, 'event-xp');
  t.mock.timers.tick(61_000);
  session.planner.refresh();
  assert.equal(session.planner.route.slug, 'charmander');
});

test('a paused account never buys supplies or evolves', async (t) => {
  const { session, commands } = setup(t);
  session.pause();
  await session.tick();
  assert.deepEqual(commands, []);
  assert.equal(session.ledger.paused(1), true);
});

test('free healing does not inflate potion stock targets', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session } = setup(t, { items: { 1: 20, 2: 4, 30: 0 } });
  session.frame({ t: 'batalha', ev: Array.from({ length: 20 }, () => ({ k: 'cura' })) });
  session.planner.refresh();
  assert.equal(session.planner.supply.stocks.find((stock) => stock.category === 'heal').target, 12);
  session.frame({ t: 'batalha', ev: [{ k: 'cura', itemId: 1 }, { k: 'cura', itemId: 1 }] });
  session.planner.refresh();
  assert.equal(session.planner.supply.stocks.find((stock) => stock.category === 'heal').target, 20);
});

test('stone search time is bounded and its cooldown survives a new session', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session, ledger } = setup(t, { items: { 1: 20, 2: 4, 30: 0 }, huntSlug: 'charmander' });
  session.planner.species = { 4: { types: ['FIRE'], evolvesTo: 5, evolveLevel: 40 }, 5: { types: ['FIRE'] } };
  session.setPlannerSettings({ stoneMinutes: 1 });
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(20_000); session.planner.refresh(); }
  assert.equal(session.planner.route, null);
  assert.equal(session.planner.decision.code, 'xp');
  // A missing NPC item must not hide why the stone hunt stopped.
  session.state.items = session.state.items.filter((item) => item.category !== 'revive');
  session.planner.refresh();
  assert.match(session.planner.decision.reason, /A tentativa de obter a pedra terminou/);
  assert.match(session.planner.decision.reason, /Sem opção de compra para repor revives/);
  const restarted = new Session({ id: 1 }, {}, ledger, () => {});
  restarted.state = session.state;
  restarted.online = true; restarted.desired = true; restarted.browser = session.browser;
  restarted.planner.species = session.planner.species;
  restarted.planner.refresh();
  assert.equal(restarted.planner.route, null);
});

test('stone routes are blocked by faint events even when the game already reported the Center', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session } = setup(t, { items: { 1: 20, 2: 4, 30: 0 }, huntSlug: 'charmander' });
  session.planner.species = { 4: { types: ['FIRE'], evolvesTo: 5, evolveLevel: 40 }, 5: { types: ['FIRE'] } };
  session.planner.refresh();
  assert.equal(session.planner.route.slug, 'charmander');
  session.frame({ t: 'estado', estado: { noCentro: true } });
  session.frame({ t: 'batalha', ev: [{ k: 'morte', quem: 'jogador' }, { k: 'morte', quem: 'jogador' }] });
  session.frame({ t: 'estado', estado: { noCentro: false } });
  session.planner.refresh();
  assert.equal(session.planner.route, null);
});

test('the optimizer does not reuse measurements after a temporary event expires', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session } = setup(t, { items: { 1: 20, 2: 4, 30: 0 },
    evento: { xpTreinadorPct: 50, xpPokemonPct: 50, terminaEm: 200_000 } });
  session.setPlannerSettings({ farmStones: false });
  session.observeOptimization();
  session.optimizer.choose([{ slug: 'metapod', nivel: 10 }], session.state.player);
  session.observeOptimization();
  t.mock.timers.tick(90_000);
  session.frame({ t: 'estado', estado: { xp: 2090 } });
  session.optimizer.choose([{ slug: 'metapod', nivel: 10 }], session.state.player);
  assert.equal(session.optimizer.snapshot().ranking.length, 1);
  t.mock.timers.tick(11_000);
  session.observeOptimization();
  assert.equal(session.optimizer.snapshot().ranking.length, 0);
});

test('a stone route does not inherit another route\'s faints', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const { session } = setup(t, { items: { 1: 20, 2: 4, 30: 0 }, huntSlug: 'charmander' });
  session.state.hunts.push({ slug: 'growlithe', nivel: 30, regiao: 'kanto', especies: [{ pokeId: 58 }] });
  session.planner.species = { 4: { types: ['FIRE'], evolvesTo: 5, evolveLevel: 40 }, 58: { types: ['FIRE'] } };
  session.planner.refresh();
  session.frame({ t: 'batalha', ev: [{ k: 'morte', quem: 'jogador' }, { k: 'morte', quem: 'jogador' }] });
  session.planner.refresh();
  assert.equal(session.planner.route.slug, 'growlithe');
  session.frame({ t: 'estado', estado: { huntSlug: 'growlithe' } });
  session.planner.refresh();
  session.frame({ t: 'batalha', ev: [{ k: 'morte', quem: 'jogador' }] });
  session.planner.refresh();
  assert.equal(session.planner.route?.slug, 'growlithe');
});

test('planner API accepts same-origin JSON but rejects malformed and oversized options', async (t) => {
  const { session } = setup(t);
  const dashboard = createDashboard({ snapshot: () => ({ profiles: [] }),
    command: (_id, action, value) => action === 'planner' ? { settings: session.setPlannerSettings(value) } : null });
  await new Promise((resolve) => dashboard.server.listen(0, '127.0.0.1', resolve));
  t.after(() => dashboard.close());
  const url = `http://127.0.0.1:${dashboard.server.address().port}`;
  const post = (body, origin = url) => fetch(`${url}/api/profiles/1/planner`, { method: 'POST',
    headers: { Origin: origin, 'X-IdleBot': '1', 'Content-Type': 'application/json' }, body });
  assert.equal((await post('{"stockMinutes":15}')).status, 200);
  assert.equal((await post('{"stockMinutes":-1}')).status, 400);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(' '.repeat(9000))).status, 413);
  assert.equal((await post('{}', 'https://elsewhere.example')).status, 403);
});
