import assert from 'node:assert/strict';
import test from 'node:test';
import { GameState } from '../src/game-state.mjs';
import { plannerSettings } from '../src/planning.mjs';
import { Ledger } from '../src/ledger.mjs';
import { Session } from '../src/session.mjs';
import { GameBrowser, GAME_URL } from '../src/browser.mjs';

const now = 1_800_000_000_000;
function setup(t, mode) {
  t.mock.timers.enable({ apis: ['Date'], now });
  const ledger = new Ledger(':memory:'); t.after(() => ledger.close());
  const session = new Session({ id: 1, display: ':11', marketEnabled: false }, {}, ledger, () => {});
  const sent = [];
  const pokemon = [1, 2, 3, 4, 5].map((id) => ({ id, speciesId: id, nome: `P${id}`, level: 200,
    slot: id - 1, hp: 100, maxHp: 100, quality: 1, potencia: 2, ivs: { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 } }));
  const ratings = Object.fromEntries(pokemon.map((pk) => [pk.id, 1000 - pk.id]));
  const rules = {
    pvp: { minimumLevel: 150, minTeam: 1, maxTeam: 5, ratings },
    raid: { at: now, edition: { id: 'gx-test', inscricoesDe: now - 1000, inscricoesAte: now + 3600000,
      equipeAte: now + 7200000, fimEm: now + 86400000 }, itemId: 70000, cost: 1, maxTeam: 5, ratings },
    safari: { ticketId: 70095, durationMs: 3600000, poolIds: [25, 26, 27], poolComplete: true,
      captureLevels: { 25: 50, 26: 60, 27: 70 }, eligibleLevels: { 25: 45, 26: 55, 27: 65 } },
  };
  session.browser = { socket: {}, page: { locator: () => ({ first() { return this; }, isVisible: async () => false }) },
    send: async (message) => { sent.push(message); return true; }, activityData: async () => structuredClone(rules),
    gymData: async (_pokemon, _species, ids = []) => ({ ratings, casas: Object.fromEntries(ids.map((id, i) => [id, i])) }),
    suppressPvpReplay: async () => true, captureChances: async () => ({ 25: { 1: .5 }, 26: { 1: .5 }, 27: { 1: .5 } }),
    captureTargets: async () => [], capture: async () => true };
  session.desired = true;
  session.frame({ t: 'welcome', safariPool: 3, catalogoBolas: [{ id: 1, nome: 'Poké Ball', compravel: true, priceGold: 10, catchRate: 1 }],
    captura: { base: .1, piso: .001, teto: 1 }, hunts: [{ slug: 'route', nivel: 10, especies: [{ pokeId: 25, nome: 'Pikachu' }] }],
    estado: { nick: 'Trainer', level: 200, activeId: 1, gold: 20000, huntSlug: 'route', noCentro: false, pokemons: pokemon,
      items: { 70000: 3, 70095: 1 }, balls: { 1: 100 }, teto: { maxDepot: 100 },
      automation: { pvpAutoFila: false, autoBallSemParar: false, autoBallAteCapturar: false, pokemonTravado: [] } } });
  session.planner.species = { 25: { name: 'Pikachu', types: ['ELECTRIC'] }, 26: { name: 'Raichu' }, 27: { name: 'Sandshrew' } };
  session.setPlannerSettings({ autoGyms: false, autoBosses: false, autoPvp: mode === 'pvp', autoRaids: mode === 'raid', autoSafari: mode === 'safari' });
  session.frame({ t: 'pvp', regras: { nivelMin: 150 }, rank: { pontos: 100, partidas: 0 }, time: [], casas: {}, fila: { na: false, cooldownMs: 0 } });
  session.frame({ t: 'raid', agora: now, edicao: { id: 'gx-test' }, eu: { inscrito: false, equipeIds: [] } });
  return { session, activities: session.planner.activities, browser: session.browser, sent, ledger };
}

test('PvP and raid keep independent authoritative caches and discard them on a new session', () => {
  const state = new GameState();
  state.consume({ t: 'welcome', safariPool: 120, estado: { nick: 'Trainer' } }, 1000);
  state.consume({ t: 'pvp', regras: { nivelMin: 150 }, rank: { pontos: 100 }, time: [11, 12],
    casas: { 11: 0, 12: 7 }, fila: { na: false, cooldownMs: 20_000 } }, 2000);
  state.consume({ t: 'raid', agora: 2000, edicao: { id: 'gx-test' }, eu: { inscrito: false, equipeIds: [] } }, 2500);
  state.consume({ t: 'pvp', recusa: { msg: 'pvp.recusada' } }, 3000);
  state.consume({ t: 'raid', recusa: 'raid.recusa.semToken' }, 4000);
  assert.deepEqual(state.pvpInfo.time, [11, 12]);
  assert.equal(state.pvpInfo.rank.pontos, 100);
  assert.equal(state.pvpCooldownUntil, 22_000);
  assert.equal(state.pvpInfoAt, 2000, 'a refusal cannot refresh old eligibility data');
  assert.equal(state.raidInfo.edicao.id, 'gx-test');
  assert.equal(state.raidInfo.eu.inscrito, false);
  assert.equal(state.raidInfoAt, 2500);
  assert.equal(state.safariPool, 120);
  state.consume({ t: 'pvp', timeSalvo: [12, 11], casasSalvas: { 12: 0, 11: 7 } }, 5000);
  assert.deepEqual(state.pvpInfo.time, [12, 11]);
  state.consume({ t: 'pvp', fila: { na: true, desde: 6000 } }, 6000);
  assert.equal(state.pvpInfo.fila.na, true);
  assert.equal(state.pvpInfo.regras.nivelMin, 150);
  state.consume({ t: 'welcome', estado: { nick: 'OtherTrainer' } }, 7000);
  assert.equal(state.pvpInfo, null);
  assert.equal(state.pvpInfoAt, 0);
  assert.equal(state.pvpCooldownUntil, 0);
  assert.equal(state.raidInfo, null);
  assert.equal(state.raidInfoAt, 0);
  assert.equal(state.safariPool, null);
});

test('advanced participation works by default and rejects invalid spending and queue limits', () => {
  const settings = plannerSettings();
  assert.equal(settings.autoPvp, true);
  assert.equal(settings.autoSafari, true);
  assert.equal(settings.autoRaids, true);
  assert.throws(() => plannerSettings({ pvpAttemptsPerDay: -1 }));
  assert.throws(() => plannerSettings({ pvpQueueMinutes: 0 }));
  assert.throws(() => plannerSettings({ safariTicketsPerDay: 100 }));
  assert.throws(() => plannerSettings({ raidTokenReserve: -1 }));
});

test('raid registration persists before spending and finishes on the matching edition without waiting for battle', async (t) => {
  const { session, activities, browser, sent, ledger } = setup(t, 'raid');
  assert.ok(activities.advanced);
  browser.send = async (message) => {
    if (message.t === 'raid.inscrever') assert.equal(ledger.plannerState('Trainer').activity.stage, 'registering');
    sent.push(message); return true;
  };
  await activities.consider();
  assert.equal(sent.filter((m) => m.t === 'raid.inscrever').length, 1);
  await activities.run();
  assert.equal(sent.filter((m) => m.t === 'raid.inscrever').length, 1);
  session.frame({ t: 'raid', edicao: { id: 'other-edition' }, eu: { inscrito: true, equipeIds: [] } });
  assert.ok(activities.current);
  session.frame({ t: 'raid', acao: 'inscreveu', edicao: { id: 'gx-test' }, eu: { inscrito: true, equipeIds: [] } });
  assert.equal(activities.current, null);
  assert.equal(activities.history.at(-1).result, 'registered');
  await activities.consider();
  assert.equal(sent.filter((m) => m.t === 'raid.inscrever').length, 1);
});

test('PvP prepares its own formation and a queued match leaves the hunting loop available', async (t) => {
  const { session, activities, sent } = setup(t, 'pvp');
  assert.ok(activities.advanced);
  await activities.consider();
  const saved = sent.find((m) => m.t === 'pvp.time.salvar');
  assert.deepEqual(saved?.pokemonIds, [1, 2, 3, 4, 5]);
  session.frame({ t: 'pvp', timeSalvo: saved.pokemonIds, casasSalvas: saved.casas });
  await activities.consider();
  assert.equal(sent.filter((m) => m.t === 'pvp.fila.entrar').length, 1);
  session.frame({ t: 'pvp', fila: { na: true, desde: now } });
  assert.equal(activities.interruptsHunt, false);
  assert.equal(await activities.run(), false, 'waiting in queue must not monopolize the session tick');
  session.frame({ t: 'pvp', partida: { id: 100, venci: true, delta: 20 } });
  assert.equal(activities.current, null);
  assert.equal(activities.history.at(-1).result, 'win');
  session.frame({ t: 'pvp', partida: { id: 100, venci: true, delta: 20 } });
  assert.equal(activities.history.filter((a) => a.matchId === 100).length, 1);
  assert.equal(sent.some((m) => ['team.active', 'team.move', 'hunt.select'].includes(m.t)), false);
});

test('pause while loading advanced rules invalidates the prepared participation', async (t) => {
  const { session, activities, browser, sent } = setup(t, 'raid');
  assert.ok(activities.advanced);
  const rules = await browser.activityData({});
  browser.activityData = async () => { session.pause(); return rules; };
  await activities.consider();
  assert.deepEqual(sent, []);
});

test('Safari spends one ticket, suspends hunt statistics and confirms return after its timer', async (t) => {
  const { session, activities, sent } = setup(t, 'safari');
  assert.ok(activities.advanced);
  await activities.consider();
  assert.deepEqual(sent.filter((m) => m.t === 'safari.entrar'), [{ t: 'safari.entrar', tickets: 1 }]);
  session.frame({ t: 'estado', estado: { safari: { dentro: true, fim: now + 3600000, capturas: 0 } } });
  assert.equal(activities.interruptsHunt, true);
  assert.equal(session.onStrategyHunt(), false);
  await activities.run();
  assert.equal(sent.filter((m) => m.t === 'safari.entrar').length, 1);
  t.mock.timers.tick(3600001);
  session.frame({ t: 'batalha', ev: [{ k: 'safariFim', capturas: 2 }] });
  session.frame({ t: 'estado', estado: { safari: null, noCentro: true } });
  await activities.run();
  assert.deepEqual(sent.at(-1), { t: 'hunt.select', slug: 'route' });
  session.frame({ t: 'estado', estado: { safari: null, noCentro: false, huntSlug: 'route' } });
  assert.equal(activities.current, null);
  assert.equal(activities.history.at(-1).captures, 2);
});

test('PvP replay preparation is scoped to the game and does nothing after manual control starts', async () => {
  const browser = new GameBrowser();
  assert.equal(typeof browser.suppressPvpReplay, 'function');
  let writes = 0;
  browser.page = { url: () => GAME_URL, evaluate: async () => { writes++; return true; } };
  assert.equal(await browser.suppressPvpReplay(() => false), false);
  assert.equal(writes, 0);
  assert.equal(await browser.suppressPvpReplay(() => true), true);
  assert.equal(writes, 1);
  browser.page.url = () => 'https://example.org';
  assert.equal(await browser.suppressPvpReplay(() => true), false);
  assert.equal(writes, 1);
});

test('Safari capture uses its own targets and pause during target inspection prevents a throw', async (t) => {
  const { session, activities, browser } = setup(t, 'safari');
  await activities.consider();
  session.frame({ t: 'estado', estado: { safari: { dentro: true, fim: now + 3600000, capturas: 0 } } });
  let throws = 0;
  browser.captureTargets = async () => [{ slot: '0', name: 'Pikachu' }];
  browser.capture = async (_target, _ball, canAct) => { if (canAct()) throws++; return canAct(); };
  await session.planner.capture.prepare();
  assert.equal(await session.planner.capture.run(), true);
  assert.equal(throws, 1);
  browser.captureTargets = async () => { session.pause(); return [{ slot: '0', name: 'Pikachu' }]; };
  assert.equal(await session.planner.capture.run(), false);
  assert.equal(throws, 1);
});

test('an uncertain raid enrollment survives a coordinator restart without spending another token', async (t) => {
  const { session, activities, browser, sent, ledger } = setup(t, 'raid');
  await activities.consider();
  const restored = new Session(session.config, {}, ledger, () => {});
  restored.state = session.state; restored.browser = browser; restored.online = true; restored.desired = true;
  restored.planner.species = session.planner.species; restored.planner.connect();
  t.mock.timers.tick(121000);
  await restored.planner.activities.run();
  assert.equal(restored.planner.activities.current, null);
  await restored.planner.activities.consider();
  assert.equal(sent.filter((m) => m.t === 'raid.inscrever').length, 1);
  assert.equal(ledger.plannerState('Trainer').activityHistory.at(-1).status, 'uncertain');
});

test('a long PvP search exits once and pause prevents the cancellation command', async (t) => {
  const { session, activities, sent } = setup(t, 'pvp');
  session.frame({ t: 'pvp', time: [1, 2, 3, 4, 5], casas: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 } });
  await activities.consider();
  session.frame({ t: 'pvp', fila: { na: true, desde: now } });
  session.pause(); t.mock.timers.tick(181000);
  await activities.run();
  assert.equal(sent.some((m) => m.t === 'pvp.fila.sair'), false);
  session.paused = false;
  await activities.run(); await activities.run();
  assert.equal(sent.filter((m) => m.t === 'pvp.fila.sair').length, 1);
  session.frame({ t: 'pvp', fila: { na: false } });
  assert.equal(activities.current, null);
  assert.equal(activities.history.at(-1).result, 'timeout');
});

test('resuming an existing VIP queue disarms native repeat without entering again', async (t) => {
  const { session, activities, sent } = setup(t, 'pvp');
  session.state.player.automation.pvpAutoFila = true;
  session.frame({ t: 'pvp', time: [1], fila: { na: true, desde: now } });
  await activities.run();
  assert.equal(sent.filter((m) => m.t === 'auto.set' && m.pvpAutoFila === false).length, 1);
  assert.equal(sent.some((m) => m.t === 'pvp.fila.entrar'), false);
});

test('the market preserves a raid formation even when reservation arrives during its price lookup', async (t) => {
  const { session, browser, ledger } = setup(t, 'raid');
  session.config.marketEnabled = true;
  session.mode = 'shiny';
  const candidate = { id: 99, speciesId: 25, nome: 'Pikachu', level: 150, slot: null, shiny: true, potencia: 3 };
  session.state.pokemon.set(99, candidate);
  browser.response = async () => ({ linhas: [] });
  session.reviewListings = async () => false;
  t.mock.method(ledger, 'nextCandidate', () => ({ id: 99, speciesId: 25, name: 'Pikachu', shiny: true }));
  let quotes = 0;
  t.mock.method(ledger, 'saveQuote', () => { quotes++; });
  session.pokemonValuation = async () => {
    session.planner.activities.advanced.rememberTeam('raid', [99]);
    return { gems: 10, fee: 1, net: 8, samples: 3 };
  };
  await session.market();
  assert.equal(quotes, 0, 'reservation must be checked again before progressing toward a listing');
});

test('turning Safari off finishes the active visit through a confirmed exit instead of capturing indefinitely', async (t) => {
  const { session, activities, sent } = setup(t, 'safari');
  await activities.consider();
  session.frame({ t: 'estado', estado: { safari: { dentro: true, fim: now + 3600000, capturas: 0 } } });
  session.setPlannerSettings({ autoSafari: false });
  await activities.run();
  assert.equal(sent.filter((m) => m.t === 'centro.ir').length, 1);
  await activities.run();
  assert.equal(sent.filter((m) => m.t === 'centro.ir').length, 1);
});

test('parallel activity completion preserves the current hunt measurement', async (t) => {
  const { session, activities } = setup(t, 'raid');
  await activities.consider();
  const trial = { slug: 'route', startedAt: now };
  session.optimizer.trial = trial;
  activities.finish('registered', 'Confirmed.');
  assert.equal(session.optimizer.trial, trial);
  activities.advanced.begin({ kind: 'pvp', action: 'queue', target: 'ranked' }, 'queued');
  activities.finish('win', 'Confirmed.');
  assert.equal(session.optimizer.trial, trial);
});

test('Safari never throws a premium fixed ball and waits for complete rules before abandoning', async (t) => {
  const { session, activities, browser, sent } = setup(t, 'safari');
  await activities.consider();
  session.frame({ t: 'estado', estado: { safari: { dentro: true, fim: now + 3600000, capturas: 0 } } });
  session.state.balls.push({ id: 9, nome: 'Premium', compravel: false });
  session.state.player.balls[9] = 50;
  session.setPlannerSettings({ ballMode: 'fixed', fixedBallId: 9 });
  browser.captureChances = async () => ({ 25: { 9: 1 }, 26: { 9: 1 }, 27: { 9: 1 } });
  browser.captureTargets = async () => [{ slot: '0', name: 'Pikachu' }];
  let throws = 0;
  browser.capture = async () => { throws++; return true; };
  await session.planner.capture.prepare();
  await session.planner.capture.run();
  assert.equal(throws, 0);
  activities.advanced.rules = null;
  browser.activityData = async () => null;
  t.mock.timers.tick(61000);
  await activities.run();
  assert.equal(sent.some((m) => m.t === 'centro.ir'), false);
});

test('Safari returns to progression after all interesting species have been obtained', async (t) => {
  const { session, activities, sent } = setup(t, 'safari');
  await activities.consider();
  session.frame({ t: 'estado', estado: { safari: { dentro: true, fim: now + 3600000, capturas: 3 } } });
  for (const id of [25, 26, 27]) session.state.pokemon.set(id, { id, speciesId: id, level: 100, slot: null });
  t.mock.timers.tick(15001);
  await activities.run();
  assert.equal(sent.some((m) => m.t === 'centro.ir'), false, 'allow an observation window before ending a paid visit');
  t.mock.timers.tick(61000);
  await activities.run();
  assert.equal(sent.filter((m) => m.t === 'centro.ir').length, 1);
  assert.equal(activities.current.stage, 'returning');
});

test('Safari preparation can replenish beyond the standard capture stock floor', async (t) => {
  const { session, activities } = setup(t, 'safari');
  session.setPlannerSettings({ safariMinBalls: 200 });
  await activities.advanced.prepare();
  session.planner.refresh();
  assert.equal(activities.evaluated.safari.code, 'stock');
  assert.deepEqual(session.planner.supply.action, { t: 'shop.buy', kind: 'ball', id: 1, qty: 100 });
});

test('Safari spends its last ball on the highest-priority visible target', async (t) => {
  const { session, activities, browser } = setup(t, 'safari');
  const rules = await browser.activityData();
  rules.safari.eligibleLevels[25] = 500;
  browser.activityData = async () => rules;
  await activities.consider();
  session.frame({ t: 'estado', estado: { safari: { dentro: true, fim: now + 3600000, capturas: 0 }, balls: { 1: 1 } } });
  browser.captureTargets = async () => [{ slot: '0', name: 'Pikachu' }, { slot: '1', name: 'Raichu' }];
  let chosen;
  browser.capture = async (target) => { chosen = target.name; return true; };
  await session.planner.capture.prepare();
  await session.planner.capture.run();
  assert.equal(chosen, 'Raichu');
});

test('missing capture chances do not turn a stocked Safari visit into a premature exit', async (t) => {
  const { session, activities, browser, sent } = setup(t, 'safari');
  await activities.consider();
  session.frame({ t: 'estado', estado: { safari: { dentro: true, fim: now + 3600000, capturas: 0 } } });
  browser.captureChances = async () => null;
  t.mock.timers.tick(61000);
  await activities.run();
  t.mock.timers.tick(61000);
  await activities.run();
  assert.equal(sent.some((message) => message.t === 'centro.ir'), false);
  assert.equal(activities.current.stage, 'capturing');
});
