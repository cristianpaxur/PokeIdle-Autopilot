import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { GameBrowser, clickCapture } from '../src/browser.mjs';

async function pageFor(t) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  return browser.newPage();
}
const scene = `<div id="caidos-bolas">
  <button title="Poké Ball — você tem 50" class="caidos-bola on" onclick="choose(this,1)">Fraca</button>
  <button title="Great Ball — você tem 5" class="caidos-bola" onclick="choose(this,2)">Forte</button></div>
  <div id="caidos-lista">
  <button class="caido" data-slot="1" onclick="hit(1)"><span class="caido-quem">Abra <b>Nv20</b></span></button>
  <button class="caido" data-slot="2" onclick="hit(2)"><span class="caido-quem">Pikachu <b>Nv20</b></span></button></div>
  <script>let ball=1;function choose(button,id){document.querySelector('.caidos-bola.on').classList.remove('on');button.classList.add('on');ball=id}
  function hit(slot){document.body.dataset.hit=JSON.stringify({ball,slot})}</script>`;

test('capture selects the exact requested ball before clicking only the selected species and slot', async (t) => {
  const page = await pageFor(t);
  await page.setContent(scene);
  assert.equal(await clickCapture(page, ['Pikachu'], { ball: { id: 2, name: 'Great Ball' }, slot: '2' }), true);
  assert.deepEqual(JSON.parse(await page.locator('body').getAttribute('data-hit')), { ball: 2, slot: 2 });
  await page.locator('body').evaluate(e => e.removeAttribute('data-hit'));
  await page.getByTitle(/^Great Ball/).evaluate(e => e.remove());
  assert.equal(await clickCapture(page, ['Pikachu'], { ball: { id: 2, name: 'Great Ball' }, slot: '2' }), false);
  assert.equal(await page.locator('body').getAttribute('data-hit'), null);
});

test('capture rechecks permission and target expiry after waiting for the target', async (t) => {
  const page = await pageFor(t);
  await page.setContent(scene);
  let active = true;
  await page.locator('[data-slot="2"]').evaluate(e => { e.disabled = true; });
  const result = clickCapture(page, ['Pikachu'], { ball: { id: 2, name: 'Great Ball' }, slot: '2', canAct: () => active });
  await page.getByTitle(/^Great Ball/).and(page.locator('.on')).waitFor();
  active = false;
  await page.locator('[data-slot="2"]').evaluate(e => { e.disabled = false; });
  assert.equal(await result, false);
  assert.equal(await page.locator('body').getAttribute('data-hit'), null);
  active = true;
  await page.locator('[data-slot="2"]').evaluate(e => e.classList.add('acabando'));
  assert.equal(await clickCapture(page, ['Pikachu'], { ball: { id: 2, name: 'Great Ball' }, slot: '2', canAct: () => active }), false);
});

test('capture chance uses official rarity factors and server limits for fallen targets', async (t) => {
  const page = await pageFor(t);
  await page.route('https://pokeidle.io/app', r => r.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.route('https://pokeidle.io/shared/captura-degrau.mjs', r => r.fulfill({ contentType: 'text/javascript', body: `
    export const FATOR_CAPTURA_DO_DEGRAU={100:4};
    export function chavesEmHunt(hunts){return new Set(hunts.flatMap(h=>h.especies.map(e=>e.pokeId)))}
    export function capturaPeloDegrau(id,keys){return keys.has(id)}
    export function fatorDeCaptura(input){window.factorInput=input;return input.peloDegrau ? input.porDegrau[100] : 10}
  ` }));
  await page.route('https://pokeidle.io/shared/teto-captura.mjs', r => r.fulfill({ contentType: 'text/javascript', body: `
    export function montarEstagiosEvolutivos(rows,buscar){return new Map(rows.map(r=>[r.pokeId,r.evolvesToId && buscar(r.evolvesToId)?20:100]))}
    export function tetoDeCaptura(id,stages){return stages.get(id)}
  ` }));
  await page.route('https://pokeidle.io/shared/evolucoes-cruzadas.mjs', r => r.fulfill({ contentType: 'text/javascript', body: 'export const aplicarCadeiasTruncadas=()=>{}; export const aplicarEvolucoesEntreGeracoes=()=>{};' }));
  await page.route('https://pokeidle.io/shared/outland.mjs', r => r.fulfill({ contentType: 'text/javascript', body: 'export const aplicarRemapOutlandLista=()=>{};export const isOutlandPokeId=()=>false;export const isEspelhoFantasmaPokeId=()=>false;' }));
  await page.goto('https://pokeidle.io/app');
  const browser = new GameBrowser(); browser.page = page;
  const estimates = await browser.captureChances({ species: { 25: { priceNpc: 1000, tetoCaptura: 100 } },
    targets: [{ id: 25 }], hunts: [{ especies: [{ pokeId: 25 }] }],
    balls: [{ id: 1, catchRate: 1 }, { id: 2, catchRate: 20 }, { id: 5, catchRate: 255 }],
    rules: { base: .01, piso: .003, teto: .1, raridadeDiv: 17, porDegrau: { 100: 2 } } });
  assert.ok(Math.abs(estimates[25][1] - .007) < 1e-10);
  assert.equal(estimates[25][2], .1);
  assert.equal(estimates[25][5], 1);
  assert.equal(await page.evaluate(() => window.factorInput.preco), 1000);
  assert.equal(await page.evaluate(() => window.factorInput.peloDegrau), true);
  await browser.captureChances({ species: { 25: { priceNpc: 1000, evolvesTo: 26 }, 26: { priceNpc: 2000 } },
    targets: [{ id: 25 }], hunts: [{ especies: [{ pokeId: 25 }] }], balls: [{ id: 1, catchRate: 1 }],
    rules: { base: .01, piso: .003, teto: .1 } });
  assert.equal(await page.evaluate(() => window.factorInput.tetoCaptura), 20, 'derive caps from the full official evolution catalog');
  assert.equal(await browser.captureChances({ species: {}, targets: [{ id: 25 }], rules: {} }), null);
});
