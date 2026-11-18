/**
 * Optional read-only public image server.
 *
 * Images stay in their project directories; this server exposes them through
 * unguessable token URLs so another system can fetch them over the network.
 * It never accepts writes and never lists directories.
 */

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { isImageName, mediaTypeOf, normalizeRel } from './project.js';

/** One token-scoped public image endpoint. */
export class PublicImageServer {
  /**
   * @param options.port - TCP port to bind.
   * @param options.bind - bind address, normally 0.0.0.0.
   * @param options.tokens - token -> project mapping.
   */
  constructor(options) {
    this.port = options.port;
    this.bind = options.bind;
    this.tokens = options.tokens;
    this.server = undefined;
  }

  /** Start listening. */
  async start() {
    if (this.server !== undefined) return this.port;
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.bind, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    this.server = server;
    return this.port;
  }

  /** Stop listening. */
  stop() {
    if (this.server === undefined) return;
    try {
      this.server.close();
    } catch {}
    this.server = undefined;
  }

  /**
   * Answer one public request.
   * @param request - incoming request.
   * @param response - outgoing response.
   */
  async handle(request, response) {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'x-content-type-options': 'nosniff',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...headers, 'content-type': 'text/plain' });
      response.end('method not allowed');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = /^\/cdn\/([a-f0-9]{16,64})\/(.+)$/.exec(url.pathname);
    if (match === null) {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    const target = this.tokens.get(match[1]);
    if (target === undefined) {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    let relative;
    try {
      relative = decodeURIComponent(match[2]);
    } catch {
      response.writeHead(400, headers);
      response.end();
      return;
    }
    if (relative.startsWith('.references/')) {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    let normalized;
    try {
      normalized = normalizeRel(relative);
    } catch {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    let absolute = path.resolve(target.cwd, normalized);
    const prefix = `${target.dir}${path.sep}`;
    if (!absolute.startsWith(prefix)) {
      absolute = path.resolve(target.dir, normalized);
    }
    if (!absolute.startsWith(prefix) || !isImageName(absolute)) {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    let realDirectory;
    let realFile;
    try {
      realDirectory = await fs.realpath(target.dir);
      realFile = await fs.realpath(absolute);
    } catch {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    if (!realFile.startsWith(`${realDirectory}${path.sep}`)) {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    let data;
    try {
      data = await fs.readFile(realFile);
    } catch {
      response.writeHead(404, headers);
      response.end();
      return;
    }
    response.writeHead(200, {
      ...headers,
      'content-type': mediaTypeOf(realFile) ?? 'application/octet-stream',
      'content-length': String(data.length),
      'cache-control': 'public, max-age=300',
    });
    if (request.method === 'HEAD') response.end();
    else response.end(data);
  }
}