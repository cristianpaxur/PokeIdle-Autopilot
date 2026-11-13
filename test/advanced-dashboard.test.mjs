import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createDashboard } from '../src/dashboard.mjs';
import { plannerSettings } from '../src/planning.mjs';

function profileFixture() {
  return {
    id: 1, active: true, status: 'hunting', mode: 'farm', phase: 'progression',
    metrics: {}, captures: [], listings: [], sales: [], withdrawals: [], paid: [],
    planner: {
      settings: { autoPotions: true, autoRevives: true, goldReserve: 10000, supplyGoldPerHour: 10000,
        stockMinutes: 10, hpThreshold: 50, autoEvolve: true, farmStones: true, stoneMinutes: 10, prioritizeXpEvents: true },
      decision: { code: 'xp', title: 'Prioridade de XP', reason: 'A caça continua durante o PvP e a inscrição de raid.' },
      supplies: [], activities: { gym: null, boss: null, active: null, history: [] },
    },
  };
}

async function openDashboard(t, profile, command) {
  const dashboard = createDashboard({ snapshot: () => ({ profiles: [profile] }), command });
  await new Promise(resolve => dashboard.server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => {
    try { await browser?.close(); } finally { await dashboard.close(); }
  });
  browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/api/pokemon-atlas', route => route.fulfill({ json: { species: { 25: { name: 'Pikachu' } } } }));
  page.setDefaultTimeout(3500);
  await page.goto(`http://127.0.0.1:${dashboard.server.address().port}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.locator('#profile-1').getByRole('button', { name: 'Ações, Perfil 01' }).click();
  return { page, panel: page.getByRole('dialog', { name: 'Perfil 01' }), dashboard };
}

test('older snapshots save enabled PvP, Safari and raid defaults without requiring configuration', async t => {
  const profile = profileFixture();
  let submitted;
  const { panel } = await openDashboard(t, profile, (id, action, settings) => {
    assert.equal(id, 1);
    assert.equal(action, 'planner');
    submitted = settings;
    return { settings: plannerSettings(settings) };
  });
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  assert.equal(await panel.getByRole('group', { name: 'PvP', exact: true }).getByLabel('Participar do PvP automaticamente').isChecked(), true);
  assert.equal(await panel.getByRole('group', { name: 'Safári', exact: true }).getByLabel('Visitar o Safári automaticamente').isChecked(), true);
  assert.equal(await panel.getByRole('group', { name: 'Raids semanais', exact: true }).getByLabel('Participar de raids automaticamente').isChecked(), true);
  await panel.getByRole('button', { name: 'Salvar preferências', exact: true }).click();
  await panel.getByText('Preferências salvas.', { exact: true }).waitFor();
  for (const [name, value] of Object.entries({
    autoPvp: true, pvpAttemptsPerDay: 12, pvpQueueMinutes: 3, pvpLossStreak: 2, pvpRestMinutes: 60,
    autoSafari: true, safariTicketsPerDay: 1, safariMinBalls: 40, safariMinTargets: 3,
    autoRaids: true, raidTokenReserve: 1, raidMinGainPercent: 10,
  })) assert.equal(submitted[name], value, name);
});

test('advanced activity preferences reject invalid limits and preserve the draft until a valid save', async t => {
  const profile = profileFixture();
  let submitted;
  const { panel, dashboard } = await openDashboard(t, profile, (_id, _action, settings) => {
    submitted = settings;
    profile.planner.settings = plannerSettings(settings);
    return { settings: profile.planner.settings };
  });
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  const save = panel.getByRole('button', { name: 'Salvar preferências', exact: true });
  const cases = [
    ['pvpAttemptsPerDay', 'Tentativas de PvP (últimas 24 h)', -1, 6],
    ['pvpQueueMinutes', 'Espera máxima na fila de PvP (min)', 16, 4],
    ['pvpLossStreak', 'Derrotas seguidas antes da pausa', 0, 3],
    ['pvpRestMinutes', 'Pausa após derrotas de PvP (min)', 1441, 90],
    ['safariTicketsPerDay', 'Tickets de Safári (últimas 24 h)', 4, 2],
    ['safariMinBalls', 'Estoque mínimo de bolas para o Safári', 0, 80],
    ['safariMinTargets', 'Espécies de interesse mínimas no Safári', 101, 5],
    ['raidTokenReserve', 'Reserva de fichas de raid', -1, 3],
    ['raidMinGainPercent', 'Ganho mínimo para atualizar equipe da raid (%)', 0, 20],
  ];
  for (const [, label, invalid, valid] of cases) {
    const input = panel.getByLabel(label, { exact: true });
    await input.fill(String(invalid));
    await save.click();
    await panel.getByRole('status').getByText(label, { exact: false }).waitFor();
    assert.equal(submitted, undefined, `${label} must not be submitted outside its limits`);
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    await input.fill(String(valid));
  }
  await panel.getByLabel('Participar do PvP automaticamente').uncheck();
  await panel.getByLabel('Visitar o Safári automaticamente').uncheck();
  await panel.getByLabel('Participar de raids automaticamente').uncheck();
  profile.planner.settings = plannerSettings({ pvpAttemptsPerDay: 9, safariMinBalls: 200, raidTokenReserve: 10 });
  profile.planner.decision.reason = 'Dados da conta atualizados durante a edição.';
  dashboard.publish();
  await panel.getByRole('button', { name: 'Planejador', exact: true }).click();
  await panel.getByText('Dados da conta atualizados durante a edição.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Preferências', exact: true }).click();
  for (const [, label, , value] of cases) assert.equal(await panel.getByLabel(label, { exact: true }).inputValue(), String(value));
  await save.click();
  await panel.getByText('Preferências salvas.', { exact: true }).waitFor();
  for (const [name, , , value] of cases) assert.equal(submitted[name], value, name);
  assert.equal(submitted.autoPvp, false);
  assert.equal(submitted.autoSafari, false);
  assert.equal(submitted.autoRaids, false);
});

test('advanced activity assessments show decisions, mode-specific costs, teams, stock and raid deadlines as text', async t => {
  const profile = profileFixture();
  const markup = '<img src=x onerror=alert(1)>';
  profile.planner.activities = {
    pvp: { ready: true, code: 'ready', title: 'Entrar na fila ranqueada', action: 'queue',
      reason: `Equipe confirmada ${markup}`, target: 'ranked', pokemonIds: [101, 102], attempts: 3, limit: 12, cost: 0 },
    safari: { ready: false, code: 'stock', title: 'Aguardando bolas', action: 'enter',
      reason: 'Aguardar estoque antes de consumir o ticket.', target: 'safari', itemId: 70095, cost: 1,
      attempts: 1, ticketsUsed: 1, limit: 2, ballStock: 25, minBalls: 40, depot: { free: 6 } },
    raid: { ready: true, code: 'ready', title: `Inscrever na raid ${markup}`, action: 'register',
      reason: 'Inscrição pessoal com a reserva preservada.', target: '2026-week-46', pokemonIds: [103, 104, 105],
      itemId: 70098, tokens: 5, cost: 1, reserve: 2,
      registrationDeadline: Date.UTC(2026, 10, 16, 18), teamDeadline: Date.UTC(2026, 10, 17, 18) },
    active: { kind: 'pvp', target: 'ranked', stage: 'queued', at: Date.now() - 5000 },
    history: [
      { kind: 'pvp', target: 'ranked', result: 'win', status: 'confirmed', note: 'Resultado da partida confirmado.' },
      { kind: 'safari', target: 'safari', result: 'completed', status: 'confirmed', note: 'Visita encerrada e retorno confirmado.' },
      { kind: 'safari', target: markup, result: 'captured', status: 'confirmed', note: `Nova captura ${markup}` },
      { kind: 'raid', target: '2026-week-46', result: 'team', status: 'confirmed', note: 'Equipe confirmada pelo jogo.' },
    ],
  };
  const { page, panel } = await openDashboard(t, profile);
  await panel.getByRole('button', { name: 'Ginásios e bosses', exact: true }).click();
  const pvp = panel.getByRole('region', { name: 'Avaliação de PvP', exact: true });
  const safari = panel.getByRole('region', { name: 'Avaliação de Safári', exact: true });
  const raid = panel.getByRole('region', { name: 'Avaliação de raids', exact: true });
  assert.match(await pvp.innerText(), /Entrar na fila/);
  assert.match(await pvp.innerText(), /3 de 12/);
  assert.match(await pvp.innerText(), /#101.*#102/);
  assert.match(await pvp.innerText(), /Gratuito/);
  assert.equal(await pvp.getByText(`Equipe confirmada ${markup}`, { exact: true }).count(), 1);
  assert.match(await safari.innerText(), /Aguardar estoque/);
  assert.match(await safari.innerText(), /Tickets de Safári.*custo de 1/s);
  assert.match(await safari.innerText(), /Tickets usados nas últimas 24 h.*1 de 2/s);
  assert.match(await safari.innerText(), /Bolas apropriadas.*25.*40/s);
  assert.match(await safari.innerText(), /Vagas no Depot.*6/s);
  assert.match(await raid.innerText(), /Fichas de raid.*5 disponíveis.*custo de 1.*reserva de 2/s);
  assert.match(await raid.innerText(), /#103.*#104.*#105/);
  assert.match(await raid.innerText(), /Inscrições até.*16\/11/s);
  assert.match(await raid.innerText(), /Equipe até.*17\/11/s);
  for (const section of [pvp, safari, raid]) assert.doesNotMatch(await section.innerText(), /Fichas de boss/);
  const active = panel.getByRole('region', { name: 'Tentativa em andamento', exact: true });
  assert.match(await active.innerText(), /PvP.*Na fila/);
  const history = panel.getByRole('region', { name: 'Histórico de tentativas', exact: true });
  assert.equal(await history.getByRole('listitem').count(), 4);
  assert.match(await history.innerText(), /PvP.*Vitória/);
  assert.match(await history.innerText(), /Safári.*Concluída/);
  assert.match(await history.innerText(), /Safári.*Captura confirmada/);
  assert.match(await history.innerText(), /Raid semanal.*Equipe atualizada/);
  assert.equal(await panel.locator('.planner-activities img, .planner-activities script').count(), 0);
  assert.doesNotMatch(await panel.locator('.planner-activities').innerText(), /undefined|NaN|\[object Object\]/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await panel.locator('[data-page="activities"]').evaluate(element => element.scrollWidth <= element.clientWidth), true);
});

test('live advanced activity stages stay readable and incomplete snapshots return to waiting', async t => {
  const profile = profileFixture();
  profile.planner.activities = { pvp: null, safari: null, raid: null,
    active: { kind: 'pvp', target: 'ranked', stage: 'preparing' }, history: [] };
  const { panel, dashboard } = await openDashboard(t, profile);
  await panel.getByRole('button', { name: 'Ginásios e bosses', exact: true }).click();
  for (const label of ['PvP', 'Safári', 'raids']) {
    assert.match(await panel.getByRole('region', { name: `Avaliação de ${label}`, exact: true }).innerText(), /Aguardando avaliação/);
  }
  const active = panel.getByRole('region', { name: 'Tentativa em andamento', exact: true });
  const stages = [
    ['pvp', 'preparing', 'Preparando atividade'], ['pvp', 'disarming', 'Desativando repetição automática'],
    ['pvp', 'saving', 'Salvando equipe'], ['pvp', 'joining', 'Entrando na fila'],
    ['pvp', 'queued', 'Na fila'], ['pvp', 'cancelling', 'Cancelando busca'],
    ['raid', 'registering', 'Confirmando inscrição'], ['raid', 'registered', 'Equipe registrada'],
    ['safari', 'entering', 'Entrando no Safári'], ['safari', 'capturing', 'Capturando no Safári'],
    ['safari', 'returning', 'Retornando à caça'],
  ];
  for (const [kind, stage, label] of stages) {
    profile.planner.activities.active = { kind, target: kind === 'pvp' ? 'ranked' : kind, stage };
    dashboard.publish();
    await active.getByText(label, { exact: false }).waitFor();
    assert.doesNotMatch(await active.innerText(), /Atividade|undefined|NaN/);
  }
  profile.planner.activities = { pvp: { title: {}, reason: [], pokemonIds: [null, {}, '<img src=x>', 101] },
    safari: { ballStock: {}, minBalls: null, depot: { free: 'unknown' } },
    raid: { registrationDeadline: null, teamDeadline: 'unknown', tokens: {}, cost: null }, history: [] };
  dashboard.publish();
  await active.waitFor({ state: 'detached' });
  assert.doesNotMatch(await panel.locator('.planner-activities').innerText(), /undefined|NaN|\[object Object\]/);
  assert.equal(await panel.locator('.planner-activities img').count(), 0);
});
