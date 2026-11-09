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

  consume(message) {
    if (message.t === 'welcome') {
      this.market = message.mercado ?? null;
      this.hunts = message.hunts ?? [];
      this.balls = message.catalogoBolas ?? [];
      this.items = message.itensNossos ?? [];
      this.panel = null;
      this.updatePlayer(message.estado, true);
    }
    if (message.t === 'estado') this.updatePlayer(message.estado);
    if (message.t === 'orbs') this.panel = message;
    if (message.t !== 'batalha' || !Array.isArray(message.ev)) return [];
    return message.ev.filter((event) => event.k === 'capturado').map((event) => pokemonFrom(event.pokemon)).filter(Boolean);
  }

  updatePlayer(delta, reset = false) {
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
  }
}
