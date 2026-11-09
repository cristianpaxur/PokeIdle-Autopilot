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
  hunting: 'Caçando', waiting: 'Aguardando', paused: 'Pausado',
  blocked: 'Atenção', setup: 'Configuração', reconnecting: 'Reconectando', warning: 'Atenção',
};
const cards = new Map();
let profiles = [];

async function command(id, action) {
  const result = await fetch(`/api/profiles/${id}/${action}`, {
    method: 'POST', headers: { 'X-IdleBot': '1' },
  });
  if (!result.ok) throw new Error('O comando não foi executado. Tente novamente.');
}

function feedback(error) {
  byId('feedback').textContent = error?.message ?? '';
  byId('feedback').hidden = !error;
}

function makeCard(id) {
  const card = document.createElement('article');
  card.className = 'profile';
  card.innerHTML = `<div class="profile-top"><h3></h3><span class="status"></span></div>
    <div class="view"><small>Prévia da caça</small></div>
    <div class="profile-info"><p class="profile-note"></p>
      <div class="profile-stat"><span data-stat="hunt"></span><span data-stat="balls"></span>
        <span data-stat="gems"></span><span data-stat="captures"></span></div>
      <div class="profile-controls">
        <button type="button" data-action="start">Abrir</button>
        <button type="button" data-action="pause">Pausar</button>
        <button type="button" data-action="focus">Ver jogo</button>
        <button type="button" data-action="stop">Fechar</button>
      </div>
    </div>`;
  card.querySelectorAll('[data-action]').forEach((button) => {
    button.setAttribute('aria-label', `${button.textContent}, ${profileName(id)}`);
    button.addEventListener('click', async () => {
      try {
        feedback(null);
        await command(id, button.dataset.action);
      } catch (error) {
        feedback(error);
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
  status.textContent = labels[profile.status] ?? 'Aguardando';
  status.className = `status ${profile.status}`;
  card.querySelector('.profile-note').textContent = profile.note;
  card.querySelector('[data-stat="hunt"]').textContent = profile.hunt
    ? profile.hunt.replaceAll('-', ' ') : 'Rota —';
  card.querySelector('[data-stat="balls"]').textContent = `${number(profile.balls)} bolas`;
  card.querySelector('[data-stat="gems"]').textContent = `${number(profile.gems)} Gemas`;
  card.querySelector('[data-stat="captures"]').textContent = `${number(profile.metrics.lastHour ?? 0)} capturas/h`;
  const view = card.querySelector('.view');
  const placeholder = view.querySelector('small');
  const currentImage = view.querySelector('img');
  if (profile.preview && view.dataset.version !== String(profile.preview)) {
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
  start.disabled = profile.active && !profile.paused && profile.status !== 'login';
  card.querySelector('[data-action="pause"]').disabled = !profile.active || profile.paused || profile.status === 'native-login';
  card.querySelector('[data-action="focus"]').disabled = !profile.active || ['opening', 'native-login'].includes(profile.status);
  card.querySelector('[data-action="stop"]').disabled = !profile.active;
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
  confirmed: 'Confirmado pelo jogo',
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
    ...profile.sales.map((op) => ({ ...op, label: op.name ? `Venda · ${op.name}` : 'Venda', state: 'sold', gems: op.net, profile: profile.id })),
    ...profile.withdrawals.map((op) => ({ ...op, label: 'Pedido de saque', profile: profile.id })),
    ...profile.paid.map((op) => ({ ...op, label: 'Saque pago', state: 'paid', gems: op.orbs, profile: profile.id })),
  ]).sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 30);
  byId('operations').replaceChildren(...(operations.length ? operations.map((op) => row([
    op.label, profileName(op.profile), clock(op.time), number(op.gems),
    op.state === 'paid' ? 'Pago pelo jogo' : op.state === 'sold' ? 'Venda líquida' : operationStatus[op.state] ?? '—',
  ])) : [row(['Aguardando as primeiras operações.'], true)]));
}

function render(state) {
  profiles = state.profiles;
  profiles.forEach(renderCard);
  const total = (key) => profiles.reduce((sum, profile) => sum + (profile.metrics[key] ?? 0), 0);
  byId('kpi-active').textContent = `${profiles.filter((profile) => profile.status === 'hunting').length} / 4`;
  byId('kpi-captures').textContent = number(total('captures'));
  byId('kpi-shinies').textContent = `${number(total('shinies'))} shinies`;
  byId('kpi-stock').textContent = number(total('stockGems') || null);
  byId('kpi-sold').textContent = number(total('soldGems'));
  byId('start-all').disabled = profiles.every((profile) => profile.active && !profile.paused);
  renderTables();
}

byId('filter').addEventListener('change', renderTables);
byId('start-all').addEventListener('click', async () => {
  try {
    feedback(null);
    for (const profile of profiles.filter((entry) => !entry.active || entry.paused)) {
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
