const preferenceKey = 'idlebot.sound.enabled';

// Original, short square-wave UI sounds. No samples, downloads or autoplay.
export function playClick(context, kind = 'click') {
  const notes = kind === 'confirm' ? [1046.5, 1568] : [783.99, 1046.5];
  const start = context.currentTime;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(notes[0], start);
  oscillator.frequency.setValueAtTime(notes[1], start + .028);
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(.035, start + .004);
  envelope.gain.setValueAtTime(.035, start + .032);
  envelope.gain.exponentialRampToValueAtTime(.0001, start + .085);
  envelope.gain.setValueAtTime(0, start + .09);
  oscillator.connect(envelope);
  envelope.connect(context.destination);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  oscillator.start(start);
  oscillator.stop(start + .095);
}

function initializeSound() {
  const button = document.querySelector('[data-sound-toggle]');
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  if (!button || !Audio) return;
  let enabled = true;
  let context;
  let lastPlayed = -Infinity;
  try { enabled = localStorage.getItem(preferenceKey) !== 'false'; } catch { /* Storage can be blocked. */ }

  const render = () => {
    button.hidden = false;
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? 'Silenciar sons de 8 bits' : 'Ativar sons de 8 bits';
    button.querySelector('[data-sound-label]').textContent = enabled ? 'Som ligado' : 'Sem som';
  };
  const play = (kind) => {
    if (!enabled || document.hidden || performance.now() - lastPlayed < 45) return;
    lastPlayed = performance.now();
    try {
      context ??= new Audio();
      if (context.state === 'running') playClick(context, kind);
      else void context.resume().then(() => {
        if (enabled && !document.hidden && context.state === 'running') playClick(context, kind);
      }).catch(() => {});
    } catch { /* Audio must never interrupt a game control. */ }
  };

  // Capture runs before action handlers temporarily disable their buttons.
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const control = event.target.closest('button, a[href], summary, input[type="checkbox"]');
    if (!control || control.matches(':disabled, [aria-disabled="true"]') || control.closest('[inert]')) return;
    if (control === button) {
      enabled = !enabled;
      try { localStorage.setItem(preferenceKey, String(enabled)); } catch { /* Keep the session preference. */ }
      render();
      if (enabled) play('confirm');
      return;
    }
    play(control.matches('.primary') ? 'confirm' : 'click');
  }, { capture: true });
  document.addEventListener('change', (event) => {
    if (event.isTrusted && event.target instanceof HTMLSelectElement && !event.target.disabled) play('click');
  }, { capture: true });
  window.addEventListener('storage', (event) => {
    if (event.key === preferenceKey || event.key === null) {
      enabled = event.newValue !== 'false';
      render();
    }
  });
  render();
}

initializeSound();
