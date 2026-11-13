import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createDashboard } from '../src/dashboard.mjs';

function profileFixture() {
  return {
    id: 1, active: true, status: 'hunting', mode: 'farm', phase: 'progression',
    metrics: {}, captures: [], listings: [], sales: [], withdrawals: [], paid: [],
    planner: {
      settings: { autoPotions: true, autoRevives: true, goldReserve: 10000, supplyGoldPerHour: 10000,
        stockMinutes: 10, hpThreshold: 50, autoEvolve: true, farmStones: true, stoneMinutes: 10, prioritizeXpEvents: true,
        autoGyms: true, gymMinAdvantagePercent: 25, gymAttemptsPerDay: 2, autoBosses: true,
        bossTeamLevelPercent: 120, bossTokenReserve: 1, bossAttemptsPerDay: 2, bossMaxMinutes: 10,
        activitiesDuringXpEvents: false },
      decision: { code: 'stone', title: 'Buscando Pedra do Trovão', reason: 'Pikachu está pronto para evoluir.', since: Date.now() },
      supplies: [{ category: 'potion', itemId: 1, name: 'Poção', have: 3, target: 6, heal: 20 }],
      evolution: { pokemonId: 25, from: 25, to: 26, targetName: 'Raichu', level: 30,
        stoneId: 3, stoneName: 'Pedra do Trovão', have: 0, ready: false, reason: 'Falta a pedra.' },
      bonuses: { trainerMultiplier: 2, pokemonMultiplier: 1, sources: [], seasonal: null,
        event: { trainerPercent: 100, pokemonPercent: 0, farmPercent: 0, until: Date.now() + 3600_000 } },
      spending: { used: 300, limit: 10000, available: 9700 }, lastAction: null,
      activities: { gym: null, boss: null, active: null, history: [] },
    },
  };
}

async function openDashboard(t, profile, command) {
  const dashboard = createDashboard({
    snapshot: () => ({ profiles: [profile] }),
    command,
  });
  await new Promise((resolve) => dashboard.server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      await dashboard.close();
    }
  });
  browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(3500);
  await page.goto(`http://127.0.0.1:${dashboard.server.address().port}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const card = page.locator('#profile-1');
  await card.getByText('Planejador', { exact: true }).waitFor();
  return { page, card, dashboard };
}

test('grouped activity preferences preserve the draft during live updates and save through the dashboard API', async (t) => {
  const profile = profileFixture();
  let submitted;
  const { page, card, dashboard } = await openDashboard(t, profile, (id, action, settings) => {
    assert.equal(id, 1);
    assert.equal(action, 'planner');
    submitted = settings;
    profile.planner.settings = { ...profile.planner.settings, ...settings, stockMinutes: 20, bossMaxMinutes: 7 };
    return { settings: profile.planner.settings };
  });
  await card.getByText('Buscando Pedra do Trovão', { exact: true }).waitFor({ timeout: 3500 });
  assert.equal(await card.getByText('Pikachu está pronto para evoluir.').isVisible(), true);
  await card.getByText('Planejador', { exact: true }).click();
  assert.equal(await card.getByRole('group', { name: 'Suprimentos', exact: true }).getByLabel('Reserva de ouro').count(), 1);
  assert.equal(await card.getByRole('group', { name: 'Progressão', exact: true }).getByLabel('Evoluir automaticamente').count(), 1);
  assert.equal(await card.getByRole('group', { name: 'Ginásios', exact: true }).getByLabel('Disputar ginásios automaticamente').count(), 1);
  assert.equal(await card.getByRole('group', { name: 'Bosses', exact: true }).getByLabel('Enfrentar bosses automaticamente').count(), 1);
  const reserve = card.getByLabel('Reserva de ouro');
  const save = card.getByRole('button', { name: 'Salvar preferências' });
  await reserve.fill('-1');
  await save.click();
  await card.getByRole('status').getByText(/Reserva de ouro/).waitFor({ timeout: 3000 });
  assert.equal(submitted, undefined);
  await reserve.fill('1234');
  const advantage = card.getByLabel('Margem mínima de força (%)');
  await advantage.fill('201');
  await save.click();
  await card.getByRole('status').getByText(/Margem mínima de força/).waitFor();
  assert.equal(submitted, undefined);
  await advantage.fill('40');
  await card.getByLabel('Disputar ginásios automaticamente').uncheck();
  await card.getByLabel('Tentativas de ginásio (últimas 24 h)').fill('0');
  await card.getByLabel('Enfrentar bosses automaticamente').uncheck();
  await card.getByLabel('Nível mínimo da equipe (% do recomendado)').fill('150');
  await card.getByLabel('Reserva de fichas de boss').fill('3');
  await card.getByLabel('Tentativas de boss (últimas 24 h)').fill('4');
  await card.getByLabel('Duração máxima do boss (min)').fill('8');
  await card.getByLabel('Permitir ginásios e bosses durante eventos de XP').check();
  profile.planner.settings.goldReserve = 8000;
  profile.planner.settings.gymMinAdvantagePercent = 80;
  profile.planner.settings.bossTokenReserve = 99;
  profile.planner.decision.reason = 'Estoque de poções atualizado.';
  dashboard.publish();
  await card.getByText('Estoque de poções atualizado.').waitFor({ timeout: 3000 });
  assert.equal(await reserve.inputValue(), '1234');
  assert.equal(await advantage.inputValue(), '40');
  assert.equal(await card.getByLabel('Reserva de fichas de boss').inputValue(), '3');
  const result = page.waitForResponse((response) => response.url().endsWith('/api/profiles/1/planner'));
  await save.click();
  assert.equal((await result).status(), 200);
  await card.getByText('Preferências salvas.').waitFor({ timeout: 3000 });
  assert.equal(submitted.goldReserve, 1234);
  assert.equal(submitted.autoGyms, false);
  assert.equal(submitted.gymMinAdvantagePercent, 40);
  assert.equal(submitted.gymAttemptsPerDay, 0);
  assert.equal(submitted.autoBosses, false);
  assert.equal(submitted.bossTeamLevelPercent, 150);
  assert.equal(submitted.bossTokenReserve, 3);
  assert.equal(submitted.bossAttemptsPerDay, 4);
  assert.equal(submitted.bossMaxMinutes, 8);
  assert.equal(submitted.activitiesDuringXpEvents, true);
  await page.getByLabel('Período').selectOption('week');
  assert.equal(await reserve.inputValue(), '1234');
  assert.equal(await card.getByLabel('Estoque desejado (min)').inputValue(), '20');
  assert.equal(await card.getByLabel('Duração máxima do boss (min)').inputValue(), '7');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  profile.control = 'manual';
  dashboard.publish();
  await card.getByText(/Planejador em pausa/).waitFor({ timeout: 3000 });
  assert.equal(await reserve.isDisabled(), true);
  assert.equal(await advantage.isDisabled(), true);
  profile.control = 'auto';
  profile.paused = true;
  dashboard.publish();
  await card.getByText('Retome a conta para continuar.', { exact: true }).waitFor();
  assert.equal(await advantage.isDisabled(), false);
});

test('older snapshots supply activity defaults that can be saved without blank numeric fields', async (t) => {
  const profile = profileFixture();
  for (const name of ['autoGyms', 'gymMinAdvantagePercent', 'gymAttemptsPerDay', 'autoBosses',
    'bossTeamLevelPercent', 'bossTokenReserve', 'bossAttemptsPerDay', 'bossMaxMinutes', 'activitiesDuringXpEvents']) {
    delete profile.planner.settings[name];
  }
  delete profile.planner.activities;
  let submitted;
  const { card } = await openDashboard(t, profile, (_id, _action, settings) => {
    submitted = settings;
    return { settings };
  });
  await card.getByText('Planejador', { exact: true }).click();
  await card.getByRole('button', { name: 'Salvar preferências' }).click();
  await card.getByText('Preferências salvas.', { exact: true }).waitFor();
  assert.equal(submitted.autoGyms, true);
  assert.equal(submitted.gymMinAdvantagePercent, 25);
  assert.equal(submitted.gymAttemptsPerDay, 2);
  assert.equal(submitted.autoBosses, true);
  assert.equal(submitted.bossTeamLevelPercent, 120);
  assert.equal(submitted.bossTokenReserve, 1);
  assert.equal(submitted.bossAttemptsPerDay, 2);
  assert.equal(submitted.bossMaxMinutes, 10);
  assert.equal(submitted.activitiesDuringXpEvents, false);
});

test('activity evaluations and recent attempts stay visible while XP is the main decision', async (t) => {
  const profile = profileFixture();
  profile.planner.decision = { code: 'xp', title: 'Prioridade de XP', reason: 'Evento de XP em andamento.' };
  const started = Date.now() - 90_000;
  profile.planner.activities = {
    gym: { code: 'event', title: 'Ginásio adiado pelo evento', ready: false,
      reason: 'A equipe melhora o bônus, mas o evento de XP tem prioridade.',
      target: 'FIRE', powerRatio: 1.35, bonusBefore: 5, bonusAfter: 10, attempts: 1, limit: 2 },
    boss: { code: 'reserve', title: 'Fichas preservadas', ready: false,
      reason: 'A tentativa deixaria o saldo abaixo da reserva de fichas.',
      target: 'articuno', tokens: 1, cost: 1, attempts: 0, limit: 2 },
    active: { kind: 'boss', target: 'articuno', stage: 'fighting', at: started },
    history: [
      { kind: 'gym', target: 'FIRE', at: started - 60_000, status: 'confirmed', result: 'win',
        note: 'Bônus confirmado após a disputa.', durationMs: 65_000 },
      { kind: 'boss', target: 'articuno', at: started - 120_000, status: 'uncertain', result: null,
        note: 'Resultado sem confirmação; nova tentativa bloqueada.', durationMs: 30_000 },
      ...Array.from({ length: 9 }, (_, i) => ({ kind: 'gym', target: 'WATER', at: started - (i + 3) * 60_000,
        status: 'confirmed', result: 'loss', note: `Tentativa anterior ${i + 1}.`, durationMs: 1000 })),
    ],
  };
  const { page, card } = await openDashboard(t, profile);
  await card.getByText('Planejador', { exact: true }).click();
  assert.equal(await card.getByText('Prioridade de XP', { exact: true }).isVisible(), true);
  const gym = card.getByRole('region', { name: 'Avaliação de ginásios', exact: true });
  const boss = card.getByRole('region', { name: 'Avaliação de bosses', exact: true });
  assert.equal(await gym.getByText(profile.planner.activities.gym.reason, { exact: true }).isVisible(), true);
  assert.equal(await boss.getByText(profile.planner.activities.boss.reason, { exact: true }).isVisible(), true);
  assert.match(await gym.innerText(), /1,35×/);
  assert.match(await gym.innerText(), /5% → 10%/);
  assert.match(await gym.innerText(), /últimas 24 h.*1 de 2/);
  assert.match(await boss.innerText(), /1 disponíve(?:l|is).*custo de 1/);
  const active = card.getByRole('region', { name: 'Tentativa em andamento', exact: true });
  assert.match(await active.innerText(), /Boss.*Articuno.*Em combate/);
  const history = card.getByRole('region', { name: 'Histórico de tentativas', exact: true });
  assert.equal(await history.getByRole('listitem').count(), 10);
  assert.match(await history.innerText(), /Vitória/);
  assert.match(await history.innerText(), /Resultado incerto/);
  assert.match(await history.innerText(), /1 min 5 s/);
  assert.equal(await history.getByText('Tentativa anterior 9.', { exact: false }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await card.locator('.profile-planner').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
});

test('partial activity data falls back to waiting without leaking undefined values or markup', async (t) => {
  const profile = profileFixture();
  profile.planner.activities = {
    gym: { code: 'data', title: 'Aguardando equipe', reason: 'Equipe incompleta.' },
    boss: null,
    active: null,
    history: [{ kind: 'boss', target: '<img src=x onerror=alert(1)>', status: 'uncertain', note: 'Sem confirmação.' }],
  };
  const { card, dashboard } = await openDashboard(t, profile);
  await card.getByText('Planejador', { exact: true }).click();
  const gym = card.getByRole('region', { name: 'Avaliação de ginásios', exact: true });
  const boss = card.getByRole('region', { name: 'Avaliação de bosses', exact: true });
  assert.match(await gym.innerText(), /Equipe incompleta/);
  assert.match(await boss.innerText(), /Aguardando avaliação/);
  assert.equal(await card.getByRole('region', { name: 'Tentativa em andamento', exact: true }).count(), 0);
  assert.equal(await card.locator('.planner-activities img').count(), 0);
  assert.doesNotMatch(await card.locator('.planner-activities').innerText(), /undefined|NaN|\[object Object\]/);
  profile.planner.activities = null;
  profile.planner.decision.reason = 'Nova avaliação solicitada.';
  dashboard.publish();
  await card.getByText('Nova avaliação solicitada.', { exact: true }).waitFor();
  assert.match(await gym.innerText(), /Aguardando avaliação/);
  assert.match(await card.getByRole('region', { name: 'Histórico de tentativas', exact: true }).innerText(), /Nenhuma tentativa registrada/);
});
