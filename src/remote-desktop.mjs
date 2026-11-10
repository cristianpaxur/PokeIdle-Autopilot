import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { createWebSocketStream, WebSocketServer } from 'ws';

export function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export class RemoteDesktop {
  leases = new Map();
  connections = new Set();
  server = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 65_536 });

  constructor(port = (id, manual) => (manual ? 5920 : 5910) + id) {
    this.port = port;
    this.heartbeat = setInterval(() => {
      for (const connection of this.connections) connection.ping();
    }, 20_000).unref();
  }

  state(id) {
    return this.leases.get(id)?.state ?? 'automatic';
  }

  async take(id, pause) {
    if (this.leases.has(id)) throw Object.assign(new Error('O perfil já está em controle manual.'), { status: 409 });
    const lease = { state: 'pausing', token: null, connection: null };
    this.leases.set(id, lease);
    try {
      await pause();
      lease.token = randomUUID();
      lease.state = 'manual';
      return lease.token;
    } catch (error) {
      this.leases.delete(id);
      throw error;
    }
  }

  release(id) {
    const lease = this.leases.get(id);
    this.leases.delete(id);
    lease?.connection?.close();
  }

  upgrade(request, socket, head) {
    const [path, query] = request.url.split('?');
    const route = path.match(/^\/api\/profiles\/([1-4])\/screen$/);
    if (!route) return rejectUpgrade(socket, 404, 'Not Found');
    const id = Number(route[1]);
    const token = new URLSearchParams(query).get('control');
    const manual = token !== null;
    const lease = this.leases.get(id);
    if (manual && (lease?.state !== 'manual' || lease.token !== token)) return rejectUpgrade(socket, 403, 'Forbidden');
    if (manual && lease.connection) return rejectUpgrade(socket, 409, 'Conflict');
    socket.setNoDelay(true);
    this.server.handleUpgrade(request, socket, head, (webSocket) => {
      const tcp = connect({ host: '127.0.0.1', port: this.port(id, manual), noDelay: true });
      const stream = createWebSocketStream(webSocket);
      let alive = true;
      webSocket.on('pong', () => { alive = true; });
      const connection = {
        ping: () => {
          if (!alive) return connection.close();
          alive = false;
          webSocket.ping();
        },
        close: () => {
          if (!this.connections.delete(connection)) return;
          if (manual && lease.connection === connection) lease.connection = null;
          tcp.destroy();
          webSocket.terminate();
        },
      };
      this.connections.add(connection);
      if (manual) lease.connection = connection;
      for (const endpoint of [tcp, stream]) {
        endpoint.once('error', connection.close);
        endpoint.once('close', connection.close);
      }
      tcp.pipe(stream).pipe(tcp);
    });
  }

  close() {
    clearInterval(this.heartbeat);
    for (const connection of this.connections) connection.close();
    this.leases.clear();
    this.server.close();
  }
}
