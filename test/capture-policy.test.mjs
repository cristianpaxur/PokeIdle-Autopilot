import assert from 'node:assert/strict';
import test from 'node:test';
import { plannerSettings, supplyPlan } from '../src/planning.mjs';

const balls = [
  { id: 1, nome: 'Poké Ball', compravel: true, priceGold: 10, catchRate: 1 },
  { id: 2, nome: 'Great Ball', compravel: true, priceGold: 40, catchRate: 4 },
  { id: 3, nome: 'Ultra Ball', compravel: true, priceGold: 120, catchRate: 8 },
  { id: 5, nome: 'Beast Ball', compravel: false, priceGold: 0, catchRate: 255 },
];
const base = () => ({
  phase: 'shiny', settings: plannerSettings({ captureMinChancePercent: 5 }), balls,
  player: { gold: 20000, balls: { 1: 100, 2: 10, 3: 10, 5: 1 } },
  hunt: { slug: 'forest', especies: [{ pokeId: 25, nome: 'Pikachu', pontos: 3 }, { pokeId: 63, nome: 'Abra', pontos: 1 }] },
  shinyLooks: { 25: 100, 63: 200 },
  chances: { 25: { 1: .01, 2: .06, 3: .1, 5: 1 }, 63: { 1: .003, 2: .03, 3: .06, 5: 1 } },
});

test('capture preferences validate enums and species IDs without accepting a malformed partial update', () => {
  const settings = plannerSettings({ captureMode: 'all', captureTargets: 'selected', captureSpeciesIds: [63, 25],
    ballMode: 'fixed', fixedBallId: 3, autoBuyBalls: false, captureMinChancePercent: 5, ballMaxGold: 1500 });
  assert.deepEqual(settings.captureSpeciesIds, [25, 63]);
  for (const change of [{ captureMode: 'yes' }, { ballMode: 'cheap' }, { captureSpeciesIds: [0] },
    { captureSpeciesIds: ['25'] }, { captureSpeciesIds: [25, 25] }, { fixedBallId: -1 },
    { captureMinChancePercent: 101 }, { ballMaxGold: -1 }]) {
    assert.throws(() => plannerSettings(change, settings), { status: 400 });
  }
  assert.equal(settings.fixedBallId, 3);
});

test('capture chance accepts hundredths of a percent for the game’s low base probabilities', () => {
  assert.equal(plannerSettings().captureMinChancePercent, .5);
  for (const value of [0, .01, .5, .57, 1, 99.99, 100]) {
    assert.equal(plannerSettings({ captureMinChancePercent: value }).captureMinChancePercent, value);
  }
  for (const value of [-.01, .501, 100.01, NaN, Infinity, '0.5']) {
    assert.throws(() => plannerSettings({ captureMinChancePercent: value }), { status: 400 });
  }
});

test('automatic balls meet the chance floor and compare cost per capture instead of sticker price or raw strength', async () => {
  const { capturePlan } = await import('../src/capture-policy.mjs');
  const plan = capturePlan(base());
  assert.equal(plan.targets[0].preferred.id, 2);
  assert.equal(plan.targets[0].available.id, 2);
  assert.equal(plan.targets[0].preferred.chance, .06);
  assert.ok(Math.abs(plan.targets[0].preferred.expectedGold - 666.6666666667) < .001);
  assert.equal(plan.targets[1].preferred.id, 3);
  assert.equal(plan.targets[1].available.id, 3);
  assert.deepEqual(plan.stocks.map(x => x.itemId), [2, 3]);
});

test('fixed selection never falls back to another owned ball and can explicitly use an owned premium ball', async () => {
  const { capturePlan } = await import('../src/capture-policy.mjs');
  const input = base();
  input.settings = plannerSettings({ ballMode: 'fixed', fixedBallId: 3 });
  input.player.balls[3] = 0;
  let plan = capturePlan(input);
  assert.equal(plan.targets[0].preferred.id, 3);
  assert.equal(plan.targets[0].available, null);
  input.settings.fixedBallId = 5;
  plan = capturePlan(input);
  assert.equal(plan.targets[0].available.id, 5);
  assert.equal(plan.restock, null);
});

test('disabled capture, inactive mode and an empty selection do not consume or buy balls', async () => {
  const { capturePlan } = await import('../src/capture-policy.mjs');
  for (const changes of [{ captureMode: 'off' }, { captureTargets: 'selected', captureSpeciesIds: [] }]) {
    const plan = capturePlan({ ...base(), settings: plannerSettings(changes) });
    assert.equal(plan.targets.length, 0);
    assert.equal(plan.restock, null);
  }
  assert.equal(capturePlan({ ...base(), phase: 'progression' }).enabled, false);
  assert.equal(capturePlan({ ...base(), phase: 'progression', settings: plannerSettings({ captureMode: 'all' }) }).targets.length, 2);
});

test('species filtering uses IDs and keeps shiny eligibility separate from capture in every hunt', async () => {
  const { capturePlan } = await import('../src/capture-policy.mjs');
  const input = base();
  input.settings = plannerSettings({ captureTargets: 'selected', captureSpeciesIds: [63] });
  assert.deepEqual(capturePlan(input).targets.map(x => x.id), [63]);
  input.shinyLooks = { 25: 100 };
  assert.equal(capturePlan(input).targets.length, 0);
  input.settings.captureMode = 'all';
  assert.deepEqual(capturePlan(input).targets.map(x => x.id), [63]);
});

test('automatic choice refuses unknown estimates, premium balls and balls outside the configured price or chance', async () => {
  const { capturePlan } = await import('../src/capture-policy.mjs');
  const input = base();
  input.settings = plannerSettings({ captureMinChancePercent: 5, ballMaxGold: 20 });
  assert.equal(capturePlan(input).targets[0].available, null);
  input.settings = plannerSettings();
  input.chances = {};
  assert.equal(capturePlan(input).targets[0].available, null);
  assert.equal(capturePlan(input).restock, null);
  input.chances = { 25: { 1: NaN, 2: Infinity, 3: 2, 5: 1 } };
  assert.equal(capturePlan(input).targets[0].available, null);
});

test('restocking counts only the chosen ball and preserves health supplies and the shared gold budget', async () => {
  const { capturePlan } = await import('../src/capture-policy.mjs');
  const input = base();
  input.settings = plannerSettings({ goldReserve: 19000, supplyGoldPerHour: 500, autoPotions: false, autoRevives: false,
    ballMode: 'fixed', fixedBallId: 3 });
  input.player.balls[3] = 0;
  const capture = capturePlan(input);
  const supply = supplyPlan({ ...input, capture, spentGold: 140 });
  assert.deepEqual(supply.action, { t: 'shop.buy', kind: 'ball', id: 3, qty: 3 });
  assert.equal(supply.purchase.cost, 360);
  assert.equal(supply.stocks.find(x => x.category === 'ball').have, 0);
  input.settings.autoBuyBalls = false;
  assert.equal(supplyPlan({ ...input, capture: capturePlan(input) }).action, null);
  input.settings.autoBuyBalls = true;
  input.settings.autoRevives = true;
  const reviveFirst = supplyPlan({ ...input, capture: capturePlan(input),
    items: [{ id: 9, name: 'Revive', category: 'revive', npcPrice: 50 }] });
  assert.equal(reviveFirst.action.kind, 'item');
  assert.equal(reviveFirst.action.id, 9);
});

test('an unaffordable preferred ball does not block an affordable restock for another selected species', async () => {
  const { capturePlan } = await import('../src/capture-policy.mjs');
  const input = base();
  input.settings = plannerSettings({ captureMinChancePercent: 5, goldReserve: 19900, autoPotions: false, autoRevives: false });
  input.balls = [{ id: 2, nome: 'Great Ball', compravel: true, priceGold: 50 },
    { id: 3, nome: 'Ultra Ball', compravel: true, priceGold: 200 }];
  input.player.balls = {};
  input.chances = { 25: { 2: .01, 3: .06 }, 63: { 2: .06, 3: .1 } };
  assert.deepEqual(supplyPlan({ ...input, capture: capturePlan(input) }).action,
    { t: 'shop.buy', kind: 'ball', id: 2, qty: 2 });
});
