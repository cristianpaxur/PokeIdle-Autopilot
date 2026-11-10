import assert from 'node:assert/strict';
import test from 'node:test';
import { Ledger } from '../src/ledger.mjs';
import { Session } from '../src/session.mjs';

function sale(pokemonId, extra = {}) {
  return {
    id: 100 + pokemonId, pokemonId, tipo: 'pokemon', moeda: 'orb', bruto: 100, liquido: 87,
    em: Date.now() + 1000, comprador: 'Buyer', ...extra,
  };
}

function openSession(ledger, id, nick, history, listings = () => []) {
  const session = new Session({ id, display: ':11', marketEnabled: true, withdrawal: { enabled: false } }, {}, ledger, () => {});
  const requests = [];
  let request;
  session.desired = true;
  session.browser = {
    page: { locator: () => ({ first() { return this; }, isVisible: async () => false }) },
    socket: {},
    async send(message) { request = message; requests.push(message.t); return true; },
    async response(matches, action) {
      request = undefined;
      if (await action() === false) return null;
      const result = request.t === 'market.historico'
        ? { t: 'market', aba: 'historico', seq: request.seq, pagina: request.pagina, ...history(request.pagina) }
        : { t: 'market', aba: 'meus', linhas: listings() };
      return matches(result) ? result : null;
    },
  };
  session.frame({ t: 'welcome', estado: { nick, activeId: 100, gold: 0 } });
  return { session, requests };
}

test('stops only the account with 20 confirmed Pokémon sold by the bot and keeps it stopped after restart', async (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  let rows = [];
  const { session, requests } = openSession(ledger, 1, 'Ash', (page) => ({
    linhas: rows.slice(page * 10, page * 10 + 10), total: rows.length, porPagina: 10,
  }));
  const { session: other } = openSession(ledger, 2, 'Misty', () => ({ linhas: [] }));
  for (let id = 1; id <= 20; id++) {
    assert.equal(ledger.begin('Ash', 'listing', String(id), { gems: 100 }), true);
    ledger.finish('Ash', 'listing', String(id), 'confirmed');
  }
  rows = [...Array.from({ length: 19 }, (_, index) => sale(index + 1)), sale(1), sale(21),
    sale(20, { comprador: 'Misty' }), sale(20, { em: 10 }), sale(20, { tipo: 'item' })];
  await session.tick();
  assert.equal(session.snapshot().mission.sold, 19);
  assert.equal(session.desired, true);
  assert.equal(other.snapshot().mission.sold, 0);

  rows.unshift(sale(20));
  session.due = {};
  requests.length = 0;
  await session.tick();
  assert.equal(session.snapshot().mission.sold, 20);
  assert.equal(session.status, 'completed');
  assert.equal(session.desired, false);
  assert.equal(other.desired, true);
  assert.ok(requests.every((type) => type === 'market.historico'));

  const restarted = new Session({ id: 1 }, {}, ledger, () => {});
  await restarted.start();
  assert.equal(restarted.snapshot().status, 'completed');
  assert.equal(restarted.desired, false);
});

test('reserves each unsold listing and releases it when the game has returned the Pokémon', (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  ledger.addCapture('Ash', { id: 14, name: 'Pikachu' });
  assert.equal(ledger.begin('Ash', 'listing', '14', { gems: 100 }), true);
  ledger.finish('Ash', 'listing', '14', 'confirmed');
  assert.equal(ledger.mission('Ash').open, 1);
  assert.equal(ledger.nextCandidate('Ash', Date.now()), null);
  ledger.returnListing('Ash', '14');
  assert.equal(ledger.mission('Ash').open, 0);
  assert.equal(ledger.nextCandidate('Ash', Date.now()).id, 14);
  assert.equal(ledger.begin('Ash', 'listing', '14', { gems: 90 }), true);
  assert.equal(ledger.mission('Ash').open, 1);
});

test('waits with the final slot reserved and reopens it after a confirmed return', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  let listings = [{ id: 300, tipo: 'pokemon', ficha: { id: 20 } }];
  const { session, requests } = openSession(ledger, 1, 'Ash', () => ({ linhas: [] }), () => listings);
  for (let id = 1; id < 20; id++) {
    ledger.begin('Ash', 'listing', String(id), { gems: 100 });
    ledger.addSale('Ash', sale(id));
  }
  ledger.begin('Ash', 'listing', '20', { gems: 100 });
  ledger.finish('Ash', 'listing', '20', 'uncertain');
  const pokemon = { id: 20, nome: 'Pikachu', speciesId: 25, level: 60, potencia: 4 };
  ledger.addCapture('Ash', { id: 20, name: 'Pikachu' });
  await session.market();
  assert.deepEqual(requests, ['market.meus']);
  assert.equal(ledger.operations('Ash', 'listing').find(({ key }) => key === '20').state, 'confirmed');
  assert.equal(session.snapshot().mission.open, 1);

  listings = [];
  t.mock.timers.tick(91_000);
  await session.market();
  assert.equal(session.snapshot().mission.open, 1);
  session.frame({ t: 'estado', estado: { pkMud: [pokemon] } });
  await session.market();
  assert.equal(session.snapshot().mission.open, 0);
  assert.equal(ledger.nextCandidate('Ash', Date.now()).id, 20);
});
