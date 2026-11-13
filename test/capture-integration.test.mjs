import assert from 'node:assert/strict';
import test from 'node:test';
import { Session } from '../src/session.mjs';
import { Ledger } from '../src/ledger.mjs';
import { clickCapture } from '../src/browser.mjs';

function fixture(t) {
  const ledger = new Ledger(':memory:');t.after(() => ledger.close());
  const session = new Session({ id: 1, display: ':11' }, {}, ledger, () => {});
  session.desired = true;
  const sent = [], throws = [];
  session.browser = { socket: {},
    page: { locator: () => ({ first() { return this; }, isVisible: async () => false }) },
    send: async (m) => { sent.push(m);return true; },
    captureChances: async () => ({ 25: { 1: .01, 2: .06 }, 63: { 1: .01, 2: .06 } }),
    captureTargets: async () => [{ slot: '1', name: 'Abra' }, { slot: '2', name: 'Pikachu' }],
    capture: async (target, ball, canAct) => { if (!canAct()) return false; throws.push({ target, ball });return true; },
  };
  const welcome = { t: 'welcome', captura: { base: .0075, piso: .003, teto: .1 },
    catalogoBolas: [{ id: 1, nome: 'Poké Ball', compravel: true, priceGold: 10, catchRate: 1 },
      { id: 2, nome: 'Great Ball', compravel: true, priceGold: 40, catchRate: 4 }],
    shinyLooks: { 25: 100, 63: 101 },
    hunts: [{ slug: 'forest', nivel: 1, especies: [{ pokeId: 25, nome: 'Pikachu' }, { pokeId: 63, nome: 'Abra' }] }],
    estado: { nick: 'CaptureFixture', level: 80, gold: 20000, activeId: 10, huntSlug: 'forest', noCentro: false,
      balls: { 1: 100, 2: 50 }, items: {}, xp: 200,
      automation: { autoBallSemParar: false, autoBallAteCapturar: false, autoVoltarHunt: true },
      pokemons: [{ id: 10, speciesId: 25, nome: 'Pikachu', level: 90, hp: 200, maxHp: 200, slot: 0 }] } };
  session.frame(welcome);
  session.planner.species = { 25: { name: 'Pikachu', priceNpc: 100, tetoCaptura: 100 }, 63: { name: 'Abra', priceNpc: 500, tetoCaptura: 100 } };
  session.setPlannerSettings({ captureMode: 'all', captureTargets: 'selected', captureSpeciesIds: [25],
    autoPotions: false, autoRevives: false, autoEvolve: false });
  return { session, ledger, sent, throws, welcome };
}

test('capture choices persist and select the stronger economical ball only for an allowed visible target', async (t) => {
  const { session, ledger, throws } = fixture(t);
  assert.deepEqual(session.state.captureRules, { base: .0075, piso: .003, teto: .1 });
  await session.planner.capture.prepare();
  await session.planner.capture.run();
  assert.equal(throws.length, 1);
  assert.equal(throws[0].target.name, 'Pikachu');
  assert.equal(throws[0].ball.id, 2);
  session.frame({ t: 'batalha', ev: [{ k: 'bola', ballId: 2, slot: 2, sucesso: false }] });
  assert.equal(session.planner.capture.snapshot().lastAttempt.status, 'miss');
  const reloaded = new Session({ id: 1 }, {}, ledger, () => {});
  assert.deepEqual(reloaded.planner.settings.captureSpeciesIds, [25]);
  assert.equal(reloaded.planner.settings.ballMode, 'economy');
});

test('capture waits for native auto throwing to stop and does not act after a pause or preference change', async (t) => {
  const { session, throws, sent } = fixture(t);
  session.state.player.automation.autoBallSemParar = true;
  await session.planner.capture.prepare();
  await session.planner.capture.run();
  assert.equal(throws.length, 0);
  await session.setHunt(session.state.player);
  assert.equal(sent[0].autoBallSemParar, false);
  assert.equal(sent[0].autoBallAteCapturar, false);
  session.state.player.automation.autoBallSemParar = false;
  session.browser.captureTargets = async () => { session.setPlannerSettings({ captureMode: 'off' });return [{ slot: '2', name: 'Pikachu' }]; };
  await session.planner.capture.run();
  assert.equal(throws.length, 0);
  session.paused = true;
  await session.planner.capture.run();
  assert.equal(throws.length, 0);
});

test('changing from Shiny to Farm while a throw is being prepared cancels that capture', async (t) => {
  const { session } = fixture(t);
  session.setMode('shiny');
  session.setPlannerSettings({ captureMode: 'shiny' });
  await session.planner.capture.prepare();
  let authorized;
  session.browser.capture = async (_target, _ball, canAct) => {
    session.setMode('farm'); authorized = canAct(); return authorized;
  };
  assert.equal(await session.planner.capture.run(), false);
  assert.equal(authorized, false);
});

test('a reconnect for the same account invalidates a throw prepared from the previous connection', async (t) => {
  const { session, welcome } = fixture(t);
  await session.planner.capture.prepare();
  let authorized;
  session.browser.capture = async (_target, _ball, canAct) => {
    session.frame(welcome); authorized = canAct(); return authorized;
  };
  assert.equal(await session.planner.capture.run(), false);
  assert.equal(authorized, false);
});

test('a fixed ball depleted while waiting to throw is not allowed to fall back to another ball', async (t) => {
  const { session } = fixture(t);
  session.setPlannerSettings({ ballMode: 'fixed', fixedBallId: 2 });
  await session.planner.capture.prepare();
  let authorized;
  session.browser.capture = async (_target, _ball, canAct) => {
    session.frame({ t: 'estado', estado: { balls: { 1: 100, 2: 0 } } });
    authorized = canAct(); return authorized;
  };
  assert.equal(await session.planner.capture.run(), false);
  assert.equal(authorized, false);
});

test('the final capture guard runs after asynchronous selection checks', async () => {
  let active = true, shots = 0;
  const target = { isVisible: async () => true, click: async (options) => { if (!options.trial) shots++; } };
  const selected = { isVisible: async () => { active = false; return true; } };
  const ball = { first() { return this; }, isVisible: async () => true, and: () => selected };
  const page = { locator: (selector) => selector.includes('caidos-lista') ? { first: () => target } : ball };
  assert.equal(await clickCapture(page, undefined, { canAct: () => active }), false);
  assert.equal(shots, 0);
});
