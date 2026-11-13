import assert from 'node:assert/strict';
import test from 'node:test';
import { HuntOptimizer } from '../src/hunt-optimizer.mjs';
import { Ledger } from '../src/ledger.mjs';

const hunts = [{ slug: 'paras', nivel: 1 }, { slug: 'metapod', nivel: 10 }, { slug: 'bulbasaur', nivel: 20 }];
function setup() {
  const saved = [];
  const optimizer = new HuntOptimizer({ load: () => [], save: (sample) => saved.push(sample) });
  const player = { level: 23, huntSlug: 'paras', xp: 1000 };
  const pokemon = { id: 10, speciesId: 4, level: 25, xp: 2000 };
  const observe = (now) => optimizer.observe({ enabled: true, player, pokemon }, now);
  observe(0);
  return { optimizer, saved, player, pokemon, observe };
}

test('compares measured XP rates and chooses the best after three real trials', () => {
  const { optimizer, saved, player, pokemon, observe } = setup();
  assert.equal(optimizer.choose(hunts, player, 0).slug, 'paras');
  observe(0);
  player.xp += 90; pokemon.xp += 180; observe(90_000);
  assert.equal(optimizer.choose(hunts, player, 90_000).slug, 'bulbasaur');
  player.huntSlug = 'bulbasaur'; observe(91_000);
  player.xp += 45; pokemon.xp += 90; observe(181_000);
  assert.equal(optimizer.choose(hunts, player, 181_000).slug, 'metapod');
  player.huntSlug = 'metapod'; observe(182_000);
  player.xp += 180; pokemon.xp += 360; observe(272_000);
  assert.equal(optimizer.choose(hunts, player, 272_000).slug, 'metapod');
  assert.equal(optimizer.snapshot().stage, 'best');
  assert.equal(saved.length, 3);
  assert.equal(optimizer.snapshot().ranking[0].trainerXpPerHour, 7200);
});

test('net XP and recovery time reduce the measured value of a hunt with faints', () => {
  const { optimizer, player, pokemon, observe } = setup();
  optimizer.choose(hunts.slice(0, 2), player, 0); observe(0);
  player.xp += 100; pokemon.xp += 150; observe(30_000);
  optimizer.recordBattle([{ k: 'morte', quem: 'jogador' }]);
  player.noCentro = true; player.huntSlug = null; player.xp -= 40; pokemon.xp -= 20;
  observe(60_000);
  player.noCentro = false; player.huntSlug = 'paras'; observe(90_000);
  optimizer.choose(hunts.slice(0, 2), player, 90_000);
  const sample = optimizer.snapshot().ranking[0];
  assert.equal(sample.trainerXpPerHour, 2400);
  assert.equal(sample.pokemonXpPerHour, 5200);
  assert.equal(sample.faints, 1);
  assert.equal(sample.durationMs, 90_000);
});

test('suspension and a new Pokémon exclude manual XP and incompatible samples', () => {
  const { optimizer, player, pokemon, observe } = setup();
  optimizer.choose(hunts, player, 0); observe(0);
  player.xp += 10; observe(30_000);
  optimizer.suspend();
  player.xp += 5000;
  observe(600_000);
  optimizer.choose(hunts, player, 600_000); observe(600_000);
  player.xp += 90; observe(690_000);
  optimizer.choose(hunts, player, 690_000);
  assert.equal(optimizer.snapshot().ranking[0].trainerXpPerHour, 3600);
  pokemon.speciesId = 5; observe(691_000);
  assert.deepEqual(optimizer.snapshot().ranking, []);
});

test('changing bicycle speed discards measurements made with the previous equipment', () => {
  const { optimizer, player, observe } = setup();
  optimizer.choose(hunts, player, 0); observe(0);
  player.xp += 90; observe(90_000);
  optimizer.choose(hunts, player, 90_000);
  assert.equal(optimizer.snapshot().ranking.length, 1);
  player.bicicleta = { equipada: 5, equipadaRar: 'rara' };
  observe(91_000);
  assert.equal(optimizer.snapshot().ranking.length, 0);
});

test('completed observations survive a restart while a blocked hunt cannot win', () => {
  const { optimizer, saved, player, observe } = setup();
  optimizer.choose(hunts, player, 0); observe(0);
  player.xp += 100; observe(90_000);
  optimizer.choose(hunts, player, 90_000);
  const restarted = new HuntOptimizer({ load: () => saved, save: () => {} });
  restarted.observe({ enabled: true, player, pokemon: { id: 10, speciesId: 4, level: 25, xp: 2000 } }, 91_000);
  assert.equal(restarted.snapshot().ranking.length, 1);
  assert.notEqual(restarted.choose(hunts.slice(1), player, 91_000).slug, 'paras');
});

test('XP boost changes start a fresh comparison and SQLite keeps observations account-scoped', (t) => {
  const ledger = new Ledger(':memory:');
  t.after(() => ledger.close());
  const optimizer = new HuntOptimizer({
    load: (context) => ledger.huntSamples('Ash', context, 90_000),
    save: (sample) => ledger.saveHuntSample('Ash', sample),
  });
  const player = { xp: 1000, huntSlug: 'paras', loja: { boosts: { xp: 100_000 } } };
  const pokemon = { id: 10, speciesId: 4, level: 25, xp: 2000 };
  optimizer.observe({ enabled: true, player, pokemon }, 0);
  optimizer.choose(hunts, player, 0);
  optimizer.observe({ enabled: true, player, pokemon }, 0);
  player.xp += 180;
  optimizer.observe({ enabled: true, player, pokemon }, 90_000);
  optimizer.choose(hunts, player, 90_000);
  const context = optimizer.context;
  assert.equal(ledger.huntSamples('Ash', context, 90_000).length, 1);
  assert.equal(ledger.huntSamples('Misty', context, 90_000).length, 0);
  optimizer.observe({ enabled: true, player, pokemon }, 101_000);
  assert.deepEqual(optimizer.snapshot().ranking, []);
});

test('a trial waits for recovery past the deadline before choosing its measured rate', () => {
  const { optimizer, player, pokemon, observe } = setup();
  optimizer.choose(hunts, player, 0); observe(0);
  player.xp += 100; observe(80_000);
  optimizer.recordBattle([{ k: 'morte', quem: 'jogador' }]);
  player.noCentro = true; player.huntSlug = null; player.xp -= 40;
  observe(100_000);
  assert.equal(optimizer.choose(hunts, player, 100_000).slug, 'paras');
  assert.equal(optimizer.snapshot().ranking.length, 0);
  player.noCentro = false; player.huntSlug = 'paras';
  observe(120_000);
  optimizer.choose(hunts, player, 120_000);
  assert.equal(optimizer.snapshot().ranking[0].trainerXpPerHour, 1800);
  assert.equal(optimizer.snapshot().ranking[0].faints, 1);
});

test('a failed hunt is avoided after restart until its faint cooldown expires', () => {
  const { optimizer, saved, player, observe } = setup();
  optimizer.choose(hunts, player, 0); observe(0);
  optimizer.recordBattle([{ k: 'morte', quem: 'jogador' }, { k: 'morte', quem: 'jogador' }]);
  observe(40_000);
  optimizer.choose(hunts.slice(1), player, 40_000);
  const restarted = new HuntOptimizer({ load: () => saved, save: () => {} });
  restarted.observe({ enabled: true, player, pokemon: { id: 10, speciesId: 4, level: 25, xp: 2000 } }, 41_000);
  assert(restarted.blockedHunts(41_000).has('paras'));
  assert.notEqual(restarted.choose(hunts, player, 41_000).slug, 'paras');
  assert(!restarted.blockedHunts(641_000).has('paras'));
  assert.equal(restarted.snapshot().rejected[0].faints, 2);
});

test('rapid faints are saved and a restart immediately resumes the best completed hunt', () => {
  const { optimizer, saved, player, observe } = setup();
  optimizer.choose(hunts, player, 0); observe(0);
  optimizer.recordBattle([{ k: 'morte', quem: 'jogador' }, { k: 'morte', quem: 'jogador' }]);
  observe(12_000);
  optimizer.choose(hunts.slice(1), player, 12_000);
  assert.equal(saved[0].faints, 2);
  const samples = [...saved, { context: optimizer.context, slug: 'metapod', startedAt: 20_000,
    endedAt: 110_000, durationMs: 90_000, trainerXp: 100, pokemonXp: 100,
    faints: 0, kills: 10, pokemonLevel: 25, complete: true }];
  const restarted = new HuntOptimizer({ load: () => samples, save: () => {} });
  restarted.observe({ enabled: true, player, pokemon: { id: 10, speciesId: 4, level: 25, xp: 2000 } }, 111_000);
  assert.equal(restarted.choose(hunts, player, 111_000).slug, 'metapod');
  assert.equal(restarted.snapshot().stage, 'best');
});

test('disconnecting during recovery preserves a rejected hunt before the next decision', () => {
  const { optimizer, saved, player, observe } = setup();
  optimizer.choose(hunts, player, 0); observe(0);
  optimizer.recordBattle([{ k: 'morte', quem: 'jogador' }, { k: 'morte', quem: 'jogador' }]);
  player.noCentro = true; player.huntSlug = null; observe(12_000);
  optimizer.suspend();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].complete, false);
  const restarted = new HuntOptimizer({ load: () => saved, save: () => {} });
  restarted.observe({ enabled: true, player, pokemon: { id: 10, speciesId: 4, level: 25, xp: 2000 } }, 13_000);
  assert(restarted.blockedHunts(13_000).has('paras'));
});
