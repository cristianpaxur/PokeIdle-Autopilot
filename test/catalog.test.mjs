import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createDashboard } from '../src/dashboard.mjs';
import { Ledger } from '../src/ledger.mjs';
import { Session } from '../src/session.mjs';

const team = { id: 41, speciesId: 25, nome: 'Pikachu', apelido: 'Raio', slot: 0,
  level: 30, potencia: 3, nota: 0, hp: 75, maxHp: 80, stats: { hp: 80, atk: 35 }, ivs: { hp: 25, atk: 14 } };
const depot = { id: 42, speciesId: 63, nome: 'Abra', level: 20 };
const locked = { id: 43, speciesId: 129, nome: 'Magikarp', shiny: true, level: 32 };
const welcome = (nick, pokemons) => ({ t: 'welcome', estado: {
  cheio: true, nick, pokemons, automation: { pokemonTravado: [43] },
} });

async function setup(t, { remote = false } = {}) {
  const ledger = new Ledger(':memory:');
  const sessions = [1, 2].map((id) => new Session({ id }, {}, ledger, () => {}));
  const origin = new URL('http://127.0.0.1');
  const dashboard = createDashboard({
    snapshot: () => ({ profiles: [] }), sessions,
    remote: remote ? { origin, password: 'test-only', desktop: { close() {} } } : undefined,
  });
  await new Promise((resolve) => dashboard.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await dashboard.close(); ledger.close(); });
  const url = `http://127.0.0.1:${dashboard.server.address().port}`;
  origin.port = String(dashboard.server.address().port);
  return { sessions, url, request: (path) => fetch(url + path) };
}

test('reads the whole game inventory after login and applies inventory deltas by account', async (t) => {
  const { sessions, request } = await setup(t);
  sessions[0].frame(welcome('Trainer', [team, depot, locked]));
  sessions[1].frame(welcome('OtherTrainer', [{ ...team, nome: 'Raichu', speciesId: 26 }]));
  assert.equal(sessions[0].snapshot().captures.length, 0);

  const initial = await request('/api/collection');
  assert.equal(initial.status, 200);
  const { profiles } = await initial.json();
  assert.deepEqual(profiles[0].pokemon.map(({ id, location }) => [id, location]),
    [[41, 'team'], [42, 'depot'], [43, 'collection']]);

  sessions[0].frame({ t: 'estado', estado: { pkMud: [{ ...team, level: 31 }], pkFora: [42] } });
  const first = await (await request('/api/profiles/1/pokemon/41')).json();
  assert.equal(first.pokemon.level, 31);
  assert.equal(first.pokemon.nickname, 'Raio');
  assert.equal(first.pokemon.ivs.hp, 25);
  assert.equal((await request('/api/profiles/1/pokemon/42')).status, 404);
  const second = await (await request('/api/profiles/2/pokemon/41')).json();
  assert.equal(second.pokemon.name, 'Raichu');

  sessions[0].frame(welcome('Unlinked', [{ ...team, nome: 'WrongAccount' }]));
  const afterRejection = await request('/api/profiles/1/pokemon/41');
  if (afterRejection.ok) assert.equal((await afterRejection.json()).pokemon.name, 'Pikachu');
  else assert.equal(afterRejection.status, 404);
});

test('protects collection, detail and market with dashboard authentication', async (t) => {
  const { request } = await setup(t, { remote: true });
  for (const path of ['/api/collection', '/api/profiles/1/pokemon/41', '/api/market']) {
    assert.equal((await request(path)).status, 401);
  }
});

test('reads active offers without entering the listing or purchase workflow', async (t) => {
  const { sessions, request } = await setup(t);
  sessions[1].frame({ ...welcome('Trainer', [team]), itensNossos: [{ id: 300, nome: 'Pedra do Trovão' }] });
  sessions[1].desired = true;
  const sent = [];
  sessions[1].browser = {
    socket: true,
    send: async (message) => { sent.push(message); return true; },
    response: async (matches, send) => {
      await send();
      const command = sent.at(-1);
      const replies = {
        'market.listar': { aba: 'vitrine', pagina: 1, porPagina: 24, total: 35, linhas: [
          { id: 99, tipo: 'pokemon', preco: 170, moeda: 'orb', ficha: { speciesId: 25, nome: 'Pikachu', level: 50 } },
        ] },
        'market.itens': { aba: 'itens', resumo: { 300: { minGold: 890, minOrb: 3, anuncios: 2, unidades: 6 } } },
        'market.item': { aba: 'item', itemId: 300, moeda: 'gold', linhas: [
          { id: 100, itemId: 300, tipo: 'item', preco: 890, moeda: 'gold', qtd: 4 },
        ] },
      };
      const reply = { t: 'market', ...replies[command.t] };
      return matches(reply) ? reply : null;
    },
  };
  const active = await request('/api/market?type=pokemon&currency=orb&search=Pikachu&page=1');
  assert.equal(active.status, 200);
  const pokemon = await active.json();
  assert.equal(pokemon.pages, 2);
  assert.equal(pokemon.rows[0].price, 170);
  assert.equal(pokemon.rows[0].currency, 'orb');
  assert.equal(sent[0].busca, 'Pikachu');

  const catalog = await (await request('/api/market?type=item')).json();
  assert.equal(catalog.rows[0].name, 'Pedra do Trovão');
  assert.equal(catalog.rows[0].gold.price, 890);
  const item = await (await request('/api/market?type=item&item=300&currency=gold')).json();
  assert.equal(item.rows[0].quantity, 4);
  assert.equal(item.rows[0].price, 890);
  assert.deepEqual(sent.map(({ t }) => t), ['market.listar', 'market.itens', 'market.item']);
  sessions[1].pause();
  assert.equal((await request('/api/market?type=pokemon')).status, 503);
});

test('opens a specific specimen from the collection and reloads its direct link', async (t) => {
  const { sessions, url } = await setup(t);
  sessions[0].frame(welcome('Trainer', [team, depot, locked,
    { id: 44, speciesId: 2002, looktype: 329, nome: 'Tribal Feraligatr', level: 21 },
  ]));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 400, height: 850 } });
  await page.route('https://**', (route) => route.abort());
  await page.route('**/api/pokemon-atlas', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/pokemon-sprite/329', (route) => route.fulfill({ json: {
    path: '/assets/asset-packs/outfits/male/329/mock.webp', x: 2, y: 2, w: 64, h: 64, width: 128, height: 128,
  } }));
  await page.goto(url);
  await page.getByRole('link', { name: 'Meus Pokémon' }).click({ timeout: 2500 });
  const tribal = page.getByRole('link', { name: /Tribal Feraligatr/ });
  await tribal.locator('.pokemon-sprite span[style*="mock.webp"]').waitFor({ timeout: 2500 });
  const raio = page.getByRole('link', { name: /Raio/ });
  await raio.waitFor({ timeout: 2500 });
  assert.match(await raio.innerText(), /Nível\s+30\s+Potência\s+P3\s+Nota\s+0\s+IV total\s+39/);
  assert.match(await page.getByRole('link', { name: /Abra/ }).innerText(), /Nota\s+—\s+IV total\s+—/);
  await raio.click({ timeout: 2500 });
  assert.equal(new URL(page.url()).pathname, '/pokemon/1/41');
  await page.getByRole('heading', { name: 'Raio', exact: true }).waitFor({ timeout: 2500 });
  assert.match(await page.locator('main').innerText(), /75\s*\/\s*80/);
  assert.equal(await page.locator('.catalog-table').evaluate((table) => table.scrollWidth <= table.clientWidth), true);
  await page.reload();
  await page.getByRole('heading', { name: 'Raio', exact: true }).waitFor({ timeout: 2500 });
});

test('sorts the filtered collection numerically before splitting it into pages', async (t) => {
  const { sessions, url } = await setup(t);
  const filler = Array.from({ length: 44 }, (_, index) => ({
    id: 100 + index, nome: `Pidgey ${index}`, level: 20, potencia: 2, nota: 2, ivs: { hp: 4 },
  }));
  sessions[0].frame(welcome('Trainer', [
    { id: 1, nome: 'Abra', level: 9 },
    { id: 2, nome: 'Blastoise', level: 10, potencia: 2, nota: 0, ivs: { hp: 3 } },
    { id: 3, nome: 'Caterpie', level: 100, potencia: 1, nota: 1, ivs: { hp: 12 } },
    { id: 4, nome: 'Dragonite', level: 70, potencia: 5, nota: 9.5, ivs: { hp: 20 }, shiny: true },
    { id: 5, nome: 'Eevee', level: 17, potencia: 3, nota: 10.5, ivs: { hp: 9 } },
    { id: 6, nome: 'Gengar', level: 24, potencia: 3, nota: 9.5, ivs: { hp: 32 }, shiny: true },
    ...filler,
  ]));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  await page.route('https://**', (route) => route.abort());
  await page.route('**/api/pokemon-atlas', (route) => route.fulfill({ json: {} }));
  await page.goto(`${url}/colecao`);
  const names = page.locator('#pokemon-grid .pokemon-card strong');
  await names.first().waitFor({ timeout: 5000 });
  const order = page.getByLabel('Ordenar por');
  assert.equal(await names.first().textContent(), 'Abra');

  for (const [field, expected] of [['level', 'Caterpie'], ['power', 'Dragonite'], ['rating', 'Eevee']]) {
    await order.selectOption(field, { timeout: 5000 });
    assert.equal(await names.first().textContent(), expected);
  }
  assert.deepEqual((await names.allTextContents()).slice(0, 3), ['Eevee', 'Dragonite', 'Gengar']);
  await page.getByRole('button', { name: 'Próxima' }).click();
  assert.deepEqual(await names.allTextContents(), ['Blastoise', 'Abra']);

  await order.selectOption('iv');
  assert.equal(await page.locator('#page-info').textContent(), 'Página 1 de 2');
  assert.equal(await names.first().textContent(), 'Gengar');
  await page.getByLabel('Só shiny').check();
  assert.deepEqual(await names.allTextContents(), ['Gengar', 'Dragonite']);
  await order.selectOption('level');
  assert.deepEqual(await names.allTextContents(), ['Dragonite', 'Gengar']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});
