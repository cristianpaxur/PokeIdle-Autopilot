const byId = (id) => document.getElementById(id);
const element = (tag, label, className) => {
  const node = document.createElement(tag);
  if (label != null) node.textContent = label;
  if (className) node.className = className;
  return node;
};
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const number = (value) => Number.isFinite(value) ? format.format(value) : '—';
const date = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('pt-BR') : '—';
};
const searchKey = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const locations = { team: 'Equipe', depot: 'Depot', collection: 'Coleção' };
const currencies = { gold: 'Coins', orb: 'Gemas' };
const typesPt = {
  BUG: 'Inseto', DARK: 'Sombrio', DRAGON: 'Dragão', ELECTRIC: 'Elétrico', FAIRY: 'Fada', FIGHTING: 'Lutador',
  FIRE: 'Fogo', FLYING: 'Voador', GHOST: 'Fantasma', GRASS: 'Planta', GROUND: 'Terrestre', ICE: 'Gelo',
  NORMAL: 'Normal', POISON: 'Venenoso', PSYCHIC: 'Psíquico', ROCK: 'Pedra', STEEL: 'Aço', WATER: 'Água',
};
const rarityPt = {
  COMMON: 'Comum', UNCOMMON: 'Incomum', RARE: 'Raro', VERY_RARE: 'Muito raro',
  LEGENDARY: 'Lendário', MYTHICAL: 'Mítico',
};
const price = (value, currency) => Number.isFinite(value) ? `${number(value)} ${currencies[currency] ?? ''}`.trim() : '—';
const displayName = (pokemon) => pokemon.nickname || pokemon.name;
const profileName = ({ id, account }) => account || `Perfil ${String(id).padStart(2, '0')}`;
const profileStatus = ({ online, updatedAt }) => {
  if (updatedAt == null) return 'aguardando conexão';
  return `${online ? 'sincronizado em' : 'desconectado · última leitura em'} ${date(updatedAt)}`;
};
const detailPath = location.pathname.match(/^\/pokemon\/([1-4])\/(\d+)$/);
const marketView = location.pathname === '/mercado';
let atlas = {};
let profiles = [];
let pageIndex = 0;
let marketItem = null;
let requestId = 0;
const collectionSize = 48;

async function readJson(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'A consulta falhou. Tente novamente.');
  return data;
}

const atlasReady = readJson('/api/pokemon-atlas').then((result) => { atlas = result; }).catch(() => {});
const speciesOf = (pokemon) => atlas.species?.[pokemon.speciesId];

async function addPortrait(holder, placeholder, looktype, size) {
  if (!Number.isSafeInteger(looktype) || looktype <= 0) return;
  const frame = await readJson(`/api/pokemon-sprite/${looktype}`).catch(() => null);
  if (!frame || !/^\/assets\/asset-packs\/outfits\/[\w/-]+\.webp$/.test(frame.path)
    || ![frame.x, frame.y, frame.w, frame.h, frame.width, frame.height].every(Number.isInteger)
    || frame.w <= 0 || frame.h <= 0) return;
  const scale = Math.min(size / frame.w, size / frame.h);
  const crop = element('span', null, 'sprite-crop');
  crop.style.width = `${frame.w * scale}px`;
  crop.style.height = `${frame.h * scale}px`;
  crop.style.backgroundImage = `url(https://pokeidle.io${frame.path})`;
  crop.style.backgroundSize = `${frame.width * scale}px ${frame.height * scale}px`;
  crop.style.backgroundPosition = `${-frame.x * scale}px ${-frame.y * scale}px`;
  placeholder.hidden = true;
  holder.append(crop);
}

function sprite(pokemon, size = 48) {
  const holder = element('span', null, 'pokemon-sprite');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.width = holder.style.height = `${size}px`;
  const placeholder = element('span', '◉', 'sprite-placeholder');
  holder.append(placeholder);
  const looktype = pokemon.looktype ?? speciesOf(pokemon)?.looktype;
  const preferredLook = pokemon.shiny ? pokemon.shinyLook : looktype;
  const position = atlas.slots?.[preferredLook];
  const version = /^[\w-]+$/.test(atlas.version ?? '') ? `?v=${atlas.version}` : '';
  if (Array.isArray(position) && position.length === 2 && position.every(Number.isInteger)
    && Number.isInteger(atlas.cols) && Number.isInteger(atlas.rows)) {
    holder.style.backgroundImage = `url(https://pokeidle.io/assets/site/assets/maps/marker-atlas.png${version})`;
    holder.style.backgroundSize = `${atlas.cols * size}px ${atlas.rows * size}px`;
    holder.style.backgroundPosition = `${-position[0] * size}px ${-position[1] * size}px`;
    placeholder.hidden = true;
  } else if (Number.isInteger(pokemon.speciesId) && pokemon.speciesId >= 1 && pokemon.speciesId <= 1025) {
    const image = element('img');
    image.alt = '';
    image.loading = 'lazy';
    image.width = image.height = size;
    image.addEventListener('load', () => { placeholder.hidden = true; });
    image.addEventListener('error', () => {
      image.remove();
      void addPortrait(holder, placeholder, preferredLook ?? looktype, size);
    });
    image.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemon.shiny ? 'shiny/' : ''}${pokemon.speciesId}.png`;
    holder.append(image);
  } else void addPortrait(holder, placeholder, preferredLook ?? looktype, size);
  return holder;
}

function specimenPortrait(pokemon, size = 256, loading = 'eager') {
  const id = pokemon.speciesId;
  const fallback = () => sprite(pokemon, Math.round(size * .9));
  if (!Number.isInteger(id) || id < 1 || id > 1025) return fallback();
  const image = element('img');
  image.alt = '';
  image.width = image.height = size;
  image.loading = loading;
  image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
  image.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemon.shiny ? 'shiny/' : ''}${id}.png`;
  return image;
}

const primaryMetrics = (pokemon) => [
  ['Nível', number(pokemon.level)], ['Potência', pokemon.power ? `P${pokemon.power}` : '—'],
  ['Nota', number(pokemon.rating)], ['IV total', number(pokemon.iv)],
];

function metricCells(entries) {
  return entries.map(([label, value]) => {
    const cell = element('div');
    cell.append(element('dt', label), element('dd', value));
    return cell;
  });
}

function setHeading(title, intro) {
  document.title = `IdleBot | ${title}`;
  byId('catalog-title').textContent = title;
  byId('catalog-intro').textContent = intro;
}

function setPages(current, total, select) {
  byId('catalog-pages').hidden = total <= 1;
  byId('page-info').textContent = `Página ${current + 1} de ${total}`;
  byId('page-previous').disabled = current <= 0;
  byId('page-next').disabled = current + 1 >= total;
  byId('page-previous').onclick = () => select(current - 1);
  byId('page-next').onclick = () => select(current + 1);
}

function pokemonCard(profile, pokemon) {
  const entry = element('li');
  const link = element('a', null, 'pokemon-card');
  link.href = `/pokemon/${profile.id}/${pokemon.id}`;
  if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page');
  const header = element('div', null, 'pokemon-card-header');
  const portrait = element('div', null, 'pokemon-card-art');
  portrait.setAttribute('aria-hidden', 'true');
  portrait.append(specimenPortrait(pokemon, 150, 'lazy'));
  if (Number.isInteger(pokemon.speciesId)) {
    portrait.append(element('span', `#${String(pokemon.speciesId).padStart(4, '0')}`, 'specimen-number'));
  }
  const body = element('span', null, 'pokemon-card-body');
  body.append(element('strong', displayName(pokemon)));
  if (pokemon.nickname) body.append(element('small', pokemon.name));
  body.append(element('small', `${profileName(profile)} · ${locations[pokemon.location] ?? 'Coleção'}`));
  const types = pokemon.types?.length ? pokemon.types : speciesOf(pokemon)?.types ?? [];
  if (types.length) {
    const badges = element('span', null, 'pokemon-types');
    for (const type of types) {
      const badge = element('span', typesPt[String(type).toUpperCase()] ?? type, 'pokemon-type');
      badge.dataset.type = String(type).toLowerCase();
      badges.append(badge);
    }
    body.append(badges);
  }
  if (pokemon.shiny) body.append(element('span', 'Shiny', 'shiny-badge'));
  header.append(portrait, body);
  const metrics = element('dl', null, 'pokemon-card-metrics');
  metrics.append(...metricCells(primaryMetrics(pokemon)));
  link.append(header, metrics);
  entry.append(link);
  return entry;
}

function renderCollection() {
  const profileFilter = byId('profile-filter').value;
  const locationFilter = byId('location-filter').value;
  const order = byId('collection-order').value;
  const shinyOnly = byId('shiny-filter').checked;
  const query = searchKey(byId('collection-search').value.trim());
  const selected = profiles.filter(({ id }) => !profileFilter || Number(profileFilter) === id);
  const entries = selected.flatMap((profile) => profile.pokemon.map((pokemon) => ({ profile, pokemon })));
  const filtered = entries.filter(({ pokemon }) => (!locationFilter || pokemon.location === locationFilter)
    && (!shinyOnly || pokemon.shiny) && searchKey(`${pokemon.name} ${pokemon.nickname ?? ''} #${pokemon.id}`).includes(query));
  const orderValue = (pokemon) => Number.isFinite(pokemon[order]) ? pokemon[order] : -Infinity;
  filtered.sort(({ pokemon: left }, { pokemon: right }) => {
    if (order) {
      const leftValue = orderValue(left);
      const rightValue = orderValue(right);
      if (leftValue !== rightValue) return rightValue - leftValue;
    }
    return displayName(left).localeCompare(displayName(right), 'pt-BR') || left.id - right.id;
  });
  const grid = byId('pokemon-grid');
  grid.replaceChildren(...filtered.slice(pageIndex * collectionSize, (pageIndex + 1) * collectionSize)
    .map(({ profile, pokemon }) => pokemonCard(profile, pokemon)));
  byId('profile-status').textContent = selected.map((profile) => `${profileName(profile)} · ${profileStatus(profile)}`).join('  •  ');
  byId('catalog-status').textContent = selected.every(({ updatedAt }) => updatedAt == null)
    ? 'Abra um perfil na aba Caça e entre no PokeIdle para sincronizar a coleção.'
    : filtered.length ? `${number(filtered.length)} de ${number(entries.length)} Pokémon` : 'Nenhum Pokémon encontrado.';
  setPages(pageIndex, Math.ceil(filtered.length / collectionSize), (page) => {
    pageIndex = page;
    renderCollection();
    grid.scrollIntoView({ block: 'start' });
  });
}

async function loadCollection() {
  const [data] = await Promise.all([readJson('/api/collection'), atlasReady]);
  profiles = data.profiles;
  const select = byId('profile-filter');
  const previous = select.value;
  select.replaceChildren(new Option('Todos os perfis', ''), ...profiles.map((profile) => new Option(profileName(profile), profile.id)));
  if (profiles.some(({ id }) => String(id) === previous)) select.value = previous;
  pageIndex = 0;
  renderCollection();
}

async function loadSpecimenBrowser() {
  if (!matchMedia('(min-width: 1181px)').matches) return;
  try {
    const [data] = await Promise.all([readJson('/api/collection'), atlasReady]);
    const entries = data.profiles.flatMap((profile) => profile.pokemon.map((pokemon) => ({ profile, pokemon })));
    const selected = ({ profile, pokemon }) => String(profile.id) === detailPath[1] && String(pokemon.id) === detailPath[2];
    entries.sort((left, right) => Number(selected(right)) - Number(selected(left)));
    byId('specimen-list').replaceChildren(...entries.slice(0, 6).map(({ profile, pokemon }) => pokemonCard(profile, pokemon)));
    byId('specimen-browser').hidden = !entries.length;
    document.querySelector('main.catalog').classList.toggle('has-specimen', entries.length > 0);
  } catch {
    // A collection read failure must not hide a successfully loaded specimen.
    byId('specimen-browser').hidden = true;
    document.querySelector('main.catalog').classList.remove('has-specimen');
  }
}

const statLabels = { hp: 'HP', atk: 'Ataque', def: 'Defesa', spAtk: 'Ataque especial', spDef: 'Defesa especial', speed: 'Velocidade' };

function specimenMeter(label, value, note, current, max) {
  const meter = element('div', null, 'specimen-meter');
  const caption = element('div', null, 'specimen-meter-caption');
  caption.append(element('span', label), element('strong', value));
  meter.append(caption);
  if (Number.isFinite(current) && Number.isFinite(max) && max > 0) {
    const progress = element('progress');
    progress.max = max;
    progress.value = Math.max(0, Math.min(current, max));
    progress.setAttribute('aria-label', label);
    meter.append(progress);
  }
  if (note) meter.append(element('small', note));
  return meter;
}

const specimenSummary = ['specimen-art', 'specimen-badges', 'specimen-metrics', 'specimen-vitals'];

function renderSpecimenSummary(pokemon, types, rarity) {
  const art = byId('specimen-art');
  const portraitKey = `${pokemon.speciesId}:${pokemon.looktype}:${pokemon.shinyLook}:${pokemon.shiny}`;
  if (art.dataset.portrait !== portraitKey) {
    art.replaceChildren(specimenPortrait(pokemon), element('span', `#${String(pokemon.speciesId).padStart(3, '0')}`, 'specimen-number'));
    art.dataset.portrait = portraitKey;
  }
  byId('specimen-badges').replaceChildren(
    ...types.map((type) => {
      const badge = element('li', typesPt[String(type).toUpperCase()] ?? type, 'specimen-type');
      badge.dataset.type = String(type).toLowerCase();
      return badge;
    }),
    ...(rarity ? [element('li', rarity)] : []),
    ...(pokemon.shiny ? [element('li', 'Shiny', 'specimen-shiny')] : []),
  );
  const metrics = [
    ...primaryMetrics(pokemon),
    ['Poder de combate', number(pokemon.combatPower)], ['Qualidade', number(pokemon.quality)],
  ];
  byId('specimen-metrics').replaceChildren(...metricCells(metrics));
  const hp = Number.isFinite(pokemon.maxHp) ? `${number(pokemon.hp)} / ${number(pokemon.maxHp)}` : number(pokemon.hp);
  const hasXp = Number.isFinite(pokemon.xp);
  const remainingXp = hasXp && Number.isFinite(pokemon.xpNext) ? Math.max(0, pokemon.xpNext - pokemon.xp) : null;
  const hasXpRange = remainingXp != null && Number.isFinite(pokemon.xpLevel);
  byId('specimen-vitals').replaceChildren(
    specimenMeter('HP atual', hp, null, pokemon.hp, pokemon.maxHp),
    specimenMeter('Experiência', hasXp ? `${number(pokemon.xp)} XP` : '—',
      remainingXp == null ? null : `${number(remainingXp)} XP para o próximo nível`,
      hasXpRange ? pokemon.xp - pokemon.xpLevel : null, hasXpRange ? pokemon.xpNext - pokemon.xpLevel : null),
  );
  for (const id of specimenSummary) byId(id).hidden = false;
  byId('specimen-badges').hidden = !byId('specimen-badges').childElementCount;
}

function dataPanel(title, entries) {
  const panel = element('section', null, 'catalog-panel');
  const list = element('dl', null, 'specimen-data');
  for (const [label, value] of entries) {
    if (value == null || value === '') continue;
    list.append(element('dt', label), element('dd', typeof value === 'number' ? number(value) : value));
  }
  panel.append(element('h2', title), list);
  return panel;
}

function dataTable(headers, rows) {
  const wrap = element('div', null, 'table-wrap catalog-table');
  const table = element('table');
  const head = table.createTHead().insertRow();
  for (const label of headers) {
    const th = element('th', label);
    th.scope = 'col';
    head.append(th);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) row.insertCell().append(value instanceof Node ? value : String(value ?? '—'));
  }
  wrap.append(table);
  return wrap;
}

async function loadSpecimen() {
  const [, profile, id] = detailPath;
  const [result] = await Promise.all([readJson(`/api/profiles/${profile}/pokemon/${id}`), atlasReady]);
  const { pokemon, account } = result;
  const species = speciesOf(pokemon);
  const types = Array.isArray(pokemon.types) && pokemon.types.length ? pokemon.types : species?.types ?? [];
  const rarity = rarityPt[species?.rarity] ?? species?.rarity;
  const name = displayName(pokemon);
  setHeading(name, [pokemon.name !== name ? pokemon.name : null, account, locations[pokemon.location]].filter(Boolean).join(' · '));
  renderSpecimenSummary(pokemon, types, rarity);
  const columns = element('div', null, 'specimen-grid');
  const stats = element('section', null, 'specimen-stats');
  stats.append(element('h2', 'Atributos e IVs'));
  stats.append(dataTable(['Atributo', 'Atual', 'IV', 'Refino'], Object.entries(statLabels).map(([key, label]) => [
    label, number(pokemon.stats?.[key]), number(pokemon.ivs?.[key]), number(pokemon.refinement?.[key]),
  ])));
  const side = element('div', null, 'specimen-side');
  const evolution = atlas.species?.[species?.evolvesTo];
  if (evolution || species?.evolveLevel > 0) {
    const panel = element('section', null, 'catalog-panel specimen-evolution');
    const row = element('div', null, 'specimen-evolution-row');
    const info = element('div');
    if (evolution?.name) info.append(element('strong', evolution.name));
    if (species.evolveLevel) info.append(element('small', `A partir do nível ${number(species.evolveLevel)}`));
    if (evolution) row.append(sprite({ speciesId: species.evolvesTo, looktype: evolution.looktype }, 48));
    row.append(info);
    panel.append(element('h2', 'Próxima evolução'), row);
    side.append(panel);
  }
  side.append(dataPanel('Detalhes do exemplar', [
    ['Exemplar', `#${pokemon.id}`], ['Espécie', pokemon.name], ['ID da espécie', pokemon.speciesId],
    ['Item equipado', pokemon.heldItem], ['Capturado por', pokemon.capturedBy],
    ['Capturado em', pokemon.capturedAt ? date(pokemon.capturedAt) : null],
  ]));
  columns.append(stats, side);
  const extra = element('details', null, 'catalog-panel section');
  extra.append(element('summary', 'Todos os dados enviados pelo jogo'), element('pre', JSON.stringify(pokemon.details, null, 2)));
  byId('specimen').replaceChildren(columns, extra);
  byId('catalog-status').textContent = profileStatus(result);
}

function showItem(id, currency) {
  marketItem = id;
  byId('market-currency').value = currency;
  return load(0);
}

function itemPriceLink(item, currency) {
  if (!item[currency]) return '—';
  const button = element('button', price(item[currency].price, currency), 'price-button');
  button.type = 'button';
  button.setAttribute('aria-label', `Anúncios de ${item.name} a partir de ${button.textContent}`);
  button.onclick = () => showItem(item.id, currency);
  return button;
}

async function loadMarket(page, current) {
  const type = byId('market-type').value;
  const currency = byId('market-currency').value;
  const params = new URLSearchParams({
    type, currency, page,
    search: byId('market-search').value,
    order: byId('market-order').value,
  });
  if (marketItem && currency) params.set('item', marketItem);
  const [result] = await Promise.all([readJson(`/api/market?${params}`), atlasReady]);
  if (current !== requestId) return;
  byId('item-heading').hidden = !result.itemName;
  byId('item-title').textContent = result.itemName ?? '';
  const rows = result.mode === 'items'
    ? result.rows.map((item) => [item.name, number(item.quantity), number(item.offers), itemPriceLink(item, 'gold'), itemPriceLink(item, 'orb')])
    : result.rows.map((offer) => {
      const { pokemon } = offer;
      const info = element('span', null, 'market-pokemon');
      const title = pokemon ? displayName(pokemon) : offer.name;
      if (pokemon) info.append(sprite(pokemon, 40));
      const label = element('span', title ?? 'Pokémon');
      if (pokemon) label.append(element('small', `Nível ${number(pokemon.level)}${pokemon.shiny ? ' · ★ Shiny' : ''}`));
      info.append(label);
      return [info, number(offer.quantity), price(offer.price, offer.currency), offer.seller];
    });
  const headers = result.mode === 'items'
    ? ['Item', 'Unidades', 'Anúncios', 'A partir de · Coins', 'A partir de · Gemas']
    : [type === 'pokemon' ? 'Pokémon' : 'Item', 'Quantidade', 'Preço unitário', 'Vendedor'];
  const results = byId('market-results');
  results.replaceChildren(...(rows.length ? [dataTable(headers, rows)] : []));
  byId('catalog-status').textContent = rows.length ? `Consultado em ${date(result.updatedAt)}` : 'Nenhum anúncio encontrado com esses filtros.';
  setPages(result.page ?? 0, result.pages ?? 1, (index) => load(index));
}

async function load(page = 0) {
  const current = ++requestId;
  const refresh = byId('catalog-refresh');
  refresh.disabled = true;
  byId('catalog-pages').hidden = true;
  byId('catalog-status').textContent = marketView ? 'Consultando o mercado do jogo…' : 'Lendo a conta no IdleBot…';
  if (marketView) {
    byId('market-results').replaceChildren();
    byId('item-heading').hidden = !marketItem;
    byId('market-filters').querySelector('button').disabled = true;
  }
  try {
    if (marketView) await loadMarket(page, current);
    else if (detailPath) await Promise.all([loadSpecimen(), loadSpecimenBrowser()]);
    else await loadCollection();
  } catch (error) {
    if (current !== requestId) return;
    byId('catalog-status').textContent = error.message;
    if (detailPath) {
      setHeading('Exemplar indisponível', '');
      byId('specimen').replaceChildren();
      for (const id of specimenSummary) byId(id).hidden = true;
    }
  } finally {
    if (current === requestId) {
      refresh.disabled = false;
      if (marketView) byId('market-filters').querySelector('button').disabled = false;
    }
  }
}

byId('catalog-refresh').onclick = () => load();
if (marketView) {
  byId('market-link').setAttribute('aria-current', 'page');
  byId('market').hidden = false;
  setHeading('Mercado', 'Anúncios ativos do PokeIdle. Consulte preços por unidade em Coins e Gemas.');
  byId('market-filters').onsubmit = (event) => {
    event.preventDefault();
    marketItem = null;
    void load();
  };
  byId('market-type').onchange = () => {
    marketItem = null;
    byId('market-order-label').hidden = byId('market-type').value !== 'pokemon';
  };
  byId('market-back').onclick = () => {
    marketItem = null;
    byId('market-currency').value = '';
    void load();
  };
} else {
  byId('collection-link').setAttribute('aria-current', detailPath ? 'location' : 'page');
  byId('back-link').hidden = !detailPath;
  if (detailPath) byId('catalog-heading').classList.add('specimen-heading');
  byId(detailPath ? 'specimen' : 'collection').hidden = false;
  setHeading(detailPath ? 'Ficha do Pokémon' : 'Meus Pokémon',
    detailPath ? '' : 'Veja a equipe, o Depot e a Coleção de cada conta conectada.');
  for (const id of ['collection-search', 'profile-filter', 'location-filter', 'collection-order', 'shiny-filter']) {
    byId(id).oninput = () => {
      pageIndex = 0;
      renderCollection();
    };
  }
}
void load();
