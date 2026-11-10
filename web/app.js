import { RemoteScreen } from './remote.js';

const byId = (id) => document.getElementById(id);
const integer = new Intl.NumberFormat('pt-BR');
const time = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
});
const number = (value) => value == null ? '—' : integer.format(value);
const clock = (value) => Number.isFinite(value) ? time.format(new Date(value)) : '—';
const profileName = (id) => `Perfil ${String(id).padStart(2, '0')}`;
const labels = {
  offline: 'Fechado', opening: 'Abrindo', login: 'Login', 'native-login': 'Login no navegador', ready: 'Conectado',
  hunting: 'Caçando', waiting: 'Aguardando', paused: 'Pausado', completed: 'Meta atingida',
  blocked: 'Atenção', setup: 'Configuração', reconnecting: 'Reconectando', warning: 'Atenção',
};
const cards = new Map();
const screens = new Map();
const controlTokens = new Map();
let remote = false;
let expanded;
let profiles = [];

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
  card.className = 'profile';
  card.innerHTML = `<div class="profile-top"><h3></h3><span class="status"></span></div>
    <div class="view"><small>Prévia da caça</small></div>
    <div class="profile-info"><p class="profile-note"></p>
      <div class="profile-stat"><span data-stat="hunt"></span><span data-stat="balls"></span>
        <span data-stat="gems"></span><span data-stat="captures"></span><span data-stat="mission"></span></div>
      <div class="profile-controls">
        <button type="button" data-action="start">Abrir</button>
        <button type="button" data-action="pause">Pausar</button>
        <button type="button" data-action="focus">Ver jogo</button>
        <button type="button" data-action="take" hidden>Assumir controle</button>
        <button type="button" data-action="release" hidden>Devolver ao robô</button>
        <button type="button" data-action="stop">Fechar</button>
      </div>
    </div>`;
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
  byId('profiles').append(card);
  cards.set(id, card);
  return card;
}

function renderCard(profile) {
  const card = cards.get(profile.id) ?? makeCard(profile.id);
  const nick = card.querySelector('h3');
  nick.textContent = profile.account || profileName(profile.id);
  nick.title = nick.textContent;
  const status = card.querySelector('.status');
  const manual = profile.control === 'manual';
  const changing = profile.control === 'pausing';
  status.textContent = manual ? 'Controle manual' : changing ? 'Pausando' : labels[profile.status] ?? 'Aguardando';
  status.className = `status ${manual ? 'paused' : profile.status}`;
  card.querySelector('.profile-note').textContent = profile.note;
  card.querySelector('[data-stat="hunt"]').textContent = profile.hunt
    ? profile.hunt.replaceAll('-', ' ') : 'Rota —';
  card.querySelector('[data-stat="balls"]').textContent = `${number(profile.balls)} bolas`;
  card.querySelector('[data-stat="gems"]').textContent = `${number(profile.gems)} Gemas`;
  card.querySelector('[data-stat="captures"]').textContent = `${number(profile.metrics.lastHour ?? 0)} capturas/h`;
  card.querySelector('[data-stat="mission"]').textContent = `${profile.mission.sold}/${profile.mission.target} vendidos`
    + (profile.mission.open ? ` · ${number(profile.mission.open)} em andamento` : '');
  const view = card.querySelector('.view');
  const placeholder = view.querySelector('small');
  const currentImage = view.querySelector('img');
  if (remote) {
    if (profile.active && !screens.has(profile.id)) {
      placeholder.textContent = 'Conectando transmissão…';
      screens.set(profile.id, new RemoteScreen(view, profile.id));
    } else if (!profile.active) {
      screens.get(profile.id)?.close();
      screens.delete(profile.id);
      placeholder.textContent = 'Perfil fechado';
    }
  } else if (profile.preview && view.dataset.version !== String(profile.preview)) {
    const image = new Image();
    image.alt = `Cena da caça de ${nick.textContent}`;
    view.dataset.version = profile.preview;
    image.onload = () => {
      if (view.dataset.version !== String(profile.preview)) return;
      view.querySelector('img')?.remove();
      view.append(image);
      placeholder.hidden = true;
    };
    image.src = `/api/profiles/${profile.id}/preview?v=${profile.preview}`;
  } else if (!profile.preview) {
    currentImage?.remove();
    delete view.dataset.version;
    placeholder.hidden = false;
  }
  const start = card.querySelector('[data-action="start"]');
  start.textContent = profile.status === 'login' ? 'Entrar' : profile.paused && profile.active ? 'Retomar' : 'Abrir';
  start.setAttribute('aria-label', `${start.textContent}, ${profileName(profile.id)}`);
  start.disabled = manual || changing || profile.status === 'completed'
    || (profile.active && !profile.paused && profile.status !== 'login');
  card.querySelector('[data-action="pause"]').disabled = manual || changing || !profile.active || profile.paused || profile.status === 'native-login';
  const focus = card.querySelector('[data-action="focus"]');
  const focusLabel = remote ? (manual && controlTokens.has(profile.id) ? 'Abrir controle' : 'Ampliar') : 'Ver jogo';
  focus.textContent = focusLabel;
  focus.setAttribute('aria-label', `${focusLabel}, ${profileName(profile.id)}`);
  focus.disabled = !profile.active || (!remote && ['opening', 'native-login'].includes(profile.status));
  const take = card.querySelector('[data-action="take"]');
  take.hidden = !remote || manual;
  take.disabled = !profile.active || changing;
  card.querySelector('[data-action="release"]').hidden = !remote || !manual;
  card.querySelector('[data-action="stop"]').disabled = manual || changing || !profile.active;
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
    ...profile.listings.map((op) => ({ ...op, label: `Anúncio #${op.key}`, profile: profile.id })),
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
  byId('mobile-qr').hidden = !remote || location.protocol !== 'https:';
  byId('mosaic').hidden = !remote;
  byId('profiles').classList.toggle('streaming', remote);
  byId('preview-note').textContent = remote ? 'Transmissão contínua das sessões' : 'Prévia da caça atualizada a cada 6 segundos';
  if (expanded?.token) {
    const control = profiles.find(({ id }) => id === expanded.id)?.control;
    if (control === 'manual') expanded.seenManual = true;
    if (expanded.seenManual && control === 'automatic') {
      controlTokens.delete(expanded.id);
      byId('remote-dialog').close();
    }
  }
  profiles.forEach(renderCard);
  const total = (key) => profiles.reduce((sum, profile) => sum + (profile.metrics[key] ?? 0), 0);
  byId('kpi-active').textContent = `${profiles.filter((profile) => profile.status === 'hunting').length} / 4`;
  byId('kpi-captures').textContent = number(total('captures'));
  byId('kpi-shinies').textContent = `${number(total('shinies'))} shinies`;
  byId('kpi-stock').textContent = number(total('stockGems') || null);
  byId('kpi-sold').textContent = number(total('soldGems'));
  byId('start-all').disabled = profiles.every((profile) => (profile.active && !profile.paused)
    || profile.status === 'completed' || ['manual', 'pausing'].includes(profile.control));
  renderTables();
}

byId('filter').addEventListener('change', renderTables);
byId('mobile-qr').addEventListener('click', () => {
  const link = byId('mobile-link');
  link.href = location.origin;
  link.textContent = location.origin;
  byId('mobile-code').src = '/mobile-qr.svg';
  byId('mobile-dialog').showModal();
});
byId('mobile-close').addEventListener('click', () => byId('mobile-dialog').close());
byId('mosaic').addEventListener('click', (event) => {
  const enabled = document.body.classList.toggle('mosaic');
  event.currentTarget.textContent = enabled ? 'Voltar ao painel' : 'Ver 4 telas';
  event.currentTarget.setAttribute('aria-pressed', String(enabled));
  window.scrollTo(0, 0);
});
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
      && entry.status !== 'completed' && !['manual', 'pausing'].includes(entry.control))) {
      await command(profile.id, 'start');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    feedback(error);
  }
});
const stream = new EventSource('/api/live');
stream.onopen = () => {
  byId('live').textContent = 'Painel conectado';
  byId('live-dot').classList.add('on');
};
stream.onmessage = (event) => render(JSON.parse(event.data));
stream.onerror = () => {
  byId('live').textContent = 'Reconectando painel';
  byId('live-dot').classList.remove('on');
};
