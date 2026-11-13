import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright-core';
import { GameBrowser, GAME_URL } from '../src/browser.mjs';
import { GameState } from '../src/game-state.mjs';

test('gym replies preserve independent caches and a new welcome clears account activity data', () => {
  const state = new GameState();
  assert.deepEqual(state.bosses, []);
  assert.equal(state.gymInfo, null);
  assert.equal(state.gymInfoAt, 0);
  assert.equal(state.gymPanel, null);
  assert.equal(state.gymPanelAt, 0);

  state.consume({ t: 'welcome', bossesJogaveis: [{ key: 'test-boss', level: 300 }],
    estado: { nick: 'TestTrainer', huntSlug: 'route', boss: { arena: { key: 'test-boss' }, auto: false } } }, 1000);
  state.consume({ t: 'ginasio', info: { nivelMinimo: 150, ginasios: [{ tipo: 'FIRE' }] } }, 1100);
  state.consume({ t: 'ginasio', painel: { tipo: 'FIRE', meuTime: [42] } }, 1200);
  state.consume({ t: 'ginasio', erro: 'Temporary error' }, 1300);
  state.consume({ t: 'estado', estado: { gold: 100 } }, 1400);

  assert.deepEqual(state.bosses, [{ key: 'test-boss', level: 300 }]);
  assert.deepEqual(state.gymInfo, { nivelMinimo: 150, ginasios: [{ tipo: 'FIRE' }] });
  assert.equal(state.gymInfoAt, 1100);
  assert.deepEqual(state.gymPanel, { tipo: 'FIRE', meuTime: [42] });
  assert.equal(state.gymPanelAt, 1200);
  assert.deepEqual(state.player.boss, { arena: { key: 'test-boss' }, auto: false });
  state.consume({ t: 'batalha', ev: [{ k: 'morte', quem: 'selvagem' }] }, 1500);
  assert.equal(state.hunt.kills, 0);

  state.consume({ t: 'welcome', estado: { nick: 'OtherTrainer' } }, 2000);
  assert.deepEqual(state.bosses, []);
  assert.equal(state.gymInfo, null);
  assert.equal(state.gymInfoAt, 0);
  assert.equal(state.gymPanel, null);
  assert.equal(state.gymPanelAt, 0);
});

const combatSpecies = {
  pokeId: 25, baseHp: 35, baseAtk: 55, baseDef: 40, baseSpAtk: 50, baseSpDef: 50, baseSpeed: 90,
  type1: 'ELECTRIC', type2: null,
  attacks: [{ name: 'Thunder Shock', type: 'ELECTRIC', category: 'SPECIAL', power: 40, cooldownMs: 2000, learnLevel: 1 }],
};

test('the shared atlas retains complete combat inputs without changing the existing species fields', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    if (url.endsWith('/marker-atlas.json')) return Response.json({ cols: 1, rows: 1, slots: { 25: 0 }, version: 1 });
    const creatures = url.endsWith('/creatures.json')
      ? [{ ...combatSpecies, name: 'Pikachu', looktype: 12, rarity: 'COMMON', evolvesToId: 26, evolveLevel: 40,
        priceNpc: 45000, tetoCaptura: 40 }]
      : [];
    return Response.json({ creatures });
  });
  const { pokemonAtlas } = await import('../src/catalog.mjs?activity-transport');
  const atlas = await pokemonAtlas();
  assert.deepEqual(atlas.species[25], {
    name: 'Pikachu', looktype: 12, types: ['ELECTRIC'], rarity: 'COMMON', evolvesTo: 26, evolveLevel: 40,
    priceNpc: 45000, tetoCaptura: 40,
    combat: combatSpecies,
  });
  assert.equal(await pokemonAtlas(), atlas);
  assert.equal(requests.length, 5);
});

const completePokemon = {
  id: 42, speciesId: 25, nome: 'Pikachu', level: 160, potencia: 3, quality: 2, refino: 1,
  ivs: { hp: 12, atk: 15, def: 17, spAtk: 18, spDef: 22, speed: 30 },
  poder: 999999,
};
const catalog = {
  25: { name: 'Pikachu', types: ['ELECTRIC'], combat: combatSpecies },
  63: { name: 'Abra', types: ['PSYCHIC'], combat: { ...combatSpecies, pokeId: 63, baseSpAtk: 105 } },
};
// Only the remote game modules are substituted. These sentinels make argument/order mistakes visible.
const gymModule = `export function poderNoGinasio(pk, species) {
  if (pk.speciesId !== species.pokeId || pk.ivs.spDef == null || species.attacks[0].power !== 40) throw Error('Incomplete data');
  return pk.id === 42 && pk.level === 160 && pk.potencia === 3 && pk.quality === 2 && pk.refino === 1 ? 321 : 123;
}`;
const boardModule = `export function alcanceDaEspecie(species) {
  return species.pokeId === 63 && species.baseSpAtk === 105 ? 4 : 1;
}
export function casasDaEquipe(requested, ranges) {
  if (requested.length !== ranges.length || requested.some((slot) => slot !== null)) throw Error('Bad slots');
  return ranges.map((range, i) => range === 4 ? 23 : 2 + i);
}`;
let edge;
after(async () => { if (edge) await (await edge).close(); });

async function gameServer(t, files = {}) {
  const routes = {
    '/app': '<!doctype html><title>Activity transport test</title>',
    '/shared/ginasios.mjs': gymModule,
    '/shared/pvp-tabuleiro.mjs': boardModule,
    ...files,
  };
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    const body = routes[req.url];
    res.writeHead(body == null ? 404 : 200, { 'content-type': req.url.endsWith('.mjs') ? 'text/javascript' : 'text/html' });
    res.end(body ?? 'Missing fixture');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  const configure = async (context) => {
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://pokeidle.io') return route.abort();
      const response = await fetch(`${localOrigin}${url.pathname}`);
      return route.fulfill({ status: response.status, contentType: response.headers.get('content-type'), body: await response.text() });
    });
  };
  return { requests, configure };
}

async function gamePage(t, files) {
  const fixture = await gameServer(t, files);
  const browser = await (edge ??= chromium.launch({ channel: 'msedge', headless: true }));
  const context = await browser.newContext();
  t.after(() => context.close());
  await fixture.configure(context);
  const game = new GameBrowser();
  game.page = await context.newPage();
  await game.page.goto(GAME_URL);
  return { game, ...fixture };
}

test('gym data uses official module inputs and aligns unique houses with the requested team order', async (t) => {
  const { game, requests } = await gamePage(t);
  assert.equal(typeof game.gymData, 'function');
  const pokemon = [completePokemon, { ...completePokemon, id: 43, speciesId: 63 }];
  assert.deepEqual(await game.gymData(pokemon, catalog, [43, 42]), {
    ratings: { 42: 321, 43: 123 }, casas: { 43: 23, 42: 3 },
  });
  assert.deepEqual(await game.gymData(pokemon, catalog), { ratings: { 42: 321, 43: 123 }, casas: {} });
  assert.equal(requests.filter((url) => url === '/shared/ginasios.mjs').length, 1);
  assert.equal(requests.filter((url) => url === '/shared/pvp-tabuleiro.mjs').length, 1);
  assert.ok(requests.every((url) => !url.includes('creatures')));
});

test('gym data omits incomplete inputs instead of using raw power or helper fallback values', async (t) => {
  const { game } = await gamePage(t, {
    '/shared/ginasios.mjs': `export function poderNoGinasio(pk) { return pk.id === 42 ? 321 : 1; }`,
  });
  assert.equal(typeof game.gymData, 'function');
  const missingIv = { ...completePokemon.ivs };
  delete missingIv.speed;
  const pokemon = [completePokemon, { ...completePokemon, id: 43, ivs: missingIv },
    { ...completePokemon, id: 44, ivs: null }, { ...completePokemon, id: 45, speciesId: 999 },
    { ...completePokemon, id: 46, speciesId: 63 }, { ...completePokemon, id: 47, speciesId: 64 }];
  const species = { ...catalog, 63: { combat: { ...catalog[63].combat, baseDef: undefined } },
    64: { combat: { ...combatSpecies, pokeId: 64, attacks: undefined } } };
  assert.deepEqual(await game.gymData(pokemon, species), { ratings: { 42: 321 }, casas: {} });
});

test('gym data rejects invalid houses and unavailable or mismatched game contexts', async (t) => {
  const { game } = await gamePage(t, {
    '/shared/pvp-tabuleiro.mjs': `export function alcanceDaEspecie() { return 1; }
      export function casasDaEquipe() { return [2, 2]; }`,
  });
  assert.equal(typeof game.gymData, 'function');
  assert.equal(await game.gymData([completePokemon, { ...completePokemon, id: 43, speciesId: 63 }], catalog, [42, 43]), null);
  assert.equal(await game.gymData([completePokemon], catalog, [999]), null);
  await game.page.goto('about:blank');
  assert.equal(await game.gymData([completePokemon], catalog, [42]), null);
  game.page = null;
  assert.equal(await game.gymData([completePokemon], catalog), null);
});

test('gym data returns no assessment when the official module fails or never resolves', async (t) => {
  for (const module of ['throw Error("Unavailable module");', 'await new Promise(() => {});']) {
    const { game } = await gamePage(t, { '/shared/ginasios.mjs': module });
    assert.equal(typeof game.gymData, 'function');
    assert.equal(await game.gymData([completePokemon], catalog), null);
  }
});

test('the game socket admits the gym and boss protocol while preserving the command allowlist', async (t) => {
  const fixture = await gameServer(t, { '/app': `<!doctype html><script>
    const socket = new WebSocket('wss://pokeidle.io/');
    socket.addEventListener('open', () => socket.send(JSON.stringify({ t: 'hello' })));
    </script>` });
  const game = new GameBrowser();
  t.after(() => game.close());
  const sent = [];
  const state = new GameState();
  t.mock.method(chromium, 'launchPersistentContext', async () => {
    const browser = await (edge ??= chromium.launch({ channel: 'msedge', headless: true }));
    const context = await browser.newContext();
    await fixture.configure(context);
    await context.routeWebSocket('wss://pokeidle.io/', (socket) => {
      // Routed WebSockets omit Playwright's network events; deliver that external interface explicitly.
      const transport = Object.assign(new EventEmitter(), { url: () => 'wss://pokeidle.io/' });
      game.page.emit('websocket', transport);
      const reply = (message) => {
        const payload = JSON.stringify(message);
        socket.send(payload);
        transport.emit('framereceived', { payload });
      };
      socket.onMessage((data) => {
        const message = JSON.parse(data);
        sent.push(message);
        if (message.t === 'hello') reply({ t: 'welcome', bossesJogaveis: [{ key: 'test-boss' }], estado: { nick: 'TestTrainer' } });
        if (message.t === 'ginasio.info') reply({ t: 'ginasio', info: { nivelMinimo: 150 } });
        if (message.t === 'ginasio.painel') reply({ t: 'ginasio', painel: { tipo: message.tipo } });
      });
    });
    return context;
  });
  await game.open('test-profile', 'msedge', (message) => state.consume(message, 5000), () => {}, () => {});
  await game.page.waitForFunction(() => document.readyState === 'complete');
  assert.ok(game.socket);
  const commands = [{ t: 'hunt.select', slug: 'test-route' }, { t: 'ginasio.info' }, { t: 'ginasio.painel', tipo: 'ELECTRIC' },
    { t: 'ginasio.salvar', tipo: 'ELECTRIC', pokemonIds: [42], casas: { 42: 2 } },
    { t: 'ginasio.desafiar', tipo: 'ELECTRIC' }, { t: 'boss.auto', ativo: false, key: 'test-boss' },
    { t: 'boss.entrar', key: 'test-boss' }, { t: 'boss.sair' },
    { t: 'passe.resgatar' }, { t: 'bicicleta.equipar', bicicletaId: 12 },
    { t: 'casa.usar', casaId: 13, usar: true }, { t: 'xpshare.escolher', casaId: 13, slot: 0, pokemonId: 42 },
    { t: 'xpshareheld.equipar', pokemonId: 42 }, { t: 'team.move', pokemonId: 42, slot: 2 },
    { t: 'chocadeira.colocar', slot: 0, ovo: 'p2' }, { t: 'casa.fabricar' }, { t: 'bicicleta.fabricar' },
    { t: 'pvp.info', semLadder: 1 }, { t: 'pvp.time.salvar', pokemonIds: [42, 43], casas: { 42: 0, 43: 7 } },
    { t: 'pvp.fila.entrar' }, { t: 'pvp.fila.sair' }, { t: 'raid.info' }, { t: 'raid.inscrever' },
    { t: 'raid.equipe', pokemonIds: [43, 42] }, { t: 'safari.entrar', tickets: 1 }, { t: 'centro.ir' }];
  for (const command of commands) assert.equal(await game.send(command), true, command.t);
  assert.equal(await game.send({ t: 'boss.comprar', quantidade: 1 }), false);
  assert.equal(await game.send({ t: 'ginasio.abandonar', tipo: 'ELECTRIC' }), false);
  assert.equal(await game.send({ t: 'passe.comprarVip' }), false);
  assert.equal(await game.send({ t: 'casa.usar', casaId: 13, usar: false }), false);
  assert.equal(await game.send({ t: 'team.move', pokemonId: 42, slot: null }), false);
  assert.equal(await game.send({ t: 'bicicleta.equipar', bicicletaId: null }), false);
  assert.equal(await game.send({ t: 'chocadeira.colocar', slot: 0, ovo: 'shiny' }), false);
  assert.equal(await game.send({ t: 'loja.comprar', id: 'chocadeira' }), false);
  for (const command of [{ t: 'safari.entrar', tickets: 2 }, { t: 'raid.equipe', pokemonIds: [42, 42] },
    { t: 'raid.equipe', pokemonIds: [] }, { t: 'pvp.time.salvar', pokemonIds: [42, 43], casas: { 42: 1, 43: 1 } },
    { t: 'pvp.time.salvar', pokemonIds: [42], casas: { 42: 30 } }, { t: 'guild.sair' }, { t: 'raid.comprar' }]) {
    assert.equal(await game.send(command), false, command.t);
  }
  assert.deepEqual(sent.filter(({ t }) => t !== 'hello'), commands);
  assert.deepEqual(state.bosses, [{ key: 'test-boss' }]);
  assert.deepEqual(state.gymInfo, { nivelMinimo: 150 });
  assert.deepEqual(state.gymPanel, { tipo: 'ELECTRIC' });
  assert.equal(state.gymPanelAt, 5000);
});

test('strategy rules use the official pass day and real Pokemon inputs without rating incomplete specimens', async (t) => {
  const { game } = await gamePage(t, {
    '/shared/passe-batalha.mjs': `export const diaDoPasse = t => Math.floor((t - 10800000) / 86400000);
      export function estadoDoPasse(p, now) { return { nivelMin: 10, degrau: 4,
        jaPegouHoje: p.passe.ultimo === diaDoPasse(now), vipPendenteHoje: false }; }`,
    '/shared/nota-pokemon.mjs': `export function poderDePokemon(pk, esp) {
      if (pk.ivs.spDef !== 22 || esp.baseSpAtk !== 50) throw Error('Incomplete or incorrect power inputs');
      return 1234; }`,
    '/shared/pokemon-nivel-treinador.mjs': `export function podeUsarPokemon(level, pk) { return pk.starter || pk.level <= level + 5; }`,
    '/shared/chocadeira.mjs': `export const OVOS = [{id:'p2', itemId:70091, potencia:2, horas:6}];
      export function normalizarChocadeira(raw) { return {total: raw.total, ovos:raw.ovos}; }`,
  });
  assert.equal(typeof game.strategyData, 'function');
  const pokemon = [{ ...completePokemon, level: 160 }, { ...completePokemon, id: 43, ivs: null }];
  const result = await game.strategyData({ level: 150, passe: { ultimo: 20833 }, chocadeira: { total: 2, ovos: [] } }, pokemon, catalog, 1_800_000_000_000);
  assert.equal(result.pass.day, 20833);
  assert.equal(result.pass.jaPegouHoje, true);
  assert.deepEqual(result.ratings, { 42: { power: 1234, usable: false } });
  assert.deepEqual(result.incubation, { total: 2, ovos: [], catalog: [{ id: 'p2', itemId: 70091, potencia: 2, horas: 6 }] });
  await game.page.goto('about:blank');
  assert.equal(await game.strategyData({}, pokemon, catalog, 1_800_000_000_000), null);
});

test('known reward overlays close before capture while unrelated dialogs and pauses are respected', async (t) => {
  const { game } = await gamePage(t, { '/app': `<!doctype html><style>.hidden{display:none}</style>
    <div id="modal"><div id="ps-corpo">Passe</div><button id="modal-fechar" onclick="this.parentElement.classList.add('hidden')">Close</button></div>
    <div id="recompensa"><div id="rc-arte"><img class="rc-img-casa" src="/img/itens/casa-comum.png"></div>
      <div id="rc-nome">Casa</div><button id="rc-ok" onclick="this.parentElement.classList.add('hidden')">OK</button></div>` });
  assert.equal(typeof game.dismissStrategyReward, 'function');
  assert.equal(await game.dismissStrategyReward({ kind: 'house' }, () => false), false);
  assert.equal(await game.page.locator('#recompensa').isVisible(), true);
  assert.equal(await game.dismissStrategyReward({ kind: 'egg', name: 'Squirtle' }, () => true), false);
  let checks = 0;
  assert.equal(await game.dismissStrategyReward({ kind: 'house' }, () => ++checks === 1), false);
  assert.equal(await game.page.locator('#recompensa').isVisible(), true, 'a pause while preparing the click keeps the reward open');
  assert.equal(await game.dismissStrategyReward({ kind: 'house' }, () => true), true);
  assert.equal(await game.page.locator('#recompensa').isVisible(), false);
  assert.equal(await game.dismissStrategyReward({ kind: 'pass' }, () => true), true);
  assert.equal(await game.page.locator('#modal').isVisible(), false);
  await game.page.evaluate(() => {
    document.querySelector('#recompensa').classList.remove('hidden');
    document.querySelector('#rc-nome').textContent = '✨ Shiny Squirtle';
    document.querySelector('#rc-arte').innerHTML = '<img class="rc-img-pixel" src="/img/pokemon/squirtle.png">';
  });
  assert.equal(await game.dismissStrategyReward({ kind: 'egg', name: 'Squirtle' }, () => true), true);
  assert.equal(await game.page.locator('#recompensa').isVisible(), false);
});

test('a pause during the final reward visibility check prevents the real click', async () => {
  const game = new GameBrowser();
  let active = true;
  let visibleChecks = 0;
  let actualClicks = 0;
  const button = {
    isVisible: async () => { if (++visibleChecks === 2) active = false; return true; },
    click: async ({ trial }) => { if (!trial) actualClicks++; },
  };
  game.page = { url: () => GAME_URL, locator: (selector) => selector.startsWith('#confirmar')
    ? { first() { return this; }, isVisible: async () => false } : button };
  assert.equal(await game.dismissStrategyReward({ kind: 'house' }, () => active), false);
  assert.equal(actualClicks, 0);
});

test('advanced rule loading separates arena power, real-level raid power and the official safari pool', async (t) => {
  const { game } = await gamePage(t, {
    '/shared/pvp-rank.mjs': 'export const PVP_NIVEL_MIN=150,PVP_TIME_MIN=1,PVP_TIME_MAX=5;',
    '/shared/ginasios.mjs': 'export const poderNoGinasio=(pk,esp)=>pk.level+esp.baseAtk; export const poderNoNivel=(pk,esp,level)=>level*esp.baseAtk;',
    '/shared/raid.mjs': 'export const RAID_TOKEN_ID=70000,RAID_TOKEN_QTD=1,RAID_MAX_EQUIPE=5,RAID_BONUS_HORAS=12,RAID_BONUS_XP_MAX=20,RAID_BONUS_FARM_MAX=5; export const raidDaVez=now=>({id:"gx-test",inscricoesDe:now-1000,inscricoesAte:now+60000,equipeAte:now+120000,fimEm:now+86400000});',
    '/shared/safari.mjs': 'export const SAFARI_TICKET_ID=70095,SAFARI_DURACAO_MS=3600000,BONUS_SAFARI_PCT=15,SAFARI_SLUG="safari";export const nivelDeCapturaNoSafari=n=>Math.min(200,n*2);',
    '/shared/chocadeira.mjs': 'export const especiesDoOvo=hunts=>[...new Set(hunts.flatMap(h=>h.especies.map(s=>s.pokeId)))];',
    '/shared/reduzir-nivel.mjs': 'export const pisoReducaoNivel=(esp,nivel)=>Math.min(esp.tetoCaptura,nivel);',
    '/shared/pokemon-nivel-treinador.mjs': 'export const nivelMinimoTreinador=level=>Math.max(1,level-5);',
    '/shared/teto-captura.mjs': 'export const montarEstagiosEvolutivos=(rows,buscar)=>new Map(rows.map(row=>[row.pokeId, row.evolvesToId && buscar(row.evolvesToId) ? 20 : 100])); export const tetoDeCaptura=(id,stages)=>stages.get(id);',
    '/shared/evolucoes-cruzadas.mjs': 'export const aplicarCadeiasTruncadas=()=>{}; export const aplicarEvolucoesEntreGeracoes=rows=>{const pk=rows.find(r=>r.pokeId===82);if(pk&&rows.some(r=>r.pokeId===462))pk.evolvesToId=462;};',
    '/shared/outland.mjs': 'export const aplicarRemapOutlandLista=()=>{};export const isOutlandPokeId=()=>false;export const isEspelhoFantasmaPokeId=()=>false;',
  });
  assert.equal(typeof game.activityData, 'function');
  const pokemon = [{ id: 1, speciesId: 25, level: 180, quality: 1, potencia: 2,
    ivs: { hp: 20, atk: 20, def: 20, spAtk: 20, spDef: 20, speed: 20 } }, { id: 2, speciesId: 999, level: 400 }];
  const data = await game.activityData({ player: { level: 170 }, pokemon,
    species: { 25: { name: 'Pikachu', tetoCaptura: 100, combat: combatSpecies } },
    hunts: [{ nivel: 30, especies: [{ pokeId: 25 }] }], safariPool: 1, now: 1_800_000_000_000 });
  assert.equal(data.pvp.minimumLevel, 150);
  assert.equal(data.pvp.ratings[1], 235);
  assert.equal(data.raid.ratings[1], 9900);
  assert.equal(data.pvp.ratings[2], undefined);
  assert.equal(data.raid.edition.id, 'gx-test');
  assert.equal(data.safari.ticketId, 70095);
  assert.equal(data.safari.poolComplete, true);
  assert.deepEqual(data.safari.poolIds, [25]);
  assert.equal(data.safari.captureLevels[25], 60);
  assert.equal(data.safari.eligibleLevels[25], 55);
  const derived = await game.activityData({ player: { level: 170 }, pokemon,
    species: { 25: { name: 'Pikachu', evolvesTo: 26, combat: combatSpecies }, 26: { name: 'Raichu', combat: { ...combatSpecies, pokeId: 26 } },
      82: { name: 'Magneton' }, 462: { name: 'Magnezone' } },
    hunts: [{ nivel: 300, especies: [{ pokeId: 25 }, { pokeId: 82 }] }], safariPool: 2, now: 1_800_000_000_000 });
  assert.equal(derived.safari.poolComplete, true, 'the real creature catalog omits caps; use the evolution helper');
  assert.equal(derived.safari.captureLevels[25], 40);
  assert.equal(derived.safari.eligibleLevels[25], 35);
  assert.equal(derived.safari.captureLevels[82], 40, 'cross-generation links must be added before deriving capture caps');
  await game.page.goto('about:blank');
  assert.equal(await game.activityData({ pokemon, species: {}, hunts: [], now: 1 }), null);
});
