import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createDashboard } from '../src/dashboard.mjs';

test('the dashboard shows phase metrics and the hunt view together in each profile', async (t) => {
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
  const dashboard = createDashboard({ snapshot: () => ({ profiles }), command: () => {} });
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
  await shiny.locator('.view').scrollIntoViewIfNeeded({ timeout: 3000 });
  await shiny.getByRole('img', { name: 'Cena da caça de Perfil 02' }).waitFor({ timeout: 3000 });
  assert.equal(await shiny.evaluate((card) => Boolean(card.querySelector('.phase-stats')
    .compareDocumentPosition(card.querySelector('.view')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});
