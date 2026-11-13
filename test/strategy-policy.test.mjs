import assert from 'node:assert/strict';
import test from 'node:test';
import * as policy from '../src/strategy-policy.mjs';
import { GameState } from '../src/game-state.mjs';
import { plannerSettings } from '../src/planning.mjs';

const now = 1_800_000_000_000;
function input() {
  const state = new GameState();
  state.consume({ t: 'welcome',
    casas: { maxEmUso: 5, raridades: [{ id: 'comum', bonecos: 1, xpShare: 0.25 }, { id: 'lendaria', bonecos: 2, xpShare: 1 }] },
    bicicletas: { raridades: [{ id: 'comum', velocidade: 0.15 }, { id: 'rara', velocidade: 0.5 }] },
    xpShareHeld: { itemId: 70050, pct: 5 },
    estado: { nick: 'Trainer', activeId: 1, level: 150, huntSlug: 'forest', items: {},
      casa: { maxEmUso: 5, lista: [] }, bicicleta: { equipada: null, lista: [], trocaLiberaEm: 0 },
      pokemons: [
        { id: 1, speciesId: 4, nome: 'Charmander', level: 150, slot: 0, hp: 100, maxHp: 100, tipos: ['FIRE'] },
        { id: 2, speciesId: 7, nome: 'Squirtle', level: 140, slot: 1, hp: 100, maxHp: 100, tipos: ['WATER'] },
      ] }, hunts: [{ slug: 'forest', nivel: 100, especies: [{ pokeId: 11, pontos: 10 }] }],
    tabelaTipos: { FIRE: { BUG: 2 }, WATER: { BUG: 1 }, BUG: { FIRE: 0.5, WATER: 1 } },
  }, now);
  return { state, primary: state.pokemon.get(1), settings: plannerSettings(), mode: 'farm', now,
    species: { 11: { types: ['BUG'] } }, lastTeamChangeAt: 0,
    rules: { pass: { day: 20833, nivelMin: 10, jaPegouHoje: false, vipPendenteHoje: false, degrau: 3 },
      ratings: { 1: { power: 100, usable: true }, 2: { power: 90, usable: true } } } };
}
const opportunity = (i, id) => policy.strategyOpportunities(i).find((row) => row.id === id);

test('daily reward requires official eligibility and never buys premium access', () => {
  const i = input();
  assert.deepEqual(opportunity(i, 'pass').command, { t: 'passe.resgatar' });
  i.rules.pass.jaPegouHoje = true;
  assert.equal(opportunity(i, 'pass').command, undefined);
  i.rules.pass.vipPendenteHoje = true;
  assert.equal(opportunity(i, 'pass').status, 'ready');
  i.state.player.level = 9;
  assert.equal(opportunity(i, 'pass').status, 'locked');
  i.rules = null;
  assert.equal(opportunity(i, 'pass').command, undefined);
});

test('bike chooses an owned upgrade and observes the server cooldown and listings', () => {
  const i = input();
  Object.assign(i.state.player.bicicleta, { equipada: 5, equipadaRar: 'comum',
    lista: [{ id: 5, rar: 'comum' }, { id: 6, rar: 'rara', anunciada: true }, { id: 7, rar: 'rara' }] });
  assert.deepEqual(opportunity(i, 'bike').command, { t: 'bicicleta.equipar', bicicletaId: 7 });
  i.state.player.bicicleta.trocaLiberaEm = now + 1;
  assert.equal(opportunity(i, 'bike').status, 'waiting');
  i.state.player.bicicleta.trocaLiberaEm = now;
  i.settings.autoEquipment = false;
  assert.equal(opportunity(i, 'bike').status, 'disabled');
  i.settings.autoEquipment = true;
  i.state.bicycles = null;
  assert.equal(opportunity(i, 'bike').command, undefined);
});

test('houses respect the multi-house limit and fill only empty posts without moving occupants', () => {
  const i = input();
  i.state.player.casa.lista = [{ id: 10, rar: 'comum', emUso: true, postos: [null] },
    { id: 11, rar: 'lendaria', emUso: false, postos: [null, null] }];
  assert.deepEqual(opportunity(i, 'house').command, { t: 'casa.usar', casaId: 11, usar: true });
  assert.deepEqual(opportunity(i, 'house-xp').command, { t: 'xpshare.escolher', casaId: 10, slot: 0, pokemonId: 2 });
  i.state.player.casa.maxEmUso = 1;
  assert.equal(opportunity(i, 'house').command, undefined);
  i.state.player.casa.lista[1].postos[0] = 2;
  assert.equal(opportunity(i, 'house-xp').command, undefined, 'a stored house still owns its assignment');
  i.state.player.casa.lista[0].postos[0] = 1;
  assert.equal(opportunity(i, 'house-xp').command, undefined, 'the principal is never displaced');
});

test('held XP Share uses an owned item without overwriting equipment or a house assignment', () => {
  const i = input();
  i.state.player.items[70050] = 1;
  assert.deepEqual(opportunity(i, 'held-xp').command, { t: 'xpshareheld.equipar', pokemonId: 2 });
  i.state.pokemon.get(2).heldItemId = 42;
  assert.equal(opportunity(i, 'held-xp').command, undefined);
  i.state.pokemon.get(2).heldItemId = null;
  i.state.player.casa.lista = [{ id: 10, rar: 'comum', emUso: true, postos: [2] }];
  assert.equal(opportunity(i, 'held-xp').command, undefined);
});

test('principal changes require a meaningful matchup gain and never oscillate during the hold interval', () => {
  const i = input();
  i.rules.ratings[2].power = 300;
  // Water has worse defensive exposure than fire on this route.
  assert.equal(opportunity(i, 'team').command, undefined);
  i.state.typeChart.BUG.WATER = 0.5;
  assert.deepEqual(opportunity(i, 'team').command, { t: 'team.active', pokemonId: 2 });
  i.lastTeamChangeAt = now - 60_000;
  assert.equal(opportunity(i, 'team').status, 'waiting');
  i.lastTeamChangeAt = 0;
  i.mode = 'shiny';
  assert.equal(opportunity(i, 'team').command, undefined);
  i.mode = 'farm'; i.rules.ratings[2].usable = false;
  assert.equal(opportunity(i, 'team').command, undefined);
  i.rules.ratings[2].usable = true; i.state.pokemon.get(2).hp = 20;
  assert.equal(opportunity(i, 'team').command, undefined);
});

test('empty team slots accept a healthy usable depot candidate, preserving collection and existing slots', () => {
  const i = input();
  i.state.pokemon.set(3, { id: 3, speciesId: 25, nome: 'Pikachu', level: 145, slot: null, hp: 100, maxHp: 100, tipos: ['ELECTRIC'] });
  i.rules.ratings[3] = { power: 95, usable: true };
  assert.deepEqual(opportunity(i, 'team-fill').command, { t: 'team.move', pokemonId: 3, slot: 2 });
  i.state.player.automation = { pokemonTravado: [3] };
  assert.equal(opportunity(i, 'team-fill').command, undefined);
  i.state.player.automation.pokemonTravado = [];
  i.state.pokemon.get(3).level = 10;
  assert.equal(opportunity(i, 'team-fill').command, undefined, 'a weak member must not dilute boss readiness');
});

test('balanced market reserves a boss attempt plus the configured stock only after unlock', () => {
  const i = input();
  i.state.bosses = [{ minNivelTreinador: 300, entrada: { itemId: 70000, qtd: 2, nome: 'Bronze Boss Token' } }];
  assert.equal(policy.strategicReserves(i.state, i.settings).find((row) => row.itemId === 70000).quantity, 1);
  i.state.player.level = 300;
  assert.equal(policy.strategicReserves(i.state, i.settings).find((row) => row.itemId === 70000).quantity, 3);
  i.settings.autoBosses = false;
  assert.deepEqual(policy.strategicReserves(i.state, i.settings), []);
});

test('the market also preserves the official raid entry cost when bosses are disabled', () => {
  const i = input();
  i.settings.autoBosses = false;
  const rules = { itemId: 70000, cost: 1 };
  assert.equal(policy.strategicReserves(i.state, i.settings, rules).find((row) => row.itemId === 70000)?.quantity, 2);
  i.settings.autoRaids = false;
  assert.deepEqual(policy.strategicReserves(i.state, i.settings, rules), []);
});

test('welcome replaces strategic catalogs and preserves partial player updates', () => {
  const { state } = input();
  assert.equal(state.houses.maxEmUso, 5);
  assert.equal(state.bicycles.raridades[1].velocidade, 0.5);
  assert.equal(state.xpShareHeld.itemId, 70050);
  state.consume({ t: 'estado', estado: { gold: 20 } }, now + 1);
  assert.equal(state.player.casa.lista.length, 0);
  state.consume({ t: 'welcome', estado: { nick: 'Another' } }, now + 2);
  assert.equal(state.houses, null);
  assert.equal(state.bicycles, null);
  assert.equal(state.xpShareHeld, null);
});

test('strategy preferences reject invalid thresholds and horizon uses actual boss requirements', () => {
  assert.equal(plannerSettings().autoRewards, true);
  assert.throws(() => plannerSettings({ teamMinGainPercent: -1 }), /inválido/);
  const { state } = input();
  state.player.level = 140;
  state.bosses = [{ nome: 'Boss', minNivelTreinador: 350 }];
  const horizon = policy.strategyHorizon(state);
  assert.ok(horizon.some((row) => row.level === 350 && row.remaining === 210));
  assert.ok(horizon.some((row) => row.level === 150 && row.remaining === 10));
});

test('autonomous growth incubates owned ordinary eggs without buying slots or touching shiny eggs', () => {
  const i = input();
  i.rules.incubation = { total: 1, ovos: [], catalog: [{ id: 'p2', itemId: 70091, potencia: 2, horas: 6 },
    { id: 'p3', itemId: 70092, potencia: 3, horas: 12 }] };
  i.state.player.items = { 70091: 1, 70092: 2 };
  assert.deepEqual(opportunity(i, 'incubate').command, { t: 'chocadeira.colocar', slot: 0, ovo: 'p3' });
  i.rules.incubation.ovos = [{ slot: 0, ovo: 'p3', inicio: now, fim: now + 1000 }];
  assert.equal(opportunity(i, 'incubate').command, undefined);
  i.rules.incubation.ovos = [];
  i.state.player.items = { 999: 1 };
  assert.equal(opportunity(i, 'incubate').command, undefined);
  i.settings.autoIncubate = false;
  assert.equal(opportunity(i, 'incubate').status, 'disabled');
});

test('first house and bicycle use published fragment costs and stop building once the utility exists', () => {
  const i = input();
  i.state.houses.fragmento = { itemId: 70011, custo: 10 };
  i.state.bicycles.fragmento = { itemId: 70013, custo: 12 };
  i.state.player.items = { 70011: 10, 70013: 12 };
  assert.deepEqual(opportunity(i, 'build-house').command, { t: 'casa.fabricar' });
  assert.deepEqual(opportunity(i, 'build-bike').command, { t: 'bicicleta.fabricar' });
  assert.equal(policy.strategicReserves(i.state, i.settings).find((row) => row.itemId === 70013).quantity, 12);
  i.state.player.casa.lista = [{ id: 1, rar: 'comum', emUso: false, postos: [null] }];
  i.state.player.bicicleta.lista = [{ id: 2, rar: 'comum' }];
  assert.equal(opportunity(i, 'build-house').command, undefined);
  assert.equal(opportunity(i, 'build-bike').command, undefined);
  assert.equal(policy.strategicReserves(i.state, i.settings).some((row) => row.itemId === 70013), false);
});

test('a better principal is promoted before a passive XP assignment can reserve it', () => {
  const i = input();
  i.state.pokemon.get(2).tipos = ['FIRE'];
  i.rules.ratings[2].power = 400;
  i.state.player.casa.lista = [{ id: 10, rar: 'comum', emUso: true, postos: [null] }];
  i.settings.autoRewards = false;
  const ready = policy.strategyOpportunities(i).filter((row) => row.command).sort((a, b) => b.priority - a.priority);
  assert.equal(ready[0].id, 'team');
});
