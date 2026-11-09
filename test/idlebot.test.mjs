import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { quote, withdrawalAmount } from '../src/policy.mjs';
import { Ledger } from '../src/ledger.mjs';
import { GameState } from '../src/game-state.mjs';

const target = { id: 14, speciesId: 25, name: 'Pikachu', level: 60, power: 4, shiny: false };

test('quotes the median of unique comparable Gem sales and excludes the owner', () => {
  const sale = (id, bruto, overrides) => ({
    id, bruto, tipo: 'pokemon', moeda: 'orb', vendedor: 'Alice', comprador: 'Bob',
    ficha: { speciesId: 25, potencia: 4, level: 60, shiny: false }, ...overrides,
  });
  const comparable = sale(2, 200);
  const sales = [sale(1, 100), comparable, sale(3, 1000), comparable,
    sale(4, 2, { moeda: 'gold' }), sale(5, 1, { vendedor: 'IdleMaster' }),
    sale(6, 5, { ficha: { speciesId: 25, potencia: 4, level: 60, shiny: true } })];
  assert.deepEqual(quote(target, sales, ['idlemaster']), { gems: 200, samples: 3 });
  assert.equal(quote(target, sales.slice(0, 2), []), null);
});

test('withdrawal requires an explicit destination and leaves the reserve intact', () => {
  const panel = { saldo: 2500, precos: { minimo: 1000 }, saques: [] };
  const config = { enabled: true, wallet: '11111111111111111111111111111112', maxGems: 1500, reserveGems: 1200 };
  assert.equal(withdrawalAmount(panel, config), 1300);
  assert.equal(withdrawalAmount(panel, { ...config, wallet: '' }), 0);
  assert.equal(withdrawalAmount({ ...panel, saqueTravado: true }, config), 0);
});

test('restarting preserves captures and refuses duplicate publication or unresolved payout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'idlebot-ledger-'));
  try {
    const file = join(directory, 'ledger.db');
    const first = new Ledger(file);
    assert.equal(first.addCapture('one', target), true);
    assert.equal(first.addCapture('one', target), false);
    assert.equal(first.begin('one', 'listing', '14', { gems: 100 }), true);
    assert.equal(first.begin('one', 'withdrawal', 'first', { gems: 1000 }), true);
    first.close();
    const second = new Ledger(file);
    assert.equal(second.captures('one').length, 1);
    assert.equal(second.begin('one', 'listing', '14', { gems: 100 }), false);
    assert.equal(second.begin('one', 'withdrawal', 'retry', { gems: 1000 }), false);
    assert.equal(second.begin('two', 'listing', '14', { gems: 100 }), true);
    second.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('reconstructs the account from game frames and counts only confirmed captures', () => {
  const game = new GameState();
  game.consume({ t: 'welcome', estado: { nick: 'Ash', gold: 20, balls: { 1: 2 }, items: {}, pokemons: [] } });
  game.consume({ t: 'estado', estado: { gold: 25 } });
  assert.equal(game.player.nick, 'Ash');
  assert.equal(game.player.gold, 25);
  assert.deepEqual(game.consume({ t: 'batalha', ev: [
    { k: 'bola', sucesso: false },
    { k: 'capturado', pokemon: { id: 14, speciesId: 25, nome: 'Pikachu', potencia: 4, level: 60 } },
  ] }), [target]);
  assert.deepEqual(game.consume({ t: 'shiny.captura', pokemon: { id: 44 } }), []);
});
