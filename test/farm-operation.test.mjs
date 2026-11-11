import test from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.mjs';
import { GameState } from '../src/game-state.mjs';
import { Session } from '../src/session.mjs';
import * as policy from '../src/policy.mjs';

test('farm telemetry counts verified drops, eligible encounters and consumed supplies', () => {
  const state = new GameState();
  state.consume({
    t: 'welcome', estado: { huntSlug: 'route' },
    hunts: [{ slug: 'route', especies: [{ pokeId: 4, nome: 'Charmander' }] }],
    shinyLooks: { 4: 123 }, catalogoBolas: [{ id: 1, priceGold: 25 }],
    itensNossos: [{ id: 2, npcPrice: 40 }],
  }, 1000);
  const events = [
    { k: 'spawn', pokeId: 4, nome: 'Charmander' },
    { k: 'morte', quem: 'selvagem', nome: 'Charmander', drops: [{ itemId: 70000, qtd: 2 }, { itemId: 5, qtd: 9 }] },
    { k: 'bola', ballId: 1 }, { k: 'cura', itemId: 2 },
    { k: 'morte', quem: 'jogador' },
  ];
  const stats = state.farmEvents(events);
  assert.deepEqual(stats, { kills: 1, drops: 2, encounters: 1, balls: 1, supplyGold: 65, faints: 1 });
  state.consume({ t: 'batalha', ev: events }, 2000);
  assert.equal(state.lastProgressAt, 2000);
  state.consume({ t: 'batalha', ev: [{ k: 'ataque' }] }, 2500);
  assert.equal(state.lastProgressAt, 2000);
  assert.equal(state.lastFrameAt, 2500);
});

test('periods keep time and activity separate by account, mode and route', (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const now = 20 * 86_400_000;
  ledger.recordFarm('one', 'shiny', 'a', { huntMs: 180_000, encounters: 50, balls: 30, supplyGold: 300 }, now - 1000);
  ledger.recordFarm('one', 'shiny', 'a', { huntMs: 180_000, encounters: 50, balls: 20 }, now - 2000);
  ledger.recordFarm('one', 'outland', 'a', { huntMs: 360_000, drops: 3 }, now - 2 * 86_400_000);
  ledger.recordFarm('two', 'shiny', 'a', { huntMs: 5000 }, now - 1000);
  const { today, week } = ledger.farmPeriods('one', now);
  assert.equal(today.shiny.huntMs, 360_000);
  assert.equal(today.shiny.encounters, 100);
  assert.equal(today.shiny.balls, 50);
  assert.equal(today.outland.huntMs, 0);
  assert.equal(week.outland.drops, 3);
  assert.equal(ledger.farmRoutes('one', 'shiny', now)[0].supplyGold, 300);
  assert.equal(ledger.metrics('one', now).huntMs, 720_000);
});

test('tests a new Outland tier, then favors measured drops with sustainable costs', () => {
  const routes = [{ slug: 'low', nivel: 150 }, { slug: 'high', nivel: 1000 }];
  const samples = [{ slug: 'low', huntMs: 1_200_000, drops: 4, supplyGold: 100, faints: 0 }];
  assert.equal(policy.pickFarmHunt('outland', routes, samples, 'low').slug, 'high');
  samples.push({ slug: 'high', huntMs: 1_200_000, drops: 1, supplyGold: 400, faints: 1 });
  assert.equal(policy.pickFarmHunt('outland', routes, samples, 'high').slug, 'low');
  assert.equal(policy.pickFarmHunt('shiny', routes, [
    { slug: 'low', huntMs: 360_000, encounters: 60, supplyGold: 300 },
    { slug: 'high', huntMs: 360_000, encounters: 40, supplyGold: 600 },
  ], 'high').slug, 'low');
});

test('stalled hunts retry the route, then move to a safe route before reloading', async (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const session = new Session({ id: 1 }, {}, ledger, () => {});
  session.account = 'one';
  session.online = session.desired = true;
  const commands = [];
  session.browser = { socket: {}, send: (payload) => commands.push(payload), page: {
    reload: async () => commands.push('reload'),
  } };
  session.state.consume({ t: 'welcome', estado: { huntSlug: 'a', activeId: 1, level: 15 },
    hunts: [{ slug: 'a', nivel: 12 }, { slug: 'b', nivel: 5 }] }, 1000);
  assert.equal(await session.recoverFarm(120_000), false);
  assert.equal(await session.recoverFarm(182_000), true);
  assert.deepEqual(commands[0], { t: 'hunt.select', slug: 'a' });
  assert.equal(await session.recoverFarm(200_000), true);
  assert.equal(commands.length, 1);
  assert.equal(await session.recoverFarm(230_000), true);
  assert.deepEqual(commands[1], { t: 'hunt.select', slug: 'b' });
  assert.equal(await session.recoverFarm(300_000), true);
  assert.equal(commands[2], 'reload');
  assert.equal(session.snapshot().attention.kind, 'recovering');
});

test('market floor defers a tracked offer and surfaces its reason', () => {
  assert.equal(policy.listingDecision(null, 8).code, 'comparables');
  assert.equal(policy.listingDecision({ gems: 7, net: 5 }, 8).code, 'below-floor');
  assert.equal(policy.listingDecision({ gems: 8, net: 6 }, 8).code, 'ready');
});

test('Outland stock uses recent comparable prices and shows unpriced units', (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const session = new Session({ id: 1 }, {}, ledger, () => {});
  session.account = 'one';
  session.online = true;
  session.state.consume({ t: 'welcome', estado: { items: { 70000: 3, 70011: 2 } },
    itensNossos: [{ id: 70000, name: 'Bronze Boss Token' }] });
  ledger.saveItemQuote('one', 70000, { valuation: { gems: 12 }, decision: { code: 'ready' } });
  const { itemStock } = session.snapshot();
  assert.equal(itemStock.gems, 36);
  assert.equal(itemStock.unpriced, 2);
  assert.equal(itemStock.items[0].name, 'Bronze Boss Token');
});

test('only reprices a tracked stale offer with comparables above the floor', async (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const now = Date.now();
  ledger.begin('one', 'item-listing', 'local-key', { itemId: 70000, gems: 20, quantity: 1 });
  ledger.finish('one', 'item-listing', 'local-key', 'confirmed', { listingId: 5 });
  const session = new Session({ id: 1, repriceAfterHours: 2, minListingGems: 8 }, {}, ledger, () => {});
  session.account = 'one';
  session.online = session.desired = true;
  session.state.consume({ t: 'welcome', estado: { level: 150 } });
  const commands = [];
  session.browser = { socket: {}, send: (payload) => commands.push(payload) };
  session.itemValuation = async () => ({ gems: 6, net: 5 });
  const rows = [{ id: 5, tipo: 'item', itemId: 70000, preco: 20, moeda: 'orb', qtd: 1 }];
  assert.equal(await session.reviewListings(rows, now + 3 * 3_600_000), false);
  assert.deepEqual(commands, []);
  session.itemValuation = async () => ({ gems: 12, net: 10 });
  assert.equal(await session.reviewListings(rows, now + 10 * 3_600_000), true);
  assert.deepEqual(commands, [{ t: 'market.cancelar', id: 5 }]);
  assert.equal(await session.reviewListings(rows, now + 10 * 3_600_000 + 1000), false);
  assert.equal(ledger.openListings('one')[0].state, 'confirmed');
});
