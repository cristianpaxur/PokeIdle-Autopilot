import { RemoteScreen } from './remote.js';
import { activityConfirmed, phaseLabels, phaseStats, progressAge, renderAttention, watchScreenVisibility } from './profile-summary.js';

const byId = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat('pt-BR');
const rate = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
});
const number = (value) => value == null ? '—' : integer.format(value);
const clock = (value) => Number.isFinite(value) ? time.format(new Date(value)) : '—';
const profileName = (id) => `Perfil ${String(id).padStart(2, '0')}`;
const labels = {
  offline: 'Fechado', opening: 'Abrindo', login: 'Login', 'native-login': 'Login no navegador', ready: 'Conectado',
  hunting: 'Caçando', waiting: 'Aguardando', paused: 'Pausado',
  blocked: 'Precisa de você', setup: 'Precisa de você', reconnecting: 'Reconectando',
  recovering: 'Recuperando', warning: 'Atenção',
};
const cards = new Map();
const screens = new Map();
const controlTokens = new Map();
let remote = false;
let expanded;
let profiles = [];
let lastSnapshotAt = null;
let connected = false;
const period = byId('period');
const visibility = watchScreenVisibility((id, visible) => {
  const view = cards.get(id)?.querySelector('.view');
  const profile = profiles.find((current) => current.id === id);
  if (!view || !profile) return;
  view.dataset.visible = String(visible);
  renderPreview(profile, view);
});

async function command(id, action) {
  const result = await fetch(`/api/profiles/${id}/${action}`, {
    method: 'POST', headers: { 'X-IdleBot': '1' },
  });
  if (result.status === 204) return;
  const data = await result.json().catch(() => null);
  if (!result.ok) throw new Error(data?.error ?? 'O comando não foi executado. Tente novamente.');
  return data;
}

function feedback(error) {
  const message = byId('remote-dialog').open ? byId('remote-feedback') : byId('feedback');
  message.textContent = error?.message ?? '';
  message.hidden = !error;
}

function showRemote(id, token) {
  const dialog = byId('remote-dialog');
  byId('remote-title').textContent = profileName(id);
  byId('remote-mode').textContent = token ? 'Controle manual. Robô pausado.' : 'Transmissão ao vivo.';
  byId('remote-return').hidden = !token;
  if (!dialog.open) dialog.showModal();
  expanded?.screen.close();
  const view = byId('remote-view');
  view.querySelector('small').textContent = 'Conectando transmissão…';
  expanded = {
    id, token, screen: new RemoteScreen(view, id, token),
    seenManual: profiles.some((profile) => profile.id === id && profile.control === 'manual'),
  };
}

async function act(id, action) {
  if (remote && action === 'focus') return showRemote(id, controlTokens.get(id));
  if (action === 'take') {
    const { token } = await command(id, action);
    controlTokens.set(id, token);
    return showRemote(id, token);
  }
  await command(id, action);
  if (action === 'release') {
    controlTokens.delete(id);
    if (expanded?.id === id) byId('remote-dialog').close();
  }
}

function makeCard(id) {
  const card = document.createElement('article');
  card.className = 'profile operation-profile';
  card.id = `profile-${id}`;
  card.innerHTML = `<div class="profile-top">
      <div class="profile-identity">
        <span class="profile-art" aria-hidden="true" hidden></span>
        <div><h3></h3><p class="profile-pokemon" hidden></p></div>
      </div>
      <span class="status"></span>
    </div>
    <div class="profile-info">
      <div class="profile-route"><strong data-stat="hunt"></strong><small data-stat="activity"></small></div>
      <div class="level-meter" hidden>
        <span></span><progress max="150" aria-label="Nível do treinador para liberar Outland"></progress>
      </div>
      <p class="profile-note"></p>
      <div class="profile-stat phase-stats"></div>
      <details class="hunt-comparison" hidden>
        <summary>XP das hunts</summary>
        <p data-optimizer-note></p>
        <ol data-hunt-ranking></ol>
      </details>
      <details class="profile-market" hidden>
        <summary></summary>
        <p class="market-note"></p>
        <ul class="item-stock"></ul>
      </details>
      <div class="profile-actions">
        <label class="profile-mode">Modo de caça
          <select data-mode aria-label="Modo de caça, ${profileName(id)}">
            <option value="farm">Progressão e Outland</option>
            <option value="shiny">Shiny</option>
          </select>
        </label>
        <div class="profile-controls">
        <button type="button" data-action="start">Abrir</button>
        <button type="button" data-action="pause">Pausar</button>
        <button type="button" data-action="focus">Ver jogo</button>
        <button type="button" data-action="take" hidden>Assumir controle</button>
        <button type="button" data-action="release" hidden>Devolver ao robô</button>
        <button type="button" data-action="stop">Fechar</button>
        </div>
      </div>
    </div>
    <div class="view" data-screen-profile="${id}" hidden><small>Prévia da caça</small></div>`;
  card.querySelectorAll('[data-action]').forEach((button) => {
    button.setAttribute('aria-label', `${button.textContent}, ${profileName(id)}`);
    button.addEventListener('click', async () => {
      try {
        feedback(null);
        button.disabled = true;
        await act(id, button.dataset.action);
      } catch (error) {
        feedback(error);
      } finally {
        const profile = profiles.find((entry) => entry.id === id);
        if (profile) renderCard(profile);
      }
    });
  });
  const mode = card.querySelector('[data-mode]');
  mode.addEventListener('change', async () => {
    mode.dataset.saving = '1';
    mode.disabled = true;
    try {
      feedback(null);
      await command(id, `mode/${mode.value}`);
    } catch (error) {
      feedback(error);
      const profile = profiles.find((entry) => entry.id === id);
      if (profile) mode.value = profile.mode;
    } finally {
      delete mode.dataset.saving;
      const profile = profiles.find((entry) => entry.id === id);
      mode.disabled = ['manual', 'pausing'].includes(profile?.control);
    }
  });
  byId('profiles').append(card);
  cards.set(id, card);
  visibility.observe(card.querySelector('.view'));
  return card;
}

function renderCard(profile) {
  const card = cards.get(profile.id) ?? makeCard(profile.id);
  const nick = card.querySelector('h3');
  nick.textContent = profile.account || profileName(profile.id);
  nick.title = nick.textContent;
  const pokemon = card.querySelector('.profile-pokemon');
  pokemon.hidden = !profile.pokemon?.name;
  pokemon.textContent = profile.pokemon?.name
    ? `${profile.pokemon.name} · Nv ${number(profile.pokemon.level)}` : '';
  const art = card.querySelector('.profile-art');
  const speciesId = Number(profile.pokemon?.speciesId);
  if (Number.isSafeInteger(speciesId) && speciesId > 0) {
    const form = profile.pokemon.shiny ? 'shiny/' : '';
    const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${form}${speciesId}.png`;
    if (art.dataset.sprite !== url) {
      art.dataset.sprite = url;
      art.hidden = true;
      const sprite = new Image(44, 44);
      sprite.alt = '';
      sprite.addEventListener('load', () => {
        if (art.dataset.sprite !== url) return;
        art.replaceChildren(sprite);
        art.hidden = false;
      }, { once: true });
      sprite.src = url;
    }
  } else {
    art.hidden = true;
    delete art.dataset.sprite;
  }
  const status = card.querySelector('.status');
  const manual = profile.control === 'manual';
  const changing = profile.control === 'pausing';
  const starting = profile.status === 'hunting' && !activityConfirmed(profile);
  status.textContent = manual ? 'Controle manual' : changing ? 'Pausando'
    : starting ? 'Verificando caça' : labels[profile.status] ?? 'Aguardando';
  status.className = `status ${manual || starting ? 'waiting' : profile.status}`;
  const profileNote = card.querySelector('.profile-note');
  profileNote.textContent = profile.attention?.text ?? profile.note ?? '';
  profileNote.hidden = !profile.attention && !['waiting', 'opening'].includes(profile.status)
    && !(profile.phase === 'shiny' && profile.active && profile.balls === 0);
  const route = [phaseLabels[profile.phase], profile.hunt?.replaceAll('-', ' ')].filter(Boolean);
  card.querySelector('[data-stat="hunt"]').textContent = route.join(' · ') || 'Sem rota ativa';
  card.querySelector('[data-stat="activity"]').textContent = profile.active ? progressAge(profile.lastProgressAt) : '';
  const meter = card.querySelector('.level-meter');
  meter.hidden = profile.phase !== 'progression' || !Number.isFinite(profile.level);
  if (!meter.hidden) {
    meter.querySelector('span').textContent = `Treinador Nv ${number(profile.level)} / 150 para Outland`;
    meter.querySelector('progress').value = profile.level;
  }
  const stat = (text) => Object.assign(document.createElement('span'), { textContent: text });
  const stats = phaseStats(profile, period.value);
  if (profile.phase === 'shiny' && profile.balls != null) stats.push(`${number(profile.balls)} bolas na bolsa`);
  card.querySelector('.phase-stats').replaceChildren(...stats.map(stat));
  renderMarket(card, profile);
  const optimizer = profile.huntOptimizer;
  card.querySelector('.hunt-comparison').hidden = profile.phase !== 'progression';
  const trial = optimizer?.trial;
  const note = card.querySelector('[data-optimizer-note]');
  note.textContent = trial
    ? `${optimizer.stage === 'best' ? 'Melhor medida' : 'Medindo'} · ${trial.slug.replaceAll('-', ' ')} · ${Math.floor(trial.elapsedMs / 1000)} s`
    : 'Aguardando uma medição de caça.';
  const observations = [...(optimizer?.ranking ?? []),
    ...(optimizer?.rejected ?? []).map((row) => ({ ...row, rejected: true }))];
  card.querySelector('[data-hunt-ranking]').replaceChildren(...observations.map((sample) => {
    const item = document.createElement('li');
    item.textContent = `${sample.slug.replaceAll('-', ' ')} · ${number(Math.round(sample.trainerXpPerHour))} XP treinador/h`
      + ` · ${number(Math.round(sample.pokemonXpPerHour))} XP principal/h · ${sample.faints} desmaios`
      + ` · ${Math.round(sample.durationMs / 1000)} s medidos`
      + (sample.rejected ? ' · Descartada por desmaios' : '');
    return item;
  }));
  const mode = card.querySelector('[data-mode]');
  if (!mode.dataset.saving) mode.value = profile.mode;
  mode.disabled = Boolean(mode.dataset.saving) || manual || changing;
  renderPreview(profile, card.querySelector('.view'));
  const start = card.querySelector('[data-action="start"]');
  start.textContent = profile.status === 'login' ? 'Entrar' : profile.paused && profile.active ? 'Retomar' : 'Abrir';
  start.setAttribute('aria-label', `${start.textContent}, ${profileName(profile.id)}`);
  start.disabled = manual || changing || (profile.active && !profile.paused && profile.status !== 'login');
  start.hidden = start.disabled;
  card.querySelector('[data-action="pause"]').disabled = manual || changing || !profile.active || profile.paused || profile.status === 'native-login';
  const focus = card.querySelector('[data-action="focus"]');
  const focusLabel = manual && controlTokens.has(profile.id) ? 'Abrir controle' : 'Ver jogo';
  focus.textContent = focusLabel;
  focus.setAttribute('aria-label', `${focusLabel}, ${profileName(profile.id)}`);
  focus.disabled = !profile.active || (!remote && ['opening', 'native-login'].includes(profile.status));
  const take = card.querySelector('[data-action="take"]');
  take.hidden = !remote || manual;
  take.disabled = !profile.active || changing;
  card.querySelector('[data-action="release"]').hidden = !remote || !manual;
  card.querySelector('[data-action="stop"]').disabled = manual || changing || !profile.active;
}

function renderPreview(profile, view) {
  const mosaic = document.body.classList.contains('mosaic');
  const visible = view.dataset.visible === 'true';
  const name = profile.account || profileName(profile.id);
  const placeholder = view.querySelector('small');
  view.hidden = !mosaic && !profile.active && !profile.preview;
  if (remote) {
    const shouldStream = profile.active && (mosaic || visible);
    if (shouldStream && !screens.has(profile.id)) {
      placeholder.textContent = 'Conectando transmissão…';
      screens.set(profile.id, new RemoteScreen(view, profile.id));
    } else if (!shouldStream) {
      screens.get(profile.id)?.close();
      screens.delete(profile.id);
      placeholder.textContent = profile.active ? 'Transmissão ao vivo' : 'Perfil fechado';
    }
    return;
  }
  if (!profile.preview) {
    view.querySelector('img')?.remove();
    delete view.dataset.version;
    placeholder.hidden = false;
    placeholder.textContent = 'Aguardando a primeira prévia da caça…';
    return;
  }
  if (!visible || view.dataset.version === String(profile.preview)) return;
  const image = new Image();
  image.alt = `Cena da caça de ${name}`;
  view.dataset.version = profile.preview;
  image.onload = () => {
    if (view.dataset.version !== String(profile.preview)) return;
    view.querySelector('img')?.remove();
    view.append(image);
    placeholder.hidden = true;
  };
  image.src = `/api/profiles/${profile.id}/preview?v=${profile.preview}`;
}

function renderMarket(card, profile) {
  const market = card.querySelector('.profile-market');
  const inventory = profile.itemStock?.items ?? [];
  const listings = profile.openListings ?? 0;
  const status = profile.marketStatus;
  market.hidden = !inventory.length && !listings && !status;
  market.querySelector('summary').textContent = [
    `Mercado · ${number(listings)} em anúncio`,
    ...(inventory.length ? [`${number(inventory.reduce((sum, item) => sum + item.quantity, 0))} drops na bolsa`] : []),
  ].join(' · ');
  market.querySelector('.market-note').textContent = status
    ? [status.name, status.text].filter(Boolean).join(' · ') : '';
  market.querySelector('.item-stock').replaceChildren(...inventory.map((item) => {
    const row = document.createElement('li');
    const price = item.price == null ? 'Sem cotação' : `${number(item.price)} Gemas/un.`;
    row.textContent = [`${number(item.quantity)} × ${item.name}`, price, item.note].filter(Boolean).join(' · ');
    return row;
  }));
}

function row(values, empty = false) {
  const tr = document.createElement('tr');
  for (const value of values) {
    const cell = tr.insertCell();
    cell.textContent = value;
    if (empty) cell.colSpan = 5;
  }
  return tr;
}

const operationStatus = {
  pending: 'Aguardando resposta', uncertain: 'Verificando com o jogo',
  confirmed: 'Confirmado pelo jogo', returned: 'Devolvido ao estoque', sold: 'Vendido',
};

function renderTables() {
  const filter = Number(byId('filter').value);
  const shown = filter ? profiles.filter(({ id }) => id === filter) : profiles;
  const entries = shown.flatMap((profile) => profile.captures.map((capture) => ({
    ...capture, profile: profile.account ?? profileName(profile.id),
  }))).sort((a, b) => b.time - a.time).slice(0, 25);
  byId('captures').replaceChildren(...(entries.length ? entries.map((capture) => row([
    `${capture.name}${capture.shiny ? ' ✧ Shiny' : ''} · Nv ${number(capture.level)}${capture.power ? ` · P${capture.power}` : ''}`,
    capture.profile, clock(capture.time),
    capture.quote ? `${number(capture.quote.gems)} brutas · ${number(capture.quote.net)} líquidas` : 'Sem cotação',
    operationStatus[capture.listing] ?? (capture.quote ? 'Cotado' : 'Em estoque'),
  ])) : [row(['Aguardando as primeiras capturas.'], true)]));
  const operations = profiles.flatMap((profile) => [
    ...profile.listings.map((op) => ({ ...op,
      label: op.itemId ? `Anúncio · ${op.name ?? `Item #${op.itemId}`}` : `Anúncio #${op.key}`, profile: profile.id })),
    ...profile.sales.map((op) => ({ ...op, label: op.name ? `Venda · ${op.name}` : 'Venda', state: 'sale', gems: op.net, profile: profile.id })),
    ...profile.withdrawals.map((op) => ({ ...op, label: 'Pedido de saque', profile: profile.id })),
    ...profile.paid.map((op) => ({ ...op, label: 'Saque pago', state: 'paid', gems: op.orbs, profile: profile.id })),
  ]).sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 30);
  byId('operations').replaceChildren(...(operations.length ? operations.map((op) => row([
    op.label, profileName(op.profile), clock(op.time), number(op.gems),
    op.state === 'paid' ? 'Pago pelo jogo' : op.state === 'sale' ? 'Venda líquida' : operationStatus[op.state] ?? '—',
  ])) : [row(['Aguardando as primeiras operações.'], true)]));
}

function render(state) {
  remote = Boolean(state.remote);
  profiles = state.profiles;
  byId('mobile-qr').hidden = !remote;
  byId('mosaic').hidden = !remote;
  byId('profiles').classList.toggle('streaming', remote);
  if (expanded?.token) {
    const control = profiles.find(({ id }) => id === expanded.id)?.control;
    if (control === 'manual') expanded.seenManual = true;
    if (expanded.seenManual && control === 'automatic') {
      controlTokens.delete(expanded.id);
      byId('remote-dialog').close();
    }
  }
  renderSummary();
  byId('start-all').disabled = profiles.every((profile) => (profile.active && !profile.paused)
    || ['manual', 'pausing'].includes(profile.control));
  renderTables();
}

function renderSummary() {
  renderAttention(byId('attention-list'), profiles, (profile) => profile.account || profileName(profile.id));
  profiles.forEach(renderCard);
  const buckets = profiles.flatMap((profile) => Object.values(profile.periods?.[period.value] ?? {}));
  const total = (key) => buckets.reduce((sum, bucket) => sum + (bucket[key] ?? 0), 0);
  byId('kpi-active').textContent = profiles.length ? `${profiles.filter((profile) => activityConfirmed(profile)).length} / ${profiles.length}` : '—';
  byId('kpi-time').textContent = `${rate.format(total('huntMs') / 3_600_000)} h`;
  byId('kpi-activity').textContent = `${number(total('kills'))} abates no período`;
  byId('kpi-sold').textContent = number(total('gems'));
  byId('kpi-sales').textContent = `${number(total('sales'))} vendas do bot no período`;
  const stock = profiles.reduce((sum, profile) => sum + (profile.metrics?.stockGems ?? 0) + (profile.itemStock?.gems ?? 0), 0);
  const unpriced = profiles.reduce((sum, profile) => sum + (profile.itemStock?.unpriced ?? 0), 0);
  byId('kpi-stock').textContent = number(stock || null);
  byId('kpi-stock-note').textContent = unpriced ? `Gemas brutas · ${number(unpriced)} drops sem cotação` : 'Gemas brutas · cotação disponível';
}

byId('filter').addEventListener('change', renderTables);
let qrRequest;
let qrUrl;
async function loadMobileQr(signal) {
  if (signal.aborted) return;
  try {
    const response = await fetch('/mobile-qr.svg', { signal });
    if (!response.ok) throw new Error('QR indisponível');
    const image = await response.blob();
    if (signal.aborted) return;
    qrUrl = URL.createObjectURL(image);
    const qr = new Image(240, 240);
    qr.alt = 'QR code para acompanhar o IdleBot no celular';
    qr.src = qrUrl;
    byId('mobile-code').replaceChildren(qr);
    byId('mobile-qr-status').textContent = 'Escaneie com a câmera do celular para acompanhar a caça.';
  } catch {
    if (!signal.aborted) setTimeout(() => loadMobileQr(signal), 3000);
  }
}
byId('mobile-qr').addEventListener('click', () => {
  qrRequest = new AbortController();
  byId('mobile-qr-status').textContent = 'Preparando acesso ao celular…';
  byId('mobile-dialog').showModal();
  void loadMobileQr(qrRequest.signal);
});
byId('mobile-dialog').addEventListener('close', () => {
  qrRequest?.abort();
  byId('mobile-code').replaceChildren();
  if (qrUrl) URL.revokeObjectURL(qrUrl);
  qrUrl = undefined;
});
byId('mobile-close').addEventListener('click', () => byId('mobile-dialog').close());
byId('mosaic').addEventListener('click', (event) => {
  const enabled = document.body.classList.toggle('mosaic');
  event.currentTarget.textContent = enabled ? 'Voltar ao painel' : 'Ver 4 telas';
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  profiles.forEach(renderCard);
  window.scrollTo(0, 0);
});
period.addEventListener('change', renderSummary);
byId('remote-dialog').addEventListener('cancel', (event) => event.preventDefault());
byId('remote-dialog').addEventListener('close', () => {
  expanded?.screen.close();
  expanded = undefined;
  byId('remote-feedback').hidden = true;
});
byId('remote-close').addEventListener('click', () => byId('remote-dialog').close());
byId('remote-return').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { if (expanded) await act(expanded.id, 'release'); }
  catch (error) { feedback(error); }
  finally { button.disabled = false; }
});
byId('start-all').addEventListener('click', async () => {
  try {
    feedback(null);
    for (const profile of profiles.filter((entry) => (!entry.active || entry.paused)
      && !['manual', 'pausing'].includes(entry.control))) {
      await command(profile.id, 'start');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    feedback(error);
  }
});
const stream = new EventSource('/api/live');
function renderConnection() {
  const fresh = connected && lastSnapshotAt != null && Date.now() - lastSnapshotAt < 45_000;
  byId('live').textContent = !connected ? 'Reconectando painel'
    : lastSnapshotAt == null ? 'Aguardando dados' : fresh ? 'Dados atualizados' : 'Dados desatualizados';
  byId('live-dot').classList.toggle('on', fresh);
}
stream.onopen = () => { connected = true; renderConnection(); };
stream.onmessage = (event) => {
  render(JSON.parse(event.data));
  lastSnapshotAt = Date.now();
  renderConnection();
};
stream.onerror = () => {
  connected = false;
  renderConnection();
};
setInterval(renderConnection, 5000);
