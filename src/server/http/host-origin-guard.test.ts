import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import net from 'node:net';
import { createServer, type Server } from 'node:http';
import { checkRequest, hostOriginGuard, isAllowedHost, isAllowedOrigin } from './host-origin-guard.js';
import { WsGateway } from '../ws/gateway.js';

/**
 * 2.1.0 (M49) — the server still authenticates nobody; these two barriers keep
 * a BROWSER from being turned against it (DNS rebinding, cross-site writes).
 */
const LOCAL = { defaultPort: 4500 };
const PUBLIC = { defaultPort: 4500, publicUrl: 'https://c4s.firma.dev' };

describe('isAllowedHost — allowlist = publicUrl host + loopback names', () => {
  it('admits loopback names on any port, and the publicUrl host', () => {
    for (const h of ['localhost:4500', 'localhost', '127.0.0.1:9', '[::1]:4500', '127.0.0.2']) {
      expect(isAllowedHost(h, LOCAL), h).toBe(true);
    }
    expect(isAllowedHost('c4s.firma.dev', PUBLIC)).toBe(true);
    expect(isAllowedHost('C4S.firma.dev:443', PUBLIC)).toBe(true);
  });

  it('refuses any other host (DNS rebinding) and a missing Host', () => {
    expect(isAllowedHost('evil.example', LOCAL)).toBe(false);
    expect(isAllowedHost('c4s.firma.dev', LOCAL)).toBe(false);
    expect(isAllowedHost('192.168.1.10:4500', PUBLIC)).toBe(false);
    expect(isAllowedHost(undefined, LOCAL)).toBe(false);
  });
});

describe('isAllowedOrigin — publicUrl origin + loopback origins', () => {
  it('no Origin (CLI, curl, MCP client) is not a cross-site browser request', () => {
    expect(isAllowedOrigin(undefined, PUBLIC)).toBe(true);
  });

  it('admits the publicUrl origin and loopback origins', () => {
    expect(isAllowedOrigin('https://c4s.firma.dev', PUBLIC)).toBe(true);
    expect(isAllowedOrigin('http://localhost:4500', PUBLIC)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173', LOCAL)).toBe(true);
  });

  it('refuses a foreign origin, a scheme mismatch on publicUrl and the opaque `null`', () => {
    expect(isAllowedOrigin('https://evil.example', PUBLIC)).toBe(false);
    expect(isAllowedOrigin('http://c4s.firma.dev', PUBLIC)).toBe(false);
    expect(isAllowedOrigin('null', PUBLIC)).toBe(false);
  });
});

describe('hostOriginGuard (Express) — runs before every route', () => {
  function app(ws = PUBLIC) {
    const writes: string[] = [];
    const a = express();
    a.use(hostOriginGuard(() => ws));
    a.use(express.json());
    a.get('/api/projects/:id/config', (req, res) => res.json({ id: req.params.id }));
    a.post('/api/projects/:id/pages', (req, res) => {
      writes.push(req.params.id);
      res.status(201).json({ ok: true });
    });
    return { a, writes };
  }

  it('refuses a foreign Host before the route (and before the project key is read)', async () => {
    const { a } = app();
    const res = await request(a).get('/api/projects/app-spec/config').set('Host', 'evil.example').expect(403);
    expect(res.body.error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('refuses a mutation from a foreign Origin, and nothing is written', async () => {
    const { a, writes } = app();
    const res = await request(a)
      .post('/api/projects/app-spec/pages')
      .set('Host', 'c4s.firma.dev')
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(writes).toEqual([]);
  });

  it('lets reads through regardless of Origin, and same-origin / Origin-less writes through', async () => {
    const { a, writes } = app();
    await request(a)
      .get('/api/projects/app-spec/config')
      .set('Host', 'c4s.firma.dev')
      .set('Origin', 'https://evil.example')
      .expect(200);
    await request(a)
      .post('/api/projects/app-spec/pages')
      .set('Host', 'c4s.firma.dev')
      .set('Origin', 'https://c4s.firma.dev')
      .send({})
      .expect(201);
    await request(a).post('/api/projects/app-spec/pages').set('Host', 'localhost:4500').send({}).expect(201);
    expect(writes).toEqual(['app-spec', 'app-spec']);
  });
});

describe('WS upgrade — the same barriers, and a refused upgrade joins no room', () => {
  let server: Server | null = null;
  let gateway: WsGateway | null = null;

  afterEach(async () => {
    await gateway?.close();
    gateway = null;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  async function start(): Promise<number> {
    server = createServer();
    gateway = new WsGateway(server, () => true, (req) => checkRequest(req, PUBLIC, { checkOrigin: true }));
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    return (server.address() as { port: number }).port;
  }

  /** Raw upgrade; resolves with the status line and whether a `hello` frame arrived. */
  function upgrade(port: number, headers: Record<string, string>): Promise<{ status: number; hello: boolean }> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        const extra = Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join('');
        sock.write(
          `GET /ws?project=app-spec HTTP/1.1\r\n${extra}Upgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      let buf = Buffer.alloc(0);
      const finish = () => {
        const text = buf.toString('latin1');
        sock.destroy();
        resolve({ status: Number(text.split(' ')[1]), hello: text.includes('"hello"') });
      };
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const text = buf.toString('latin1');
        if (!text.includes('\r\n\r\n')) return;
        if (!text.startsWith('HTTP/1.1 101') || text.includes('"hello"')) finish();
      });
      sock.on('error', reject);
      sock.setTimeout(4000, () => {
        sock.destroy();
        reject(new Error('upgrade timed out'));
      });
    });
  }

  it('refuses an upgrade with a foreign Host (403) — no hello, no room', async () => {
    const port = await start();
    const res = await upgrade(port, { Host: 'evil.example' });
    expect(res).toEqual({ status: 403, hello: false });
  });

  it('refuses an upgrade from a foreign Origin (403)', async () => {
    const port = await start();
    const res = await upgrade(port, { Host: 'c4s.firma.dev', Origin: 'https://evil.example' });
    expect(res).toEqual({ status: 403, hello: false });
  });

  it('admits the publicUrl origin', async () => {
    const port = await start();
    const res = await upgrade(port, { Host: 'c4s.firma.dev', Origin: 'https://c4s.firma.dev' });
    expect(res).toEqual({ status: 101, hello: true });
  });
});
