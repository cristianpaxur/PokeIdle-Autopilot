import assert from 'node:assert/strict';
import test from 'node:test';
import { Ledger } from '../src/ledger.mjs';
import { farmPhase, nextHunt, quoteItem } from '../src/policy.mjs';
import { Session } from '../src/session.mjs';

test('the default farm switches to Outland at unlock, while shiny uses eligible regular hunts', () => {
  const hunts = [
    { slug: 'pidgey', regiao: 'kanto', nivel: 1, especies: [{ pokeId: 16 }] },
    { slug: 'pikachu', regiao: 'kanto', nivel: 10, especies: [{ pokeId: 25 }] },
    { slug: 'ancient', regiao: 'outland', nivel: 150 },
    { slug: 'brave', regiao: 'outland', nivel: 150 },
  ];
  assert.equal(farmPhase('farm', 149), 'progression');
  assert.equal(farmPhase('farm', 150), 'outland');
  const player = { level: 150, huntSlug: 'pidgey' };
  assert.equal(nextHunt(hunts, player, { phase: 'outland' }).slug, 'ancient');
  assert.equal(nextHunt(hunts, { ...player, huntSlug: 'ancient' }, {
    phase: 'outland', blocked: new Set(['ancient']),
  }).slug, 'brave');
  assert.equal(nextHunt(hunts, { ...player, huntSlug: 'ancient' }, {
    phase: 'shiny', shinyLooks: { 25: 1 }, pinned: 'ancient',
  }).slug, 'pikachu');
});

test('prefers an effective unlocked hunt over a resistant species at the same level', () => {
  const hunts = [
    { slug: 'charmander', nivel: 20, especies: [{ pokeId: 4, pontos: 15 }] },
    { slug: 'bulbasaur', nivel: 20, especies: [{ pokeId: 1, pontos: 15 }] },
    { slug: 'squirtle', nivel: 20, especies: [{ pokeId: 7, pontos: 15 }] },
    { slug: 'diglett', nivel: 10, especies: [{ pokeId: 50, pontos: 15 }] },
    { slug: 'kakuna', nivel: 10, especies: [{ pokeId: 14, pontos: 15 }] },
  ];
  const species = { 4: { types: ['FIRE'] }, 1: { types: ['GRASS', 'POISON'] },
    7: { types: ['WATER'] }, 50: { types: ['GROUND'] }, 14: { types: ['BUG', 'POISON'] } };
  const typeChart = { FIRE: { FIRE: 0.5, WATER: 0.5, GRASS: 2 }, WATER: { GROUND: 2, FIRE: 2 } };
  assert.equal(nextHunt(hunts, { level: 22, huntSlug: 'charmander' }, {
    phase: 'progression', species, typeChart, attackTypes: ['FIRE'],
  }).slug, 'bulbasaur');
  assert.equal(nextHunt(hunts, { level: 12, huntSlug: 'kakuna' }, {
    phase: 'progression', species, typeChart, attackTypes: ['WATER'],
  }).slug, 'diglett');
});

test('progression keeps type advantage across levels and returns to a favorable lower hunt', () => {
  const hunts = [
    { slug: 'paras', nivel: 1, especies: [{ pokeId: 46 }] },
    { slug: 'metapod', nivel: 10, especies: [{ pokeId: 11 }] },
    { slug: 'pidgeotto', nivel: 20, especies: [{ pokeId: 17 }] },
    { slug: 'psyduck', nivel: 20, especies: [{ pokeId: 54 }] },
    { slug: 'gloom', nivel: 30, especies: [{ pokeId: 44 }] },
  ];
  const options = {
    phase: 'progression', ready: true, attackTypes: ['FIRE'],
    typeChart: { FIRE: { BUG: 2, GRASS: 2, WATER: 0.5 } },
    species: { 46: { types: ['BUG', 'GRASS'] }, 11: { types: ['BUG'] },
      17: { types: ['NORMAL', 'FLYING'] }, 54: { types: ['WATER'] }, 44: { types: ['GRASS', 'POISON'] } },
  };
  assert.equal(nextHunt(hunts, { level: 25, huntSlug: 'metapod' }, options), null);
  assert.equal(nextHunt(hunts, { level: 30, huntSlug: 'metapod' }, options).slug, 'gloom');
  assert.equal(nextHunt(hunts, { level: 25, huntSlug: 'psyduck' }, options).slug, 'metapod');
  assert.equal(nextHunt(hunts, { level: 30, huntSlug: 'gloom' }, {
    ...options, blocked: new Set(['gloom']),
  }).slug, 'metapod');
});

test('an item quote uses unique comparable completed sales and converts lots to unit prices', () => {
  const row = (id, bruto, qtd, extra) => ({ id, tipo: 'item', itemId: 70000, moeda: 'orb', bruto, qtd, ...extra });
  const rows = [row(1, 100, 5), row(1, 100, 5), row(2, 11, 1),
    row(3, 75, 3), row(4, 3, 1, { vendedor: 'Ash' }), row(5, 3, 1, { itemId: 70013 })];
  assert.deepEqual(quoteItem(70000, rows, ['ash']), { gems: 20, samples: 3 });
  assert.equal(quoteItem(70000, rows.slice(0, 3), []), null);
});

test('counts only confirmed bot sales in the net rate and deduplicates an item receipt', (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  ledger.bind(1, 'Ash');
  ledger.bind(2, 'Misty');
  ledger.addFarmTime('Ash', 1_800_000);
  assert.equal(ledger.metrics('Ash').netGemsPerHour, 0);
  assert.equal(ledger.begin('Ash', 'item-listing', 'item-1', { itemId: 70000, gems: 100, quantity: 1 }), true);
  ledger.finish('Ash', 'item-listing', 'item-1', 'confirmed', { listingId: 90 });
  const sale = { id: 105, anuncioId: 90, itemId: 70000, tipo: 'item', moeda: 'orb', qtd: 1,
    comprador: 'Buyer', bruto: 100, liquido: 85, em: Date.now() + 1000 };
  ledger.addSale('Ash', { ...sale, id: 106, anuncioId: 91 });
  ledger.addSale('Ash', { ...sale, comprador: 'Misty' });
  ledger.addSale('Ash', sale);
  ledger.addSale('Ash', sale);
  assert.equal(ledger.metrics('Ash').netGemsPerHour, 170);
  assert.equal(ledger.metrics('Misty').netGemsPerHour, null);
  assert.equal(ledger.operations('Ash', 'item-listing')[0].state, 'sold');
});

test('attributes a delayed receipt only to the returned listing with the exact game ID', (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  ledger.addFarmTime('Ash', 3_600_000);
  const details = { itemId: 70013, gems: 100, quantity: 1 };
  ledger.begin('Ash', 'item-listing', 'previous', details);
  ledger.finish('Ash', 'item-listing', 'previous', 'confirmed', { listingId: 20 });
  ledger.returnListing('Ash', 'previous', 'item-listing');
  ledger.begin('Ash', 'item-listing', 'next', details);
  const sale = { id: 100, anuncioId: 20, tipo: 'item', itemId: 70013, moeda: 'orb', bruto: 125,
    descricao: '1× Bicycle Fragment', em: Date.now() + 1000 };
  ledger.addSale('Ash', { ...sale, id: 101, anuncioId: 21 });
  assert.equal(ledger.metrics('Ash').netGemsPerHour, 0);
  ledger.addSale('Ash', sale);
  ledger.addSale('Ash', sale);
  assert.equal(ledger.metrics('Ash').netGemsPerHour, 106);
  assert.equal(ledger.openListings('Ash')[0].key, 'next');
});

test('farm time persists across pauses and excludes downtime and other game areas', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const session = new Session({ id: 1 }, {}, ledger, () => {});
  session.desired = true;
  session.browser = { socket: {} };
  session.frame({ t: 'welcome', hunts: [{ slug: 'ancient', nivel: 150, regiao: 'outland' }],
    estado: { nick: 'Ash', level: 150, huntSlug: 'ancient' } });
  session.sampleFarm(true);
  t.mock.timers.tick(12_000);
  session.pause();
  t.mock.timers.tick(60_000);
  session.paused = false;
  session.sampleFarm(true);
  t.mock.timers.tick(5000);
  session.frame({ t: 'estado', estado: { noCentro: true } });
  t.mock.timers.tick(20_000);
  session.disconnected();
  assert.equal(ledger.metrics('Ash').huntMs, 17_000);
});

test('progression evolves its starter from available stones and moves to Outland at 150', async (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const session = new Session({ id: 1, display: ':11', goldReserve: 0 }, {}, ledger, () => {});
  const commands = [];
  session.desired = true;
  session.browser = {
    page: { locator: () => ({ first() { return this; }, isVisible: async () => false }) },
    socket: {},
    async send(message) { commands.push(message); return true; },
  };
  const starter = { id: 10, speciesId: 4, level: 40, hp: 80, starter: true, slot: 0 };
  session.frame({ t: 'welcome', pedrasEvolucao: { FIRE: { itemId: 30 } },
    hunts: [{ slug: 'pidgey', nivel: 1, regiao: 'kanto' }, { slug: 'ancient', nivel: 150, regiao: 'outland' }],
    estado: { nick: 'Ash', activeId: 10, level: 149, huntSlug: 'pidgey', gold: 0,
      items: { 30: 1 }, pokemons: [starter] } });
  await session.tick();
  assert.deepEqual(commands, [{ t: 'pokemon.evoluir', pokemonId: 10, alvoId: 5 }]);
  session.frame({ t: 'estado', estado: { level: 150, pkMud: [{ ...starter, speciesId: 5 }] } });
  await session.tick();
  assert.deepEqual(commands.at(-1), { t: 'hunt.select', slug: 'ancient' });
  session.setMode('shiny');
  assert.equal(new Session({ id: 1 }, {}, ledger, () => {}).mode, 'shiny');
});

test('lists an Outland item at the completed-sales price, with Gems and one unit', async (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const session = new Session({ id: 1 }, {}, ledger, () => {});
  const commands = [];
  session.desired = true;
  session.browser = {
    socket: {},
    async send(message) { commands.push(message); return true; },
    async response(matches, action) {
      await action();
      const request = commands.at(-1);
      const result = request.t === 'market.meus' ? { t: 'market', aba: 'meus', linhas: [] }
        : request.t === 'market.historicoGlobal' ? {
          t: 'market', aba: 'historicoGlobal', seq: request.seq, linhas: [90, 100, 110].map((bruto, id) => ({
            id, bruto, qtd: 1, tipo: 'item', itemId: 70000, moeda: 'orb',
          })),
        } : { t: 'market', aba: 'criado', id: 200 };
      return matches(result) ? result : null;
    },
  };
  session.frame({ t: 'welcome', mercado: { maxAnunciosItens: 20, precoMinOrb: 1 },
    estado: { nick: 'Ash', level: 150, items: { 70000: 3, 30: 20 } } });
  await session.market();
  assert.deepEqual(commands.at(-1), {
    t: 'market.criar', tipo: 'item', itemId: 70000, qtd: 1, preco: 100, moeda: 'orb', dias: null,
  });
  assert.equal(ledger.operations('Ash', 'item-listing')[0].state, 'confirmed');
});
