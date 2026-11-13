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
  await page.route('**/api/pokemon-atlas', (route) => route.fulfill({ json: { species: {
    25: { name: 'Pikachu' }, 63: { name: 'Abra' }, 4: { name: 'Charmander' },
  } } }));
  page.setDefaultTimeout(3500);
  await page.goto(`http://127.0.0.1:${dashboard.server.address().port}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const card = page.locator('#profile-1');
  const actions = card.getByRole('button', { name: 'Ações, Perfil 01' });
  await actions.waitFor();
  const panel = page.getByRole('dialog', { name: 'Perfil 01' });
  assert.equal(await card.locator('form, details').count(), 0);
  assert.equal(await panel.isVisible(), false);
  await actions.click();
  return { page, actions, panel, dashboard };
}

test('capture preferences save ball policy and species while search and live updates preserve the selection', async (t) => {
  const profile = profileFixture();
  profile.planner.capture = { enabled: true, title: 'Bolas por custo-benefício', reason: 'Chance base do jogo.',
    balls: [{ id: 1, name: 'Poké Ball', priceGold: 10, purchasable: true }, { id: 2, name: 'Great Ball', priceGold: 40, purchasable: true }],
    targets: [{ id: 25, name: 'Pikachu', reason: 'Great Ball atende ao mínimo.',
      available: { id: 2, name: 'Great Ball', chance: .06, expectedGold: 666.67 } }],
    lastAttempt: { ballName: 'Great Ball', name: 'Pikachu', status: 'miss', at: Date.now() } };
  let submitted;
  const { page, panel, dashboard } = await openDashboard(t, profile, (_id, _action, settings) => {
    submitted = settings; profile.planner.settings = settings; return { settings };
  });
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  assert.equal(await panel.getByLabel('Chance mínima no automático (%)', { exact: true }).inputValue(), '0.5');
  await panel.getByLabel('Modo de captura', { exact: true }).selectOption('all');
  await panel.getByLabel('Quais espécies capturar', { exact: true }).selectOption('selected');
  const species = panel.getByLabel('Espécies para capturar', { exact: true });
  await species.selectOption(['25']);
  await panel.getByLabel('Buscar espécie para captura', { exact: true }).fill('Abra');
  await species.selectOption(['25', '63']);
  await panel.getByLabel('Comprar bolas automaticamente', { exact: true }).uncheck();
  await panel.getByLabel('Chance mínima no automático (%)', { exact: true }).fill('101');
  const save = panel.getByRole('button', { name: 'Salvar preferências', exact: true });
  await save.click();
  assert.equal(submitted, undefined);
  await panel.getByLabel('Chance mínima no automático (%)', { exact: true }).fill('0.501');
  await save.click();
  assert.equal(submitted, undefined);
  await panel.getByLabel('Chance mínima no automático (%)', { exact: true }).fill('0.57');
  await panel.getByLabel('Escolha da bola', { exact: true }).selectOption('fixed');
  await panel.getByLabel('Bola fixa', { exact: true }).selectOption('2');
  await panel.getByLabel('Teto de preço por bola (ouro)', { exact: true }).fill('1500');
  dashboard.publish();
  assert.deepEqual(await species.evaluate(e => [...e.selectedOptions].map(o => o.value).sort((a, b) => Number(a) - Number(b))), ['25', '63']);
  await save.click();
  await panel.getByText('Preferências salvas.', { exact: true }).waitFor();
  assert.equal(submitted.captureMode, 'all');
  assert.equal(submitted.captureTargets, 'selected');
  assert.deepEqual(submitted.captureSpeciesIds, [25, 63]);
  assert.equal(submitted.ballMode, 'fixed');
  assert.equal(submitted.fixedBallId, 2);
  assert.equal(submitted.autoBuyBalls, false);
  assert.equal(submitted.captureMinChancePercent, .57);
  assert.equal(submitted.ballMaxGold, 1500);
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  const assessment = panel.getByRole('region', { name: 'Avaliação de captura', exact: true });
  assert.match(await assessment.innerText(), /Great Ball.*6%/s);
  assert.match(await assessment.innerText(), /666,67/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
});

test('grouped activity preferences preserve the draft during live updates and save through the dashboard API', async (t) => {
  const profile = profileFixture();
  let submitted;
  const { page, actions, panel, dashboard } = await openDashboard(t, profile, (id, action, settings) => {
    assert.equal(id, 1);
    assert.equal(action, 'planner');
    submitted = settings;
    profile.planner.settings = { ...profile.planner.settings, ...settings, stockMinutes: 20, bossMaxMinutes: 7 };
    return { settings: profile.planner.settings };
  });
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  await panel.getByText('Buscando Pedra do Trovão', { exact: true }).waitFor({ timeout: 3500 });
  assert.equal(await panel.getByText('Pikachu está pronto para evoluir.').isVisible(), true);
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  assert.equal(await panel.getByRole('group', { name: 'Suprimentos', exact: true }).getByLabel('Reserva de ouro').count(), 1);
  assert.equal(await panel.getByRole('group', { name: 'Progressão', exact: true }).getByLabel('Evoluir automaticamente').count(), 1);
  assert.equal(await panel.getByRole('group', { name: 'Ginásios', exact: true }).getByLabel('Disputar ginásios automaticamente').count(), 1);
  assert.equal(await panel.getByRole('group', { name: 'Bosses', exact: true }).getByLabel('Enfrentar bosses automaticamente').count(), 1);
  const reserve = panel.getByLabel('Reserva de ouro');
  const save = panel.getByRole('button', { name: 'Salvar preferências' });
  await reserve.fill('-1');
  await save.click();
  await panel.getByRole('status').getByText(/Reserva de ouro/).waitFor({ timeout: 3000 });
  assert.equal(submitted, undefined);
  await reserve.fill('1234');
  const advantage = panel.getByLabel('Margem mínima de força (%)');
  await advantage.fill('201');
  await save.click();
  await panel.getByRole('status').getByText(/Margem mínima de força/).waitFor();
  assert.equal(submitted, undefined);
  await advantage.fill('40');
  await panel.getByLabel('Disputar ginásios automaticamente').uncheck();
  await panel.getByLabel('Tentativas de ginásio (últimas 24 h)').fill('0');
  await panel.getByLabel('Enfrentar bosses automaticamente').uncheck();
  await panel.getByLabel('Nível mínimo da equipe (% do recomendado)').fill('150');
  await panel.getByLabel('Reserva de fichas de boss').fill('3');
  await panel.getByLabel('Tentativas de boss (últimas 24 h)').fill('4');
  await panel.getByLabel('Duração máxima do boss (min)').fill('8');
  await panel.getByLabel('Permitir ginásios e bosses durante eventos de XP').check();
  profile.planner.settings.goldReserve = 8000;
  profile.planner.settings.gymMinAdvantagePercent = 80;
  profile.planner.settings.bossTokenReserve = 99;
  profile.planner.decision.reason = 'Estoque de poções atualizado.';
  dashboard.publish();
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  await panel.getByText('Estoque de poções atualizado.').waitFor({ timeout: 3000 });
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  assert.equal(await reserve.inputValue(), '1234');
  assert.equal(await advantage.inputValue(), '40');
  assert.equal(await panel.getByLabel('Reserva de fichas de boss').inputValue(), '3');
  const result = page.waitForResponse((response) => response.url().endsWith('/api/profiles/1/planner'));
  await save.click();
  assert.equal((await result).status(), 200);
  await panel.getByText('Preferências salvas.').waitFor({ timeout: 3000 });
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
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await actions.evaluate((button) => button === document.activeElement), true);
  await page.getByLabel('Período').selectOption('week');
  await actions.click();
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  assert.equal(await reserve.inputValue(), '1234');
  assert.equal(await panel.getByLabel('Estoque desejado (min)').inputValue(), '20');
  assert.equal(await panel.getByLabel('Duração máxima do boss (min)').inputValue(), '7');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  profile.control = 'manual';
  dashboard.publish();
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  await panel.getByText(/Planejador em pausa/).waitFor({ timeout: 3000 });
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  assert.equal(await reserve.isDisabled(), true);
  assert.equal(await advantage.isDisabled(), true);
  profile.control = 'auto';
  profile.paused = true;
  dashboard.publish();
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  await panel.getByText('Retome a conta para continuar.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
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
  const { panel } = await openDashboard(t, profile, (_id, _action, settings) => {
    submitted = settings;
    return { settings };
  });
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  await panel.getByRole('button', { name: 'Salvar preferências' }).click();
  await panel.getByText('Preferências salvas.', { exact: true }).waitFor();
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
  const { page, panel } = await openDashboard(t, profile);
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  assert.equal(await panel.getByText('Prioridade de XP', { exact: true }).isVisible(), true);
  await panel.getByRole('button', { name: 'Ginásios e bosses', exact: true }).click();
  const gym = panel.getByRole('region', { name: 'Avaliação de ginásios', exact: true });
  const boss = panel.getByRole('region', { name: 'Avaliação de bosses', exact: true });
  assert.equal(await gym.getByText(profile.planner.activities.gym.reason, { exact: true }).isVisible(), true);
  assert.equal(await boss.getByText(profile.planner.activities.boss.reason, { exact: true }).isVisible(), true);
  assert.match(await gym.innerText(), /1,35×/);
  assert.match(await gym.innerText(), /5% → 10%/);
  assert.match(await gym.innerText(), /últimas 24 h.*1 de 2/);
  assert.match(await boss.innerText(), /1 disponíve(?:l|is).*custo de 1/);
  const active = panel.getByRole('region', { name: 'Tentativa em andamento', exact: true });
  assert.match(await active.innerText(), /Boss.*Articuno.*Em combate/);
  const history = panel.getByRole('region', { name: 'Histórico de tentativas', exact: true });
  assert.equal(await history.getByRole('listitem').count(), 10);
  assert.match(await history.innerText(), /Vitória/);
  assert.match(await history.innerText(), /Resultado incerto/);
  assert.match(await history.innerText(), /1 min 5 s/);
  assert.equal(await history.getByText('Tentativa anterior 9.', { exact: false }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await panel.locator('[data-page="activities"]').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
});

test('partial activity data falls back to waiting without leaking undefined values or markup', async (t) => {
  const profile = profileFixture();
  profile.planner.activities = {
    gym: { code: 'data', title: 'Aguardando equipe', reason: 'Equipe incompleta.' },
    boss: null,
    active: null,
    history: [{ kind: 'boss', target: '<img src=x onerror=alert(1)>', status: 'uncertain', note: 'Sem confirmação.' }],
  };
  const { panel, dashboard } = await openDashboard(t, profile);
  await panel.getByRole('button', { name: 'Ginásios e bosses', exact: true }).click();
  const gym = panel.getByRole('region', { name: 'Avaliação de ginásios', exact: true });
  const boss = panel.getByRole('region', { name: 'Avaliação de bosses', exact: true });
  assert.match(await gym.innerText(), /Equipe incompleta/);
  assert.match(await boss.innerText(), /Aguardando avaliação/);
  assert.equal(await panel.getByRole('region', { name: 'Tentativa em andamento', exact: true }).count(), 0);
  assert.equal(await panel.locator('.planner-activities img').count(), 0);
  assert.doesNotMatch(await panel.locator('.planner-activities').innerText(), /undefined|NaN|\[object Object\]/);
  profile.planner.activities = null;
  profile.planner.decision.reason = 'Nova avaliação solicitada.';
  dashboard.publish();
  await gym.getByText('Aguardando avaliação', { exact: true }).waitFor();
  assert.match(await gym.innerText(), /Aguardando avaliação/);
  assert.match(await panel.getByRole('region', { name: 'Histórico de tentativas', exact: true }).innerText(), /Nenhuma tentativa registrada/);
});

test('autonomous strategy exposes decisions and reservations with defaults that need no configuration', async (t) => {
  const profile = profileFixture();
  profile.planner.strategy = { objective: 'Equilibrar progressão, equipe e rendimento',
    horizon: [{ title: 'Outland', level: 150, remaining: 10, reason: 'Liberar drops.' }],
    opportunities: [{ id: 'bike', title: 'Melhorar a bicicleta', status: 'ready', reason: 'Ganho de velocidade.' }],
    reserves: [{ name: 'Primeira casa', quantity: 10, reason: 'Benefício permanente.' }],
    history: [{ title: '<img src=x onerror=alert(1)>', status: 'confirmed', note: 'Efeito confirmado.', at: Date.now() }],
    coverage: [{ title: 'Safári', status: 'observed', reason: 'Ticket preservado.' }] };
  let submitted;
  const { panel } = await openDashboard(t, profile, (id, action, settings) => { submitted = settings; return { settings }; });
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  const strategy = panel.getByRole('region', { name: 'Estratégia da conta', exact: true });
  await strategy.waitFor();
  assert.match(await strategy.innerText(), /Equilibrar progressão/);
  assert.match(await strategy.innerText(), /Melhorar a bicicleta/);
  assert.match(await strategy.innerText(), /Primeira casa.*10/s);
  assert.equal(await strategy.locator('img').count(), 0);
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  const group = panel.getByRole('group', { name: 'Autonomia', exact: true });
  assert.equal(await group.getByLabel('Resgatar recompensas disponíveis').isChecked(), true);
  assert.equal(await group.getByLabel('Gerenciar equipe e principal').isChecked(), true);
  assert.equal(await group.getByLabel('Incubar Mystery Eggs disponíveis').isChecked(), true);
  await group.getByLabel('Ganho mínimo para trocar principal (%)').fill('35');
  await panel.getByRole('button', { name: 'Salvar preferências' }).click();
  await panel.getByText('Preferências salvas.').waitFor();
  assert.equal(submitted.teamMinGainPercent, 35);
  assert.equal(submitted.autoRewards, true);
});
