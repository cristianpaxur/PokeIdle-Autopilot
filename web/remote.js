let client;

export class RemoteScreen {
  constructor(element, id, token) {
    this.element = element;
    this.id = id;
    this.token = token;
    this.placeholder = element.querySelector('small');
    this.target = document.createElement('div');
    this.target.className = 'remote-frame';
    this.target.hidden = true;
    element.append(this.target);
    this.retryDelay = 500;
    void this.connect();
  }

  async connect() {
    try {
      client ??= import('/novnc/core/rfb.js');
      const { default: RFB } = await client;
      if (this.closed) return;
      const url = new URL(`/api/profiles/${this.id}/screen`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (this.token) url.searchParams.set('control', this.token);
      const session = new RFB(this.target, url.href);
      this.session = session;
      session.viewOnly = !this.token;
      session.scaleViewport = true;
      session.qualityLevel = this.token ? 7 : 5;
      session.compressionLevel = 1;
      session.addEventListener('connect', () => {
        this.retryDelay = 500;
        this.target.hidden = false;
        this.placeholder.hidden = true;
        this.element.dataset.connected = 'true';
        if (this.token) session.focus();
      });
      session.addEventListener('disconnect', () => {
        if (this.closed) return;
        this.target.hidden = true;
        this.placeholder.hidden = false;
        this.placeholder.textContent = 'Reconectando transmissão…';
        delete this.element.dataset.connected;
        this.retry = setTimeout(() => this.connect(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 5000);
      });
    } catch {
      if (!this.closed) this.placeholder.textContent = 'Transmissão indisponível. Recarregue o painel.';
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.session?.disconnect();
    this.target.remove();
    delete this.element.dataset.connected;
    this.placeholder.hidden = false;
  }
}
