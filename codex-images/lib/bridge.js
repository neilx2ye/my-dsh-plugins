/**
 * Local HTTP CONNECT bridge for a SOCKS proxy.
 *
 * Codex's HTTP client does not complete plain HTTPS requests through a SOCKS
 * proxy even though its WebSocket client does. This bridge gives Codex an HTTP
 * proxy on loopback and forwards each CONNECT through the configured SOCKS5
 * proxy, which is the form Codex handles reliably.
 */

import http from 'node:http';
import net from 'node:net';

/** One loopback HTTP proxy forwarding through a SOCKS5 endpoint. */
export class SocksHttpBridge {
  /**
   * @param socksUrl - normalized `socks5://` or `socks5h://` URL.
   */
  constructor(socksUrl) {
    this.socksUrl = socksUrl;
    const url = new URL(socksUrl);
    this.socksHost = url.hostname;
    this.socksPort = Number(url.port === '' ? (url.protocol === 'socks5h:' ? 1080 : 1080) : url.port);
    this.username = decodeURIComponent(url.username);
    this.password = decodeURIComponent(url.password);
    this.server = undefined;
    this.url = '';
    this.sockets = new Set();
  }

  /** Start the bridge on a free loopback port. */
  async start() {
    if (this.server !== undefined) return this.url;
    const server = http.createServer((request, response) => {
      response.writeHead(405, { 'content-type': 'text/plain' });
      response.end('CONNECT only');
    });
    server.on('connect', (request, client, head) => this.onConnect(request, client, head));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    this.server = server;
    const address = server.address();
    const port = address !== null && typeof address === 'object' ? address.port : 0;
    this.url = `http://127.0.0.1:${port}`;
    return this.url;
  }

  /** Close the listener and all active tunnels. */
  stop() {
    if (this.server !== undefined) {
      try {
        this.server.close();
      } catch {}
      this.server = undefined;
    }
    for (const socket of this.sockets) {
      try {
        socket.destroy();
      } catch {}
    }
    this.sockets.clear();
    this.url = '';
  }

  /**
   * Handle one CONNECT request.
   * @param request - HTTP CONNECT request.
   * @param client - browser-side socket.
   * @param head - bytes already read past the request.
   */
  onConnect(request, client, head) {
    this.sockets.add(client);
    client.on('close', () => this.sockets.delete(client));
    const match = String(request.url).match(/^\[([^\]]+)\]:(\d+)$/) ?? String(request.url).match(/^([^:]+):(\d+)$/);
    if (match === null) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const host = match[1];
    const port = Number(match[2]);
    void this.connectThroughSocks(host, port)
      .then((upstream) => {
        this.sockets.add(upstream);
        upstream.on('close', () => this.sockets.delete(upstream));
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head !== undefined && head.length > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
        const close = () => {
          upstream.destroy();
          client.destroy();
        };
        upstream.on('error', close);
        client.on('error', close);
        upstream.on('close', () => client.destroy());
        client.on('close', () => upstream.destroy());
      })
      .catch(() => {
        try {
          client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        } catch {}
      });
  }

  /**
   * Open a TCP connection to the target through the SOCKS5 proxy.
   * @param host - target hostname.
   * @param port - target port.
   * @returns the connected upstream socket.
   */
  connectThroughSocks(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socksPort, this.socksHost);
      let buffer = Buffer.alloc(0);
      let stage = 0;
      const fail = (error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('connect', () => {
        if (this.username !== '' || this.password !== '') socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
        else socket.write(Buffer.from([0x05, 0x01, 0x00]));
      });
      socket.on('error', fail);
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 0) {
          if (buffer.length < 2) return;
          if (buffer[0] !== 0x05) return fail(new Error('not a SOCKS5 proxy'));
          const method = buffer[1];
          if (method === 0xff) return fail(new Error('SOCKS proxy rejected authentication methods'));
          buffer = buffer.subarray(2);
          if (method === 0x02) {
            const user = Buffer.from(this.username);
            const pass = Buffer.from(this.password);
            socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
            stage = 1;
          } else {
            stage = 2;
          }
        }
        if (stage === 1) {
          if (buffer.length < 2) return;
          if (buffer[1] !== 0x00) return fail(new Error('SOCKS authentication failed'));
          buffer = buffer.subarray(2);
          stage = 2;
        }
        if (stage === 2) {
          const name = Buffer.from(host);
          socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, Buffer.from([port >> 8, port & 0xff])]));
          stage = 3;
        }
        if (stage === 3) {
          if (buffer.length < 4) return;
          if (buffer[0] !== 0x05) return fail(new Error('bad SOCKS reply'));
          const reply = buffer[1];
          const atyp = buffer[3];
          let needed;
          if (atyp === 1) needed = 10;
          else if (atyp === 3) {
            if (buffer.length < 5) return;
            needed = 7 + buffer[4];
          } else if (atyp === 4) needed = 22;
          else return fail(new Error('unknown SOCKS address type'));
          if (buffer.length < needed) return;
          if (reply !== 0) return fail(new Error(`SOCKS connect failed (${reply})`));
          socket.removeListener('data', onData);
          socket.removeListener('error', fail);
          resolve(socket);
        }
      };
      socket.on('data', onData);
    });
  }
}

/**
 * Test whether a proxy URL uses a SOCKS scheme.
 * @param proxy - normalized proxy URL.
 * @returns whether the bridge is needed.
 */
export function isSocksProxy(proxy) {
  return /^socks5h?:\/\//i.test(proxy);
}