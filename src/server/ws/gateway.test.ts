import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WsGateway } from './gateway.js';

/**
 * The upgrade handler resolves the project as a TRANSPORT ADDRESS, the same way
 * `/api/projects/:id` does.
 *
 * It used to accept any non-empty string and open a room for it, which made one
 * key mean two different things on two transports: a project HTTP answered
 * `404 PROJECT_NOT_IN_WORKSPACE` for was served here without a murmur. That was
 * harmless only because rooms are written to exclusively by services that
 * already hold a context — an accident of who emits, not the check that was
 * missing.
 */
describe('WsGateway upgrade — project membership', () => {
  let server: Server | null = null;
  let gateway: WsGateway | null = null;

  afterEach(async () => {
    await gateway?.close();
    gateway = null;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  /** Raw upgrade attempt; resolves with the status line the server wrote back. */
  const upgrade = async (query: string): Promise<{ status: number; opened: boolean }> => {
    const port = (server!.address() as { port: number }).port;
    const net = await import('node:net');
    return await new Promise((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write(
          `GET /ws${query} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n` +
            'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n')) {
          const status = Number(buf.split(' ')[1]);
          sock.destroy();
          resolve({ status, opened: status === 101 });
        }
      });
      sock.on('error', reject);
      sock.setTimeout(4000, () => {
        sock.destroy();
        reject(new Error('upgrade timed out'));
      });
    });
  };

  const start = async (isRegistered?: (id: string) => boolean): Promise<void> => {
    server = createServer();
    gateway = new WsGateway(server, isRegistered);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
  };

  it('refuses a project the workspace does not know, instead of minting a room for it', async () => {
    await start((id) => id === 'known-1');
    // 404, not 400: the request is well-formed and the project simply is not
    // here — the distinction PROJECT_NOT_IN_WORKSPACE draws on the HTTP side.
    expect((await upgrade('?project=ghost')).status).toBe(404);
  });

  it('still admits a project the workspace does know', async () => {
    await start((id) => id === 'known-1');
    expect((await upgrade('?project=known-1')).opened).toBe(true);
  });

  it('keeps refusing a missing param with 400 — a different failure, a different code', async () => {
    await start((id) => id === 'known-1');
    expect((await upgrade('')).status).toBe(400);
  });

  it('re-reads membership per upgrade, so a project added at runtime connects without a restart', async () => {
    const registered = new Set<string>();
    await start((id) => registered.has(id));
    expect((await upgrade('?project=later')).status).toBe(404);
    registered.add('later');
    expect((await upgrade('?project=later')).opened).toBe(true);
  });

  /**
   * The real predicate reads the workspace registry, which throws rather than
   * answering false when that file cannot be read. Nothing catches a throw out
   * of an `upgrade` listener, and the server installs no `uncaughtException`
   * handler — so before the guard, a hand-edited registry plus the client's
   * reconnect loop was a way to kill the process from the browser.
   */
  it('rejects instead of crashing when the membership check throws', async () => {
    await start(() => {
      throw new Error('workspaces.json: invalid JSON');
    });

    // Fails closed: unestablished membership is not membership.
    await expect(upgrade('?project=whatever')).resolves.toMatchObject({
      status: 404,
      opened: false,
    });
  });

  it('stays up for the next upgrade after a throwing check', async () => {
    let broken = true;
    await start((id) => {
      if (broken) throw new Error('registry temporarily unreadable');
      return id === 'known';
    });

    await upgrade('?project=known');
    broken = false;

    // A transient read failure must not be terminal — the next upgrade, once
    // the registry is readable again, is served normally.
    await expect(upgrade('?project=known')).resolves.toMatchObject({ status: 101 });
  });
});
