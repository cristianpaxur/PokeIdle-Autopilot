import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createDashboard } from '../src/dashboard.mjs';

test('the dashboard keeps the hunt view and metrics visible while profile actions open separately', async (t) => {
  const profiles = [{
    id: 1, active: true, status: 'setup', mode: 'farm', phase: 'progression', level: 45,
    attention: { kind: 'action', text: 'Conclua a configuração inicial no jogo.' },
    metrics: {}, captures: [], listings: [], sales: [], withdrawals: [], paid: [],
  }, {
    id: 2, active: true, status: 'hunting', mode: 'shiny', phase: 'shiny', hunt: 'rota-azul',
    preview: 123,
    pokemon: { name: 'Pikachu', speciesId: 25, level: 32 },
    lastProgressAt: Date.now(), metrics: {}, captures: [], listings: [], sales: [], withdrawals: [], paid: [],
    periods: { today: { shiny: { huntMs: 3_600_000, encounters: 100, balls: 40 } },
      week: { shiny: { huntMs: 7_200_000, encounters: 300, balls: 80 } } },
  }];
  const state = { profiles };
  const dashboard = createDashboard({ snapshot: () => state, command: () => {} });
  await new Promise((resolve) => dashboard.server.listen(0, '127.0.0.1', resolve));
  t.after(() => dashboard.close());
  const browser = await chromium.launch({ channel: 'msedge' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('https://raw.githubusercontent.com/**', (route) => route.abort());
  await page.route('**/api/profiles/2/preview?v=123', (route) => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf7sAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.goto(`http://127.0.0.1:${dashboard.server.address().port}`);
  await page.getByText('Conclua a configuração inicial no jogo.').first().waitFor({ timeout: 3000 });
  assert.match(await page.locator('#attention-list').textContent(), /Perfil 01/);
  const shiny = page.locator('#profile-2');
  assert.match(await shiny.textContent(), /100 encontros elegíveis\/h/);
  assert.doesNotMatch(await shiny.textContent(), /Medindo XP/);
  await page.getByLabel('Período').selectOption('week');
  assert.match(await shiny.textContent(), /150 encontros elegíveis\/h/);
  const preview = shiny.getByRole('img', { name: 'Cena da caça de Perfil 02' });
  await shiny.locator('.view').scrollIntoViewIfNeeded({ timeout: 3000 });
  await preview.waitFor({ timeout: 3000 });
  assert.equal(await shiny.locator('details, form').count(), 0);
  const actions = shiny.getByRole('button', { name: 'Ações, Perfil 02' });
  await actions.click();
  const panel = page.getByRole('dialog', { name: 'Perfil 02' });
  assert.equal(await panel.getByLabel('Modo de caça, Perfil 02').isVisible(), true);
  await panel.getByRole('button', { name: 'Mercado', exact: true }).click();
  assert.equal(await panel.getByLabel('Modo de caça, Perfil 02').isVisible(), false);
  await panel.getByRole('button', { name: 'Voltar aos perfis' }).click();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await actions.evaluate((button) => button === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  state.remote = true;
  dashboard.publish();
  await page.getByRole('button', { name: 'Ver 4 telas' }).click();
  assert.equal(await shiny.locator('.view').isVisible(), true);
  await page.getByRole('button', { name: 'Voltar ao painel' }).click();
  assert.equal(await shiny.locator('.view').isVisible(), true);
});
