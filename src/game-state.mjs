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
  balls = [];
  items = [];
  pokemon = new Map();
  panel = null;
  hunt = null;
  huntLocks = new Map();
  switchAfter = 0;

  consume(message, now = Date.now()) {
    if (message.t === 'welcome') {
      this.market = message.mercado ?? null;
      this.hunts = message.hunts ?? [];
      this.balls = message.catalogoBolas ?? [];
      this.items = message.itensNossos ?? [];
      this.panel = null;
      this.updatePlayer(message.estado, true, now);
    }
    if (message.t === 'estado') this.updatePlayer(message.estado, false, now);
    if (message.t === 'orbs') this.panel = message;
    if (message.t !== 'batalha' || !Array.isArray(message.ev)) return [];
    for (const event of message.ev) this.trackHunt(event, now);
    return message.ev.filter((event) => event.k === 'capturado').map((event) => pokemonFrom(event.pokemon)).filter(Boolean);
  }

  updatePlayer(delta, reset, now) {
    if (!delta) return;
    const { cheio, pokemons, pkMud, pkFora, dexMud, dexFora, pokedex, ...fields } = delta;
    if (reset || cheio || !this.player) {
      this.player = fields;
      this.pokemon.clear();
    } else {
      Object.assign(this.player, fields);
    }
    if (Array.isArray(pokemons)) this.pokemon = new Map(pokemons.map((pokemon) => [Number(pokemon.id), pokemon]));
    for (const pokemon of pkMud ?? []) this.pokemon.set(Number(pokemon.id), pokemon);
    for (const id of pkFora ?? []) this.pokemon.delete(Number(id));
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
      return;
    }
    if (event.quem) {
      hunt.faints = [...hunt.faints.filter((at) => now - at < 90_000), now];
      if (hunt.faints.length >= 2) this.huntLocks.set(hunt.slug, now + 600_000);
    }
  }

  canSwitchHunt(now) {
    return now >= this.switchAfter && (this.player?.noCentro || now >= (this.hunt?.fightUntil ?? 0));
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
