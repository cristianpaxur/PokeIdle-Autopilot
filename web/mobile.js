import { RemoteScreen } from './remote.js';

const byId = (id) => document.getElementById(id);
const status = byId('monitor-status');
const showScreens = byId('monitor-screens');
const cards = new Map();
const labels = {
  offline: 'Fechado', opening: 'Abrindo', login: 'Login', 'native-login': 'Login no PC', ready: 'Conectado',
  hunting: 'Caçando', waiting: 'Aguardando', paused: 'Pausado', completed: 'Meta atingida',
  blocked: 'Atenção', setup: 'Configuração', reconnecting: 'Reconectando', warning: 'Atenção',
};
let pairing = location.hash.slice(1);
let profiles = [];
let watching = false;

function render() {
  showScreens.hidden = !profiles.some(({ screen }) => screen);
  for (const profile of profiles) {
    if (!cards.has(profile.id)) {
      const card = byId('monitor-profile').content.firstElementChild.cloneNode(true);
      card.querySelector('h3').textContent = `Perfil ${String(profile.id).padStart(2, '0')}`;
      byId('monitor-profiles').append(card);
      cards.set(profile.id, { card });
    }
    const entry = cards.get(profile.id);
    const badge = entry.card.querySelector('.status');
    badge.textContent = labels[profile.status] ?? 'Aguardando';
    badge.className = `status ${profile.status}`;
    entry.card.querySelector('.monitor-sales').textContent = `${profile.mission.sold}/${profile.mission.target} vendidos`;
    entry.card.querySelector('.profile-stat').textContent = `${profile.mission.open} em andamento · ${profile.captures} capturas`
      + (profile.hunt ? ` · ${profile.hunt.replaceAll('-', ' ')}` : '');
    const view = entry.card.querySelector('.view');
    view.hidden = !watching || !profile.screen;
    if (!view.hidden && !entry.screen) entry.screen = new RemoteScreen(view, profile.id);
    if (view.hidden && entry.screen) {
      entry.screen.close();
      entry.screen = null;
    }
  }
}

showScreens.addEventListener('click', () => {
  watching = !watching;
  showScreens.textContent = watching ? 'Ocultar telas' : 'Ver telas ao vivo';
  showScreens.setAttribute('aria-pressed', String(watching));
  render();
});

async function refresh() {
  try {
    const response = await fetch('/api/state', {
      headers: pairing ? { Authorization: `Bearer ${pairing}` } : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) {
      status.textContent = 'Escaneie o QR atual no painel do PC para entrar.';
      return;
    }
    if (!response.ok) throw new Error('Painel indisponível');
    ({ profiles } = await response.json());
    if (pairing) {
      history.replaceState(null, '', '/');
      pairing = '';
    }
    status.textContent = 'Conectado · modo de visualização';
    render();
  } catch {
    status.textContent = 'Reconectando ao painel…';
  }
  setTimeout(refresh, 5000);
}

void refresh();
