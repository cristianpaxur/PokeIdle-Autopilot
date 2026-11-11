import { RemoteScreen } from './remote.js';
import { activityConfirmed, phaseLabels, phaseStats, progressAge, renderAttention, watchScreenVisibility } from './profile-summary.js';

const byId = (id) => document.getElementById(id);
const status = byId('monitor-status');
const cards = new Map();
const period = byId('monitor-period');
const name = ({ id }) => `Perfil ${String(id).padStart(2, '0')}`;
const labels = {
  offline: 'Fechado', opening: 'Abrindo', login: 'Login', 'native-login': 'Login no PC', ready: 'Conectado',
  hunting: 'Caçando', waiting: 'Aguardando', paused: 'Pausado',
  blocked: 'Precisa de você', setup: 'Precisa de você', reconnecting: 'Reconectando',
  recovering: 'Recuperando', warning: 'Atenção',
};
let pairing = location.hash.match(/^#([\w-]{43})$/)?.[1] ?? '';
let profiles = [];
const visibility = watchScreenVisibility((id, visible) => {
  const entry = cards.get(id);
  const profile = profiles.find((current) => current.id === id);
  if (!entry || !profile) return;
  entry.visible = visible;
  renderScreen(profile, entry);
});

function render() {
  renderAttention(byId('monitor-attention'), profiles, name);
  for (const profile of profiles) {
    if (!cards.has(profile.id)) {
      const card = byId('monitor-profile').content.firstElementChild.cloneNode(true);
      card.querySelector('h3').textContent = name(profile);
      byId('monitor-profiles').append(card);
      const view = card.querySelector('.view');
      view.dataset.screenProfile = profile.id;
      cards.set(profile.id, { card, view, visible: false });
      visibility.observe(view);
    }
    const entry = cards.get(profile.id);
    const badge = entry.card.querySelector('.status');
    const starting = profile.status === 'hunting' && !activityConfirmed(profile);
    badge.textContent = starting ? 'Verificando caça' : labels[profile.status] ?? 'Aguardando';
    badge.className = `status ${starting ? 'waiting' : profile.status}`;
    const route = [phaseLabels[profile.phase], profile.hunt?.replaceAll('-', ' ')].filter(Boolean);
    entry.card.querySelector('.profile-route strong').textContent = route.join(' · ') || 'Sem rota ativa';
    entry.card.querySelector('.profile-route small').textContent = profile.active ? progressAge(profile.lastProgressAt) : '';
    const stats = phaseStats(profile, period.value);
    if (profile.phase === 'progression' && profile.level != null) stats.unshift(`Treinador Nv ${profile.level} / 150`);
    if (profile.openListings) stats.push(`${profile.openListings} em anúncio`);
    entry.card.querySelector('.phase-stats').replaceChildren(...stats.map((text) => {
      const item = document.createElement('span');
      item.textContent = text;
      return item;
    }));
    renderScreen(profile, entry);
  }
}

function renderScreen(profile, entry) {
  const { view } = entry;
  view.hidden = !profile.screen;
  const visible = profile.screen && entry.visible;
  if (visible && !entry.screen) {
    view.querySelector('small').textContent = 'Conectando transmissão…';
    entry.screen = new RemoteScreen(view, profile.id);
  } else if (!visible && entry.screen) {
    entry.screen.close();
    entry.screen = null;
  }
}

period.addEventListener('change', render);

async function refresh() {
  try {
    const response = await fetch('/api/state', {
      headers: pairing ? { Authorization: `Bearer ${pairing}` } : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) {
      status.textContent = 'Escaneie o QR atual no painel do PC para entrar.';
      for (const { card, view, screen } of cards.values()) {
        screen?.close();
        visibility.unobserve(view);
        card.remove();
      }
      cards.clear();
      profiles = [];
      render();
      return;
    }
    if (!response.ok) throw new Error('Painel indisponível');
    ({ profiles } = await response.json());
    if (pairing) {
      history.replaceState(null, '', '/');
      pairing = '';
    }
    status.textContent = 'Monitor atualizado · somente leitura';
    render();
  } catch {
    status.textContent = profiles.length ? 'Reconectando · mostrando a última atualização' : 'Reconectando ao painel…';
  }
  setTimeout(refresh, 5000);
}

void refresh();
