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
      ? [{ ...combatSpecies, name: 'Pikachu', looktype: 12, rarity: 'COMMON', evolvesToId: 26, evolveLevel: 40 }]
      : [];
    return Response.json({ creatures });
  });
  const { pokemonAtlas } = await import('../src/catalog.mjs?activity-transport');
  const atlas = await pokemonAtlas();
  assert.deepEqual(atlas.species[25], {
    name: 'Pikachu', looktype: 12, types: ['ELECTRIC'], rarity: 'COMMON', evolvesTo: 26, evolveLevel: 40,
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
    { t: 'boss.entrar', key: 'test-boss' }, { t: 'boss.sair' }];
  for (const command of commands) assert.equal(await game.send(command), true, command.t);
  assert.equal(await game.send({ t: 'boss.comprar', quantidade: 1 }), false);
  assert.equal(await game.send({ t: 'ginasio.abandonar', tipo: 'ELECTRIC' }), false);
  assert.deepEqual(sent.filter(({ t }) => t !== 'hello'), commands);
  assert.deepEqual(state.bosses, [{ key: 'test-boss' }]);
  assert.deepEqual(state.gymInfo, { nivelMinimo: 150 });
  assert.deepEqual(state.gymPanel, { tipo: 'ELECTRIC' });
  assert.equal(state.gymPanelAt, 5000);
});
