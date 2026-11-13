export function pokemonFrom(raw) {
  const id = Number(raw?.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !raw?.nome) return null;
  const pokemon = {
    id, speciesId: Number(raw.speciesId) || 0, name: raw.nome,
    level: Number(raw.level) || 0, power: Number(raw.potencia) || 0, shiny: Boolean(raw.shiny),
  };
  if (Number.isFinite(raw.quality)) pokemon.quality = raw.quality;
  if (raw.ivs && Object.values(raw.ivs).every(Number.isFinite)) {
    pokemon.iv = Object.values(raw.ivs).reduce((sum, value) => sum + value, 0);
  }
  return pokemon;
}

export class GameState {
  player = null;
  market = null;
  hunts = [];
  bosses = [];
  houses = null;
  bicycles = null;
  xpShareHeld = null;
  generation = 0;
  gymInfo = null;
  gymInfoAt = 0;
  gymPanel = null;
  gymPanelAt = 0;
  pvpInfo = null;
  pvpInfoAt = 0;
  pvpCooldownUntil = 0;
  raidInfo = null;
  raidInfoAt = 0;
  safariPool = null;
  balls = [];
  captureRules = null;
  items = [];
  pokemon = new Map();
  inventoryAt = null;
  shinyLooks = {};
  shinyLooksOutland = {};
  evolutionStones = {};
  typeChart = {};
  outlandItems = [];
  panel = null;
  hunt = null;
  huntLocks = new Map();
  switchAfter = 0;
  lastFrameAt = null;
  lastProgressAt = null;
  serverOffset = 0;

  consume(message, now = Date.now()) {
    this.lastFrameAt = now;
    if (message.t === 'welcome') {
      this.generation++;
      this.lastProgressAt = null;
      this.market = message.mercado ?? null;
      this.hunts = message.hunts ?? [];
      this.bosses = Array.isArray(message.bossesJogaveis) ? message.bossesJogaveis : [];
      this.houses = message.casas ?? null;
      this.bicycles = message.bicicletas ?? null;
      this.xpShareHeld = message.xpShareHeld ?? null;
      this.gymInfo = null;
      this.gymInfoAt = 0;
      this.gymPanel = null;
      this.gymPanelAt = 0;
      this.pvpInfo = null;
      this.pvpInfoAt = 0;
      this.pvpCooldownUntil = 0;
      this.raidInfo = null;
      this.raidInfoAt = 0;
      this.safariPool = Number.isSafeInteger(message.safariPool) && message.safariPool > 0 ? message.safariPool : null;
      this.balls = message.catalogoBolas ?? [];
      this.captureRules = message.captura ?? null;
      this.items = message.itensNossos ?? [];
      this.shinyLooks = message.shinyLooks ?? {};
      this.shinyLooksOutland = message.shinyLooksOutland ?? {};
      this.evolutionStones = message.pedrasEvolucao ?? {};
      this.typeChart = message.tabelaTipos ?? {};
      this.outlandItems = [
        this.items.find(({ name }) => name === 'Bronze Boss Token')?.id ?? 70000,
        message.casas?.fragmento?.itemId ?? 70011,
        message.shinyStone?.fragmentoId ?? 70012,
        message.bicicletas?.fragmento?.itemId ?? 70013,
      ].filter((id) => Number.isSafeInteger(id) && id > 0);
      this.panel = null;
      this.updatePlayer(message.estado, true, now);
    }
    if (message.t === 'estado') this.updatePlayer(message.estado, false, now);
    if (message.t === 'orbs') this.panel = message;
    if (message.t === 'pvp') {
      const fields = ['rank', 'posicao', 'posicaoFinal', 'corteFinal', 'totalClassificados', 'time', 'casas',
        'formacoes', 'historico', 'regras', 'fila', 'naoVistas'];
      for (const key of fields) if (Object.hasOwn(message, key)) {
        (this.pvpInfo ??= {})[key] = key === 'fila' ? { ...this.pvpInfo?.fila, ...message[key] } : message[key];
      }
      if (message.regras && Object.hasOwn(message, 'rank')) this.pvpInfoAt = now;
      if (Array.isArray(message.timeSalvo)) (this.pvpInfo ??= {}).time = message.timeSalvo;
      if (message.casasSalvas) (this.pvpInfo ??= {}).casas = message.casasSalvas;
      if (Number.isFinite(message.fila?.cooldownMs)) this.pvpCooldownUntil = now + Math.max(0, message.fila.cooldownMs);
      if (message.filaRecusa) {
        (this.pvpInfo ??= {}).fila = { ...this.pvpInfo?.fila, na: false };
        if (Number.isFinite(message.filaRecusa.restaMs)) this.pvpCooldownUntil = now + Math.max(0, message.filaRecusa.restaMs);
      }
      if (message.partida?.id) {
        (this.pvpInfo ??= {}).lastMatch = { ...message.partida, receivedAt: now };
        this.pvpInfo.fila = { ...this.pvpInfo.fila, na: false };
        this.pvpCooldownUntil = Math.max(this.pvpCooldownUntil, now + 20_000);
      }
    }
    if (message.t === 'raid' && message.edicao && message.eu) {
      this.raidInfo = this.raidInfo?.edicao?.id === message.edicao.id
        ? { ...this.raidInfo, ...message } : { ...message };
      this.raidInfoAt = now;
    }
    if (message.t === 'ginasio') {
      if (message.info) {
        this.gymInfo = message.info;
        this.gymInfoAt = now;
      }
      if (message.painel) {
        this.gymPanel = message.painel;
        this.gymPanelAt = now;
      }
    }
    if (message.t !== 'batalha' || !Array.isArray(message.ev)) return [];
    for (const event of message.ev) this.trackHunt(event, now);
    return message.ev.filter((event) => event.k === 'capturado').map((event) => pokemonFrom(event.pokemon)).filter(Boolean);
  }

  updatePlayer(delta, reset, now) {
    if (!delta) return;
    if (Number.isFinite(delta.servidorAgora)) this.serverOffset = delta.servidorAgora - now;
    const previousXp = this.player?.xp;
    const previousLevel = this.player?.level;
    const { cheio, pokemons, pkMud, pkFora, dexMud, dexFora, pokedex, ...fields } = delta;
    if (reset || cheio || !this.player) {
      this.player = fields;
      this.pokemon.clear();
      this.inventoryAt = null;
    } else {
      Object.assign(this.player, fields);
    }
    if (Array.isArray(pokemons)) this.pokemon = new Map(pokemons.map((pokemon) => [Number(pokemon.id), pokemon]));
    for (const pokemon of pkMud ?? []) this.pokemon.set(Number(pokemon.id), pokemon);
    for (const id of pkFora ?? []) this.pokemon.delete(Number(id));
    if (Array.isArray(pokemons) || cheio) this.inventoryAt = now;
    if (!reset && (this.player.xp > previousXp || this.player.level > previousLevel)) this.lastProgressAt = now;
    if (this.inventoryAt !== null && (pkMud?.length || pkFora?.length || fields.automation)) this.inventoryAt = now;
    const slug = this.player.huntSlug;
    if (slug && this.hunt?.slug !== slug) {
      this.hunt = { slug, startedAt: now, kills: 0, lastKillAt: now, faints: [], fightUntil: 0 };
    }
    if (this.hunt && Number.isFinite(fields.centroLivreEm) && Number.isFinite(fields.servidorAgora)) {
      this.hunt.fightUntil = now + Math.max(0, fields.centroLivreEm - fields.servidorAgora);
    }
  }

  trackHunt(event, now) {
    if (event.k === 'hunt' && Number.isFinite(event.trocaLivreEm)) {
      this.switchAfter = event.trocaLivreEm;
    }
    const { player, hunt } = this;
    if (!hunt || player?.huntSlug !== hunt.slug || player.noCentro
      || player.boss?.arena || player.mistico || player.safari?.dentro || player.casa?.dentro) return;
    if (event.k === 'ataque') hunt.fightUntil = now + 3000;
    if (event.k !== 'morte') return;
    if (event.quem === 'selvagem') {
      hunt.kills++;
      hunt.lastKillAt = now;
      this.lastProgressAt = now;
      return;
    }
    if (event.quem) {
      hunt.faints = [...hunt.faints.filter((at) => now - at < 90_000), now];
      if (hunt.faints.length >= 2) this.huntLocks.set(hunt.slug, now + 600_000);
    }
  }

  farmEvents(events) {
    const species = this.hunts.find(({ slug }) => slug === this.player?.huntSlug)?.especies ?? [];
    const outlandItems = new Set(this.outlandItems);
    const stats = { kills: 0, drops: 0, encounters: 0, balls: 0, supplyGold: 0, faints: 0 };
    for (const event of events) {
      if (event.k === 'morte' && event.quem === 'selvagem') {
        stats.kills++;
        const id = Number(event.pokeId ?? event.speciesId)
          || species.find(({ nome }) => nome && nome === event.nome)?.pokeId;
        if (this.shinyLooks[id] != null) stats.encounters++;
        for (const drop of event.drops ?? []) {
          if (outlandItems.has(Number(drop.itemId))) stats.drops += Math.max(0, Math.floor(Number(drop.qtd ?? 1) || 0));
        }
      } else if (event.k === 'morte' && event.quem) {
        stats.faints++;
      }
      if (event.k === 'bola') {
        stats.balls++;
        stats.supplyGold += this.balls.find(({ id }) => id === Number(event.ballId))?.priceGold ?? 0;
      }
      if (event.k === 'cura' || event.k === 'revive') {
        stats.supplyGold += this.items.find(({ id }) => id === Number(event.itemId))?.npcPrice ?? 0;
      }
    }
    return stats;
  }

  canSwitchHunt(now) {
    return now >= this.switchAfter && (this.player?.noCentro || now >= (this.hunt?.fightUntil ?? 0));
  }

  serverNow(now = Date.now()) {
    return now + this.serverOffset;
  }

  huntOptions(now) {
    for (const [slug, until] of this.huntLocks) {
      if (now >= until) this.huntLocks.delete(slug);
    }
    const hunt = this.hunt;
    return {
      lastHunt: hunt?.slug,
      ready: Boolean(hunt && hunt.kills >= 12 && now - hunt.startedAt >= 60_000
        && now - hunt.lastKillAt <= 45_000 && now - (hunt.faints.at(-1) ?? -Infinity) >= 90_000),
      blocked: new Set(this.huntLocks.keys()),
    };
  }
}
