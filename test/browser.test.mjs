import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { acceptGameUpdate, clickCapture, prepareListing } from '../src/browser.mjs';

test('the bot uses the regular throw button and skips expired targets', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="caidos-bolas"><button class="caidos-bola on">Bola</button></div>
      <div id="caidos-lista">
        <button class="caido acabando" onclick="document.body.dataset.hit = 'expired'">Abra</button>
        <button class="caido" onclick="document.body.dataset.hit = 'current'">Pikachu</button>
        <button class="caido" onclick="document.body.dataset.hit = 'eligible'"><span class="caido-quem">Nidoran♀ <b>Nv6</b></span></button>
      </div>`);
    assert.equal(await clickCapture(page), true);
    assert.equal(await page.locator('body').getAttribute('data-hit'), 'current');
    assert.equal(await clickCapture(page, ['Nidoran♀']), true);
    assert.equal(await page.locator('body').getAttribute('data-hit'), 'eligible');
    await page.locator('.caidos-bola').evaluate((button) => button.remove());
    assert.equal(await clickCapture(page), false);
  } finally {
    await browser.close();
  }
});

test('waits for a visible capture target to become clickable', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="caidos-bolas"><button class="caidos-bola on">Bola</button></div>
      <div id="caidos-lista">
        <button class="caido" disabled onclick="document.body.dataset.thrown = 'yes'">Magikarp</button>
      </div>`);
    const [thrown] = await Promise.all([
      clickCapture(page),
      page.locator('.caido').evaluate((button) => {
        setTimeout(() => { button.disabled = false; }, 750);
      }),
    ]);
    assert.equal(thrown, true);
    assert.equal(await page.locator('body').getAttribute('data-thrown'), 'yes');
  } finally {
    await browser.close();
  }
});

test('listing preparation selects the precise captured Pokémon and leaves final confirmation untouched', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button data-modal="community">Mercado</button>
      <button id="cm-anunciar">Anunciar</button><button data-tipo="pokemon">Pokémon</button>
      <input id="cm-pks-busca"><div id="cm-pks">
        <button data-chave="cm-sel12" onclick="document.body.dataset.picked = '12'">Abra</button>
        <button data-chave="cm-sel13" onclick="document.body.dataset.picked = '13'">Abra</button>
      </div>
      <div class="cm-moedas-anuncio"><button data-moeda="orb" onclick="this.classList.add('on')">Gemas</button></div>
      <input id="cm-preco" type="number" min="1" max="10000">
      <button id="cm-publicar">Publicar</button>
      <input id="cm-dias" type="range" min="1" max="30" value="1">
      <button id="cm-dias-ok" onclick="document.getElementById('confirmar').hidden = false">Preparar</button>
      <div id="confirmar" hidden><div id="confirmar-texto"><div class="dlg-custo">100.000</div></div>
        <button id="confirmar-sim" onclick="document.body.dataset.sent = 'true'">Publicar</button></div>`);
    assert.equal(await prepareListing(page, { id: 13, name: 'Abra' }, 210, 1), true);
    assert.equal(await page.locator('body').getAttribute('data-picked'), '13');
    assert.equal(await page.locator('#cm-preco').inputValue(), '210');
    assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  } finally {
    await browser.close();
  }
});

test('accepts a game update only after the confirmation dialog has closed', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="aviso-versao">
      <button id="aviso-versao-btn" onclick="document.body.dataset.updated = 'yes'">Recarregar</button>
      </div><div id="confirmar">Confirme a operação</div>`);
    assert.equal(await acceptGameUpdate(page), false);
    assert.equal(await page.locator('body').getAttribute('data-updated'), null);
    await page.locator('#confirmar').evaluate((el) => { el.hidden = true; });
    assert.equal(await acceptGameUpdate(page), true);
    assert.equal(await page.locator('body').getAttribute('data-updated'), 'yes');
  } finally {
    await browser.close();
  }
});
