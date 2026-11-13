import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

export const GAME_URL = 'https://pokeidle.io/app';
const GAME_ORIGIN = new URL(GAME_URL).origin;
const GAME_SOCKET = 'wss://pokeidle.io/';
const BUTTON_WAIT = 1800;
const CAPTURE_WAIT = 4000;
const GYM_DATA_WAIT = 4500;
const click = (page, selector) => page.locator(selector).first().click({ timeout: BUTTON_WAIT });

export async function acceptGameUpdate(page) {
  const button = page.locator('#aviso-versao:visible #aviso-versao-btn:visible');
  if (!(await button.isVisible())
    || await page.locator('#confirmar:visible, #termos-aceite:visible').first().isVisible()) return false;
  await button.click({ timeout: BUTTON_WAIT });
  return true;
}

export async function clickCapture(page, species, { ball: selected, slot, canAct = () => true } = {}) {
  if (!canAct() || slot != null && !/^\d+$/.test(String(slot))) return false;
  const ball = selected ? page.locator('#caidos-bolas .caidos-bola:visible')
    .and(page.getByTitle(new RegExp(`^${RegExp.escape(selected.name)}\\s+—`))).first()
    : page.locator('#caidos-bolas .caidos-bola.on:visible').first();
  let targets = page.locator(`#caidos-lista .caido:not(.acabando):visible${slot == null ? '' : `[data-slot="${slot}"]`}`);
  if (species?.length) {
    const names = species.map((name) => RegExp.escape(name)).join('|');
    const label = page.locator('.caido-quem').filter({ hasText: new RegExp(`^(?:${names})\\s+Nv\\d+`) });
    targets = targets.filter({ has: label });
  }
  const target = targets.first();
  if (!(await ball.isVisible()) || !(await target.isVisible())) return false;
  try {
    if (selected) {
      if (!canAct()) return false;
      await ball.click({ timeout: BUTTON_WAIT });
    }
    await target.click({ trial: true, timeout: CAPTURE_WAIT });
    if (!await target.isVisible() || !await ball.and(page.locator('.on')).isVisible() || !canAct()) return false;
    await target.click({ timeout: 500 });
    return true;
  } catch (error) {
    if (error.name === 'TimeoutError') return false;
    throw error;
  }
}

export async function prepareListing(page, pokemon, price, days) {
  if (await page.locator('#confirmar:visible').isVisible()) return false;
  if (!(await page.locator('#cm-anunciar:visible').isVisible())) await click(page, 'button[data-modal="community"]:visible');
  await click(page, '#cm-anunciar:visible');
  await click(page, '.cm-escolha [data-tipo="pokemon"]:visible, button[data-tipo="pokemon"]:visible');
  const search = page.locator('#cm-pks-busca:visible');
  if (await search.isVisible()) await search.fill(pokemon.name);
  const card = page.locator(`#cm-pks [data-chave="cm-sel${pokemon.id}"]:visible`);
  try {
    await card.waitFor({ timeout: BUTTON_WAIT });
  } catch (error) {
    if (error.name === 'TimeoutError') return false;
    throw error;
  }
  await card.click({ timeout: BUTTON_WAIT });
  await click(page, '.cm-moedas-anuncio [data-moeda="orb"]:visible');
  const priceInput = page.locator('#cm-preco:visible');
  await priceInput.fill(String(price), { timeout: BUTTON_WAIT });
  if (!(await page.locator('.cm-moedas-anuncio [data-moeda="orb"].on:visible').isVisible())
    || Number(await priceInput.inputValue()) !== price || !await priceInput.evaluate((input) => input.checkValidity())) return false;
  await click(page, '#cm-publicar:visible');
  const duration = page.locator('#cm-dias:visible');
  if (Number(await duration.inputValue({ timeout: BUTTON_WAIT })) !== days) return false;
  await click(page, '#cm-dias-ok:visible');
  return page.locator('#confirmar:visible #confirmar-texto .dlg-custo').isVisible();
}

export async function prepareWithdrawal(page, amount, wallet) {
  if (await page.locator('#confirmar:visible').isVisible()) return false;
  if (!(await page.locator('#cm-withdraw:visible').isVisible())) await click(page, 'button[data-modal="community"]:visible');
  await click(page, '#cm-withdraw:visible');
  if (await page.locator('#orbs-sacar.travado:visible').isVisible()) return false;
  await page.locator('#sw-orbs:visible').fill(String(amount), { timeout: BUTTON_WAIT });
  await page.locator('#orbs-endereco:visible').fill(wallet, { timeout: BUTTON_WAIT });
  if (Number(await page.locator('#sw-orbs:visible').inputValue()) !== amount) return false;
  await click(page, '#orbs-sacar:visible');
  const address = page.locator('#confirmar:visible .dlg-carteira code');
  return await address.isVisible() && (await address.textContent()).trim() === wallet;
}

function hookSocket({ key, origin, socketUrl }) {
  if (location.origin !== origin) return;
  const original = WebSocket.prototype.send;
  let connection;
  WebSocket.prototype.send = function (payload) {
    if (this.url === socketUrl && this.readyState === WebSocket.OPEN) connection = this;
    return original.call(this, payload);
  };
  const allowed = new Set(['hunt.select', 'centro.curar', 'auto.set', 'shop.buy', 'market.historico',
    'market.historicoGlobal', 'market.meus', 'market.listar', 'market.itens', 'market.item',
    'market.criar', 'market.cancelar', 'pokemon.evoluir', 'team.active', 'orbs.painel',
    'ginasio.info', 'ginasio.painel', 'ginasio.salvar', 'ginasio.desafiar', 'boss.auto', 'boss.entrar', 'boss.sair',
    'passe.resgatar', 'bicicleta.equipar', 'casa.usar', 'xpshare.escolher', 'xpshareheld.equipar', 'team.move',
    'chocadeira.colocar', 'casa.fabricar', 'bicicleta.fabricar', 'pvp.info', 'pvp.time.salvar',
    'pvp.fila.entrar', 'pvp.fila.sair', 'raid.info', 'raid.inscrever', 'raid.equipe', 'safari.entrar', 'centro.ir']);
  Object.defineProperty(window, key, {
    value: (message) => {
      if (!allowed.has(message.t) || connection?.readyState !== WebSocket.OPEN) return false;
      const id = (n) => Number.isSafeInteger(n) && n > 0;
      if (['pvp.time.salvar', 'raid.equipe'].includes(message.t)) {
        const ids = message.pokemonIds;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || !ids.every(id) || new Set(ids).size !== ids.length) return false;
        if (message.t === 'pvp.time.salvar') {
          const houses = ids.map((id) => message.casas?.[id]);
          if (houses.some((house) => !Number.isInteger(house) || house < 0 || house >= 30)
            || new Set(houses).size !== houses.length || Object.keys(message.casas).length !== ids.length) return false;
        }
      }
      if (message.t === 'safari.entrar' && message.tickets !== 1) return false;
      if (message.t === 'bicicleta.equipar' && !id(message.bicicletaId)) return false;
      if (message.t === 'casa.usar' && (!id(message.casaId) || message.usar !== true)) return false;
      if (message.t === 'xpshare.escolher' && (!id(message.casaId) || !id(message.pokemonId)
        || !Number.isInteger(message.slot) || message.slot < 0 || message.slot > 1)) return false;
      if (message.t === 'xpshareheld.equipar' && !id(message.pokemonId)) return false;
      if (message.t === 'team.move' && (!id(message.pokemonId) || !Number.isInteger(message.slot)
        || message.slot < 0 || message.slot > 4)) return false;
      if (message.t === 'chocadeira.colocar' && (!['p2', 'p3', 'p4'].includes(message.ovo)
        || !Number.isInteger(message.slot) || message.slot < 0 || message.slot > 5)) return false;
      original.call(connection, JSON.stringify(message));
      return true;
    },
  });
}

export class GameBrowser {
  key = `idlebot_${randomUUID().replaceAll('-', '')}`;
  waiters = new Set();
  socket = null;

  async open(profileDir, channel, onFrame, onDisconnect, onClose, display) {
    this.context = await chromium.launchPersistentContext(profileDir, {
      channel: channel === 'chromium' ? undefined : channel,
      headless: false, viewport: display ? null : { width: 1320, height: 850 },
      env: display ? { ...process.env, DISPLAY: display } : undefined,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        ...(display ? ['--start-maximized', '--disable-background-mode'] : [])],
    });
    this.context.on('close', onClose);
    await this.context.addInitScript(hookSocket, { key: this.key, origin: GAME_ORIGIN, socketUrl: GAME_SOCKET });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
    this.page.on('websocket', (socket) => {
      if (socket.url() !== GAME_SOCKET) return;
      this.socket = socket;
      socket.on('framereceived', ({ payload }) => {
        if (socket !== this.socket || typeof payload !== 'string') return;
        let message;
        try { message = JSON.parse(payload); } catch { return; }
        if (!message || typeof message.t !== 'string') return;
        onFrame(message);
        for (const waiter of this.waiters) {
          if (waiter.matches(message)) waiter.resolve(message);
        }
      });
      socket.on('close', () => {
        if (socket !== this.socket) return;
        this.socket = null;
        for (const waiter of this.waiters) waiter.resolve(null);
        onDisconnect();
      });
    });
    await this.page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  async send(message) {
    if (!this.page || !this.socket || new URL(this.page.url()).origin !== GAME_ORIGIN) return false;
    return this.page.evaluate(({ key, message }) => window[key]?.(message) === true, { key: this.key, message });
  }

  async gymData(pokemon, species, pokemonIds = []) {
    let timer;
    try {
      if (!this.page || new URL(this.page.url()).origin !== GAME_ORIGIN
        || !Array.isArray(pokemon) || !Array.isArray(pokemonIds) || pokemonIds.length > 5) return null;
      const rows = pokemon.map((pk) => ({ pk, esp: species?.[pk?.speciesId]?.combat ?? null }));
      const result = this.page.evaluate(async ({ origin, rows, pokemonIds }) => {
        if (location.origin !== origin) return null;
        const [{ poderNoGinasio }, { alcanceDaEspecie, casasDaEquipe }] = await Promise.all([
          import('/shared/ginasios.mjs'), import('/shared/pvp-tabuleiro.mjs'),
        ]);
        if ([poderNoGinasio, alcanceDaEspecie, casasDaEquipe].some((helper) => typeof helper !== 'function')) return null;
        const stats = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
        const bases = ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'];
        const completeSpecies = (esp) => esp && bases.every((key) => Number.isFinite(esp[key]) && esp[key] > 0)
          && typeof esp.type1 === 'string' && esp.type1.length > 0
          && (esp.type2 == null || typeof esp.type2 === 'string')
          && Array.isArray(esp.attacks) && esp.attacks.length > 0
          && esp.attacks.every((attack) => attack && Number.isFinite(attack.power) && attack.power >= 0
            && Number.isFinite(attack.cooldownMs) && attack.cooldownMs > 0
            && Number.isFinite(attack.learnLevel) && attack.learnLevel >= 1
            && ['PHYSICAL', 'SPECIAL', 'STATUS'].includes(attack.category)
            && typeof attack.type === 'string' && attack.type.length > 0);
        const ratings = {};
        const entries = new Map();
        for (const { pk, esp } of rows) {
          const id = Number(pk?.id);
          if (!Number.isSafeInteger(id) || id <= 0 || Number(esp?.pokeId) !== Number(pk?.speciesId)
            || !completeSpecies(esp)) continue;
          entries.set(id, esp);
          if (!Number.isFinite(pk.level) || pk.level < 1
            || !stats.every((key) => Number.isFinite(pk.ivs?.[key]) && pk.ivs[key] >= 0)) continue;
          const power = poderNoGinasio(pk, esp);
          if (!Number.isFinite(power) || power < 1) return null;
          ratings[String(id)] = power;
        }
        const ids = pokemonIds.map(Number);
        if (new Set(ids).size !== ids.length || ids.some((id) => !entries.has(id))) return null;
        const casas = {};
        if (ids.length) {
          const ranges = ids.map((id) => alcanceDaEspecie(entries.get(id)));
          if (ranges.some((range) => !Number.isInteger(range) || range < 1 || range > 4)) return null;
          const houses = casasDaEquipe(Array(ids.length).fill(null), ranges);
          if (!Array.isArray(houses) || houses.length !== ids.length || new Set(houses).size !== ids.length
            || houses.some((house) => !Number.isInteger(house) || house < 0 || house >= 30)) return null;
          ids.forEach((id, index) => { casas[String(id)] = houses[index]; });
        }
        return { ratings, casas };
      }, { origin: GAME_ORIGIN, rows, pokemonIds });
      return await Promise.race([result, new Promise((resolve) => { timer = setTimeout(() => resolve(null), GYM_DATA_WAIT); })]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async strategyData(player, pokemon, species, now) {
    let timer;
    try {
      if (!this.page || new URL(this.page.url()).origin !== GAME_ORIGIN || !Array.isArray(pokemon)
        || !Number.isFinite(now)) return null;
      const rows = pokemon.map((pk) => ({ pk, esp: species?.[pk.speciesId]?.combat ?? null }));
      const calculation = this.page.evaluate(async ({ player, rows, now }) => {
        const [passModule, powerModule, useModule, eggsModule] = await Promise.allSettled([
          import('/shared/passe-batalha.mjs'), import('/shared/nota-pokemon.mjs'), import('/shared/pokemon-nivel-treinador.mjs'),
          import('/shared/chocadeira.mjs'),
        ]);
        let pass = null;
        if (passModule.value?.estadoDoPasse && passModule.value?.diaDoPasse) {
          pass = { ...passModule.value.estadoDoPasse(player, now), day: passModule.value.diaDoPasse(now) };
        }
        const ratings = {};
        if (powerModule.value?.poderDePokemon && useModule.value?.podeUsarPokemon) {
          const stats = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
          const bases = ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'];
          for (const { pk, esp } of rows) {
            if (!Number.isSafeInteger(pk.id) || pk.id <= 0 || !Number.isFinite(pk.level) || pk.level < 1
              || !Number.isFinite(pk.quality) || pk.quality <= 0 || !Number.isInteger(pk.potencia) || pk.potencia < 1 || pk.potencia > 5
              || !stats.every((stat) => Number.isFinite(pk.ivs?.[stat]) && pk.ivs[stat] >= 1 && pk.ivs[stat] <= 32)
              || !esp || esp.pokeId !== pk.speciesId || !bases.every((stat) => Number.isFinite(esp[stat]) && esp[stat] > 0)) continue;
            const power = powerModule.value.poderDePokemon(pk, esp);
            const usable = useModule.value.podeUsarPokemon(player.level, pk);
            if (Number.isFinite(power) && power > 0 && typeof usable === 'boolean') ratings[pk.id] = { power, usable };
          }
        }
        const incubation = eggsModule.value?.normalizarChocadeira && Array.isArray(eggsModule.value.OVOS)
          && player.chocadeira && typeof player.chocadeira === 'object'
          ? { ...eggsModule.value.normalizarChocadeira(player.chocadeira), catalog: eggsModule.value.OVOS } : null;
        return { pass, ratings, incubation };
      }, { player: { level: player?.level, passe: player?.passe, chocadeira: player?.chocadeira }, rows, now });
      return await Promise.race([calculation, new Promise((resolve) => { timer = setTimeout(() => resolve(null), GYM_DATA_WAIT); })]);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  async activityData({ player, pokemon, species, hunts, safariPool, now }) {
    let timer;
    try {
      if (!this.page || new URL(this.page.url()).origin !== GAME_ORIGIN || !Array.isArray(pokemon)
        || !Array.isArray(hunts) || !Number.isFinite(now)) return null;
      const ownedSpecies = new Set(pokemon.map((pk) => pk.speciesId));
      const compactSpecies = Object.fromEntries(Object.entries(species ?? {}).map(([id, esp]) => [id, {
        name: esp.name, evolvesTo: esp.evolvesTo, evolveLevel: esp.evolveLevel, tetoCaptura: esp.tetoCaptura,
        combat: ownedSpecies.has(Number(id)) ? esp.combat : undefined,
      }]));
      const calculation = this.page.evaluate(async ({ pokemon, species, hunts, safariPool, now, origin }) => {
        if (location.origin !== origin) return null;
        const loaded = await Promise.allSettled([
          import('/shared/ginasios.mjs'), import('/shared/pvp-rank.mjs'), import('/shared/raid.mjs'),
          import('/shared/safari.mjs'), import('/shared/chocadeira.mjs'), import('/shared/reduzir-nivel.mjs'),
          import('/shared/pokemon-nivel-treinador.mjs'), import('/shared/teto-captura.mjs'),
          import('/shared/evolucoes-cruzadas.mjs'), import('/shared/outland.mjs'),
        ]);
        const [power, pvp, raid, safari, eggs, reduction, trainer, capture, cross, outland] = loaded.map((entry) => entry.value);
        const stats = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
        const bases = ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'];
        const ratings = {}; const raidRatings = {};
        for (const pk of pokemon) {
          const esp = species?.[pk.speciesId]?.combat;
          if (!Number.isSafeInteger(pk.id) || pk.id <= 0 || !Number.isFinite(pk.level) || pk.level < 1
            || !Number.isFinite(pk.quality) || pk.quality <= 0 || !Number.isInteger(pk.potencia) || pk.potencia < 1 || pk.potencia > 5
            || !stats.every((key) => Number.isFinite(pk.ivs?.[key]) && pk.ivs[key] >= 1 && pk.ivs[key] <= 32)
            || !esp || esp.pokeId !== pk.speciesId || !bases.every((key) => Number.isFinite(esp[key]) && esp[key] > 0)
            || !esp.type1 || !Array.isArray(esp.attacks) || !esp.attacks.length
            || !esp.attacks.every((attack) => Number.isFinite(attack.power) && attack.power >= 0
              && Number.isFinite(attack.cooldownMs) && attack.cooldownMs > 0 && Number.isFinite(attack.learnLevel) && attack.learnLevel >= 1
              && ['PHYSICAL', 'SPECIAL', 'STATUS'].includes(attack.category) && typeof attack.type === 'string')) continue;
          const arena = power?.poderNoGinasio?.(pk, esp);
          const actual = power?.poderNoNivel?.(pk, esp, pk.level);
          if (Number.isFinite(arena) && arena > 0) ratings[pk.id] = arena;
          if (Number.isFinite(actual) && actual > 0) raidRatings[pk.id] = actual;
        }
        let safariData = null;
        if (safari && eggs?.especiesDoOvo && reduction?.pisoReducaoNivel && trainer?.nivelMinimoTreinador
          && capture?.montarEstagiosEvolutivos && capture?.tetoDeCaptura && cross && outland) {
          const evolutions = Object.entries(species).map(([id, esp]) => ({
            pokeId: Number(id), evolvesToId: esp.evolvesTo, evolveLevel: esp.evolveLevel,
          }));
          outland.aplicarRemapOutlandLista(evolutions);
          cross.aplicarCadeiasTruncadas(evolutions);
          for (const esp of evolutions) if (outland.isOutlandPokeId(esp.pokeId)) { esp.evolvesToId = 0; esp.evolveLevel = 0; }
          const lookup = new Map(evolutions.filter((esp) => !outland.isEspelhoFantasmaPokeId(esp.pokeId)).map((esp) => [esp.pokeId, esp]));
          cross.aplicarEvolucoesEntreGeracoes(evolutions);
          const stages = capture.montarEstagiosEvolutivos(evolutions, (id) => lookup.get(Number(id)));
          const poolIds = eggs.especiesDoOvo(hunts).filter((id) => Number.isSafeInteger(id) && id > 0 && species?.[id]?.name);
          const captureLevels = {}; const eligibleLevels = {};
          for (const id of poolIds) {
            const levels = hunts.filter((hunt) => hunt.especies?.some((spawn) => spawn.pokeId === id))
              .map((hunt) => hunt.nivel).filter((level) => Number.isFinite(level) && level > 0);
            const cap = Number.isFinite(species[id].tetoCaptura) ? species[id].tetoCaptura : capture.tetoDeCaptura(id, stages);
            if (!levels.length || !Number.isSafeInteger(cap) || cap < 1) continue;
            const level = safari.nivelDeCapturaNoSafari(reduction.pisoReducaoNivel({ ...species[id].combat,
              tetoCaptura: cap }, Math.min(...levels)));
            if (!Number.isSafeInteger(level) || level < 1) continue;
            captureLevels[id] = level; eligibleLevels[id] = trainer.nivelMinimoTreinador(level);
          }
          safariData = { ticketId: safari.SAFARI_TICKET_ID, durationMs: safari.SAFARI_DURACAO_MS,
            slug: safari.SAFARI_SLUG, bonusPercent: safari.BONUS_SAFARI_PCT, poolIds,
            poolComplete: poolIds.length === safariPool && poolIds.every((id) => Number.isFinite(captureLevels[id])),
            captureLevels, eligibleLevels };
        }
        return {
          pvp: pvp && { minimumLevel: pvp.PVP_NIVEL_MIN, minTeam: pvp.PVP_TIME_MIN, maxTeam: pvp.PVP_TIME_MAX, ratings },
          raid: raid?.raidDaVez && { at: now, edition: raid.raidDaVez(now), itemId: raid.RAID_TOKEN_ID,
            cost: raid.RAID_TOKEN_QTD, maxTeam: raid.RAID_MAX_EQUIPE, ratings: raidRatings,
            bonusHours: raid.RAID_BONUS_HORAS, bonusXpMax: raid.RAID_BONUS_XP_MAX, bonusFarmMax: raid.RAID_BONUS_FARM_MAX },
          safari: safariData,
        };
      }, { pokemon, species: compactSpecies, hunts, safariPool, now, origin: GAME_ORIGIN });
      return await Promise.race([calculation, new Promise((resolve) => { timer = setTimeout(() => resolve(null), GYM_DATA_WAIT); })]);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  async suppressPvpReplay(canAct = () => false) {
    if (!canAct() || !this.page || new URL(this.page.url()).origin !== GAME_ORIGIN) return false;
    const updated = await this.page.evaluate(() => { localStorage.setItem('pvpTelaBatalha', 'off'); return true; });
    return updated && canAct();
  }

  async dismissStrategyReward(reward, canAct = () => false) {
    if (!canAct() || !this.page || new URL(this.page.url()).origin !== GAME_ORIGIN) return false;
    let selector;
    if (reward.kind === 'pass') selector = '#modal:visible:has(#ps-corpo) #modal-fechar:visible';
    if (reward.kind === 'house') selector = '#recompensa:visible:has(#rc-arte img.rc-img-casa[src^="/img/itens/casa-"]) #rc-ok:visible';
    if (reward.kind === 'bike') selector = '#recompensa:visible:has(#rc-arte img.rc-img-pixel[src^="/img/itens/bicicleta-"]) #rc-ok:visible';
    if (reward.kind === 'safari') selector = '#recompensa.rc-safari:visible #rc-ok:visible';
    if (reward.kind === 'egg' && typeof reward.name === 'string' && reward.name.length) {
      const name = this.page.locator('#recompensa:visible #rc-nome');
      if (!await name.isVisible() || ![reward.name, `Shiny ${reward.name}`, `✨ Shiny ${reward.name}`].includes((await name.innerText()).trim())) return false;
      selector = '#recompensa:visible #rc-ok:visible';
    }
    if (!selector || await this.page.locator('#confirmar:visible, #termos-aceite:visible').first().isVisible()) return false;
    const button = this.page.locator(selector);
    if (!await button.isVisible()) return false;
    try {
      await button.click({ trial: true, timeout: BUTTON_WAIT });
      if (!await button.isVisible() || !canAct()) return false;
      await button.click({ timeout: 500 });
      return true;
    } catch (error) {
      if (error.name === 'TimeoutError') return false;
      throw error;
    }
  }

  async captureTargets() {
    return this.page.locator('#caidos-lista .caido:not(.acabando):visible').evaluateAll((elements) => elements.flatMap((el) => {
      const slot = el.getAttribute('data-slot');
      const match = el.querySelector('.caido-quem')?.textContent.trim().match(/^(.+?)\s+Nv\s*\d+/u);
      return slot != null && /^\d+$/.test(slot) && match ? [{ slot, name: match[1] }] : [];
    }));
  }

  async capture(target, ball, canAct) {
    return clickCapture(this.page, [target.name], { ball, slot: target.slot, canAct });
  }

  async captureChances({ species, targets, hunts = [], balls = [], rules }) {
    let timer;
    try {
      if (!this.page || new URL(this.page.url()).origin !== GAME_ORIGIN || !Array.isArray(targets)
        || !rules || !Number.isFinite(rules.base) || rules.base <= 0
        || !Number.isFinite(rules.piso) || rules.piso < 0 || !Number.isFinite(rules.teto)
        || rules.teto <= 0 || rules.teto > 1 || rules.piso > rules.teto) return null;
      const rows = targets.map(({ id }) => ({ id, species: species?.[id] && {
        priceNpc: species[id].priceNpc, tetoCaptura: species[id].tetoCaptura,
      } }));
      const evolutions = Object.entries(species ?? {}).map(([id, esp]) => ({
        pokeId: Number(id), evolvesToId: esp.evolvesTo, evolveLevel: esp.evolveLevel,
      }));
      const calculation = this.page.evaluate(async ({ rows, hunts, balls, rules, evolutions }) => {
        const { capturaPeloDegrau, chavesEmHunt, fatorDeCaptura, FATOR_CAPTURA_DO_DEGRAU } = await import('/shared/captura-degrau.mjs');
        let capture, stages;
        if (rows.some((row) => row.species && !Number.isFinite(row.species.tetoCaptura))) {
          const [caps, cross, outland] = await Promise.all([import('/shared/teto-captura.mjs'),
            import('/shared/evolucoes-cruzadas.mjs'), import('/shared/outland.mjs')]);
          capture = caps;
          outland.aplicarRemapOutlandLista(evolutions);
          cross.aplicarCadeiasTruncadas(evolutions);
          for (const esp of evolutions) if (outland.isOutlandPokeId(esp.pokeId)) { esp.evolvesToId = 0; esp.evolveLevel = 0; }
          const lookup = new Map(evolutions.filter((esp) => !outland.isEspelhoFantasmaPokeId(esp.pokeId)).map((esp) => [esp.pokeId, esp]));
          cross.aplicarEvolucoesEntreGeracoes(evolutions);
          stages = capture.montarEstagiosEvolutivos(evolutions, (id) => lookup.get(Number(id)));
        }
        const keys = chavesEmHunt(hunts);
        const output = {};
        for (const { id, species } of rows) {
          if (!species || !Number.isFinite(species.priceNpc) || species.priceNpc < 0) continue;
          const cap = Number.isFinite(species.tetoCaptura) ? species.tetoCaptura : capture?.tetoDeCaptura(id, stages);
          if (!Number.isSafeInteger(cap) || cap < 1) continue;
          const factor = fatorDeCaptura({ tetoCaptura: cap,
            peloDegrau: capturaPeloDegrau(id, keys),
            preco: species.priceNpc > 0 ? species.priceNpc : rules.precoSemPreco ?? 6.5e9,
            raridadeDiv: rules.raridadeDiv ?? 17, porDegrau: rules.porDegrau ?? FATOR_CAPTURA_DO_DEGRAU });
          if (!Number.isFinite(factor) || factor <= 0) continue;
          const chances = {};
          for (const ball of balls) {
            if (!Number.isSafeInteger(ball.id) || ball.id <= 0 || !Number.isFinite(ball.catchRate) || ball.catchRate <= 0) continue;
            chances[ball.id] = ball.catchRate >= 255 ? 1
              : Math.max(rules.piso, Math.min(rules.teto, rules.base * ball.catchRate / factor * 1.4));
          }
          output[id] = chances;
        }
        return output;
      }, { rows, hunts, balls, rules, evolutions });
      return await Promise.race([calculation, new Promise((resolve) => { timer = setTimeout(() => resolve(null), GYM_DATA_WAIT); })]);
    } catch {
      return null;
    } finally { clearTimeout(timer); }
  }

  async response(matches, action, timeout = 7000) {
    let waiter;
    let timer;
    const result = new Promise((resolve) => {
      waiter = { matches, resolve };
      this.waiters.add(waiter);
      timer = setTimeout(() => resolve(null), timeout);
    });
    try {
      return await action() === false ? null : await result;
    } finally {
      clearTimeout(timer);
      this.waiters.delete(waiter);
    }
  }

  async confirm() {
    await click(this.page, '#confirmar:visible #confirmar-sim');
  }

  async dismiss() {
    await this.page.keyboard.press('Escape');
    await this.page.keyboard.press('Escape');
  }

  async close() {
    await this.context?.close();
  }
}
