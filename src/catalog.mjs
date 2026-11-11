import { pokemonFrom } from './game-state.mjs';

export const SPRITE_SOURCES = 'https://pokeidle.io https://raw.githubusercontent.com';
const ATLAS = 'https://pokeidle.io/assets/site/assets/maps/marker-atlas';
const OUTFITS = 'https://pokeidle.io/assets/asset-packs';
const asset = (name) => `https://pokeidle.io/assets/${name}.json`;
const assetJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error('Recurso do PokeIdle indisponível.');
  return response.json();
};
let atlasCache;
let outfitIndex;
const portraits = new Map();

export function pokemonAtlas() {
  if (atlasCache) return atlasCache;
  atlasCache = Promise.allSettled([
    assetJson(`${ATLAS}.json`),
    ...['creatures', 'creatures-novos', 'creatures-formas', 'creatures-outland-novos'].map((name) => assetJson(asset(name))),
  ]).then(([atlas, ...catalogs]) => {
    if (!atlas.value?.slots || !catalogs[0].value?.creatures) atlasCache = null;
    const { cols, rows, slots, version } = atlas.value ?? {};
    const species = {};
    for (const catalog of catalogs) {
      for (const row of catalog.value?.creatures ?? []) {
        if (Number.isSafeInteger(row.pokeId)) {
          species[row.pokeId] = {
            name: row.name, looktype: row.looktype, types: [row.type1, row.type2].filter(Boolean), rarity: row.rarity,
            evolvesTo: row.evolvesToId, evolveLevel: row.evolveLevel,
          };
        }
      }
    }
    return { cols, rows, slots, version, species };
  });
  return atlasCache;
}

export function pokemonPortrait(looktype) {
  if (portraits.has(looktype)) return portraits.get(looktype);
  outfitIndex ??= assetJson(`${OUTFITS}/outfits-index.json`).catch((error) => {
    outfitIndex = null;
    throw error;
  });
  const request = outfitIndex.then(async ({ outfits }) => {
    const entry = outfits?.[looktype];
    const path = entry?.manifest?.match(/^\/assets-packs\/(categories\/[\w-]+\.json)$/)?.[1];
    if (!path || !['pokemon', 'outfit'].includes(entry.kind)) return null;
    const manifest = await assetJson(`${OUTFITS}/${path}`);
    const category = Object.values(manifest.categories ?? {})[0];
    const frame = Object.entries(manifest.assets ?? {}).find(([name]) => name.endsWith('/1_1_1_3.png'))?.[1].frames?.[0];
    const page = frame && category?.pages?.[frame.page ?? 0];
    const image = page?.image?.match(/^\/assets-packs\/(outfits\/[\w/-]+\.webp)$/)?.[1];
    if (!image) return null;
    return {
      path: `/assets/asset-packs/${image}`,
      x: frame.x, y: frame.y, w: frame.w, h: frame.h, width: page.width, height: page.height,
    };
  }).catch(() => {
    portraits.delete(looktype);
    return null;
  });
  if (portraits.size >= 256) portraits.delete(portraits.keys().next().value);
  portraits.set(looktype, request);
  return request;
}

const itemName = (item) => item?.nome ?? item?.name;
const marketItems = (state) => new Map(
  [...state.items, ...(state.market?.catalogo ?? [])].map((item) => [Number(item.id), itemName(item)]),
);
const hasInventory = ({ state, account }) => state.inventoryAt !== null && account === state.player?.nick;
const lockedIds = (session) => new Set((session.state.player?.automation?.pokemonTravado ?? []).map(Number));

function pokemonCard(raw, state) {
  const card = pokemonFrom(raw);
  if (!card) return null;
  return {
    ...card,
    nickname: raw.apelido,
    types: raw.tipos,
    looktype: raw.looktype,
    shinyLook: card.shiny
      ? state.shinyLooksOutland[card.speciesId] ?? state.shinyLooks[card.speciesId] ?? raw.lookShiny
      : null,
  };
}

function ownedCard(raw, session, locked) {
  const card = pokemonCard(raw, session.state);
  return card && {
    ...card,
    rating: raw.nota,
    location: raw.slot != null ? 'team' : locked.has(card.id) ? 'collection' : 'depot',
  };
}

export function collectionProfile(session) {
  const { state, online, account, config } = session;
  const locked = lockedIds(session);
  const available = hasInventory(session);
  return {
    id: config.id, account, online, updatedAt: available ? state.inventoryAt : null,
    pokemon: available ? [...state.pokemon.values()].map((raw) => ownedCard(raw, session, locked)).filter(Boolean) : [],
  };
}

export function ownedPokemon(session, id) {
  if (!session || !hasInventory(session)) return null;
  const raw = session.state.pokemon.get(id);
  const card = raw && ownedCard(raw, session, lockedIds(session));
  if (!card) return null;
  const items = marketItems(session.state);
  return {
    account: session.account, online: session.online, updatedAt: session.state.inventoryAt,
    pokemon: {
      ...card, hp: raw.hp, maxHp: raw.maxHp, stats: raw.stats, ivs: raw.ivs, xp: raw.xp,
      xpLevel: raw.xpNivel, xpNext: raw.xpProximo, combatPower: raw.poder,
      refinement: raw.refino, capturedAt: raw.caughtAt ?? raw.capturadoEm,
      capturedBy: raw.caughtBy === true ? session.account : raw.caughtBy,
      heldItem: items.get(Number(raw.heldItemId)) ?? raw.heldItemId,
      details: raw,
    },
  };
}

const fail = (status, message) => Object.assign(new Error(message), { status });
const searchable = (text) => String(text ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export async function marketPage(sessions, query) {
  const type = query.get('type') ?? 'item';
  const currency = query.get('currency') ?? '';
  const search = query.get('search')?.trim().slice(0, 80) ?? '';
  const order = query.get('order') ?? 'recentes';
  const page = Number(query.get('page') ?? 0);
  const item = Number(query.get('item') ?? 0);
  if (!['item', 'pokemon'].includes(type) || !['', 'gold', 'orb'].includes(currency)
    || !['recentes', 'baratos', 'caros'].includes(order) || !Number.isSafeInteger(page) || page < 0 || page > 100_000
    || !Number.isSafeInteger(item) || item < 0 || (item && (type !== 'item' || !currency))) {
    throw fail(400, 'Filtros de mercado inválidos.');
  }
  const session = sessions.find((session) => session.active() && !['blocked', 'setup'].includes(session.status));
  if (!session) throw fail(503, 'Conecte um perfil ao PokeIdle e deixe o robô com o controle para consultar o mercado.');
  const names = marketItems(session.state);
  if (type === 'item' && !item) {
    const { data: result, at } = await session.readMarket('itens', {}) ?? {};
    if (!result?.resumo || typeof result.resumo !== 'object') throw fail(503, 'O mercado do jogo não respondeu. Tente novamente.');
    const rows = Object.entries(result.resumo).map(([id, row]) => ({
      id: Number(id), name: names.get(Number(id)) ?? `Item #${id}`,
      quantity: row.unidades, offers: row.anuncios,
      gold: row.minGold != null ? { price: row.minGold } : null,
      orb: row.minOrb != null ? { price: row.minOrb } : null,
    })).filter((row) => row.offers > 0 && (!currency || row[currency]) && searchable(row.name).includes(searchable(search)));
    rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return { rows, mode: 'items', updatedAt: at };
  }
  const response = item
    ? await session.readMarket('item', { itemId: item, moeda: currency })
    : await session.readMarket('listar', { tipo: 'pokemon', busca: search, moeda: currency, ordem: order, pagina: page, especieId: 0 });
  const { data: result, at } = response ?? {};
  if (!Array.isArray(result?.linhas)) throw fail(503, 'O mercado do jogo não respondeu. Tente novamente.');
  return {
    mode: 'offers', page: result.pagina ?? 0,
    pages: result.porPagina > 0 ? Math.max(1, Math.ceil(result.total / result.porPagina)) : 1,
    itemName: item ? names.get(item) ?? `Item #${item}` : null,
    updatedAt: at,
    rows: result.linhas.filter((row) => row && (row.tipo === type || (item && row.tipo == null))).map((row) => ({
      id: row.id, pokemon: type === 'pokemon' ? pokemonCard({ ...row.ficha, id: row.pokemonId ?? row.ficha?.id ?? row.id }, session.state) : null,
      name: type === 'pokemon' ? row.ficha?.nome : names.get(item) ?? row.ficha?.nome ?? `Item #${item}`,
      price: row.preco, currency: row.moeda, quantity: row.qtd ?? 1, seller: row.vendedor,
    })),
  };
}
