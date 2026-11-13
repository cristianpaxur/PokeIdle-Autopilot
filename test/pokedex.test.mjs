import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createDashboard } from '../src/dashboard.mjs';

async function setup(t) {
  const dashboard = createDashboard({ snapshot: () => ({ profiles: [] }), command: () => {} });
  await new Promise((resolve) => dashboard.server.listen(0, '127.0.0.1', resolve));
  t.after(() => dashboard.close());
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('**/api/pokemon-atlas', (route) => route.fulfill({ json: {} }));
  return { page, url: `http://127.0.0.1:${dashboard.server.address().port}` };
}

test('8-bit clicks start only on interaction and muting persists across pages and reloads', async (t) => {
  const { page, url } = await setup(t);
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on('WebAudio.contextCreated', ({ context }) => contexts.push(context));
  await cdp.send('WebAudio.enable');
  await page.goto(`${url}/colecao`);
  const sound = page.getByRole('button', { name: 'Sons de 8 bits', exact: true });
  await sound.waitFor({ timeout: 3000 });
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
  assert.equal(contexts.length, 0, 'loading the dashboard must not start audio');
  await page.locator('#catalog-refresh').evaluate((button) => button.click());
  assert.equal(contexts.length, 0, 'programmatic updates must not start audio');
  await page.locator('#catalog-refresh').click();
  await page.waitForFunction(() => navigator.userActivation.hasBeenActive);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(contexts.filter(({ contextType }) => contextType === 'realtime').length, 1);
  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  await page.goto(`${url}/colecao`);
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  const count = contexts.length;
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  assert.equal(contexts.length, count, 'muted controls must not create audio');
  await page.reload();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  await sound.focus();
  await page.keyboard.press('Enter');
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
});

test('the synthesized click contains a short audible tone with a silent tail', async (t) => {
  const { page, url } = await setup(t);
  await page.goto(url);
  const measured = await page.evaluate(async () => {
    const { playClick } = await import('/pokedex.js');
    const context = new OfflineAudioContext(1, 22050, 44100);
    playClick(context, 'confirm');
    const samples = (await context.startRendering()).getChannelData(0);
    return {
      peak: Math.max(...samples.map(Math.abs)),
      tail: samples.slice(8820).reduce((sum, value) => sum + Math.abs(value), 0),
    };
  });
  assert.ok(measured.peak > .001 && measured.peak < .15, `unexpected volume ${measured.peak}`);
  assert.equal(measured.tail, 0, 'the click must finish within 200 ms');
});

test('audio or storage restrictions never stop the ordinary dashboard controls', async (t) => {
  const { page, url } = await setup(t);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    Object.defineProperty(window, 'AudioContext', { value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { value: undefined });
  });
  await page.goto(url);
  await page.getByRole('link', { name: 'Meus Pokémon', exact: true }).click();
  await page.getByRole('heading', { name: 'Meus Pokémon', exact: true }).waitFor();
  assert.equal(await page.locator('[data-sound-toggle]').isVisible(), false);
  assert.deepEqual(errors, []);
});
