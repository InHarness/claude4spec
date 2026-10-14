/**
 * 2.1.22 — M49 `l4wsroom` / M40 `kc23agex` / M33/L7 `m33l7pln` step 5.
 *
 * An event of a `scope: 'process'` mount (the base plugin pool) has no source
 * project: the gateway sends it to EVERY room it holds, each project's room
 * separately. An event of a `context:<id>` mount still reaches only the room of
 * that context's project. Wired exactly as `startServer` wires it: a real
 * `WsGateway` on a real HTTP server, real `ws` clients, and the process-wide
 * `FileWatchRuntime` with `createRoomBroadcaster(gateway)`.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { WsGateway } from './gateway.js';
import { createRoomBroadcaster } from './watch-broadcaster.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import type { WsEvent } from '../../shared/types.js';

interface Client {
  ws: WebSocket;
  received: WsEvent[];
}

describe('M40 → M49 — process-mount events fan out to every project room', () => {
  let server: Server | null = null;
  let gateway: WsGateway | null = null;
  let runtime: FileWatchRuntime | null = null;
  const clients: Client[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.terminate();
    await runtime?.close();
    runtime = null;
    await gateway?.close();
    gateway = null;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  const start = async (): Promise<void> => {
    server = createServer();
    gateway = new WsGateway(server, () => true);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    runtime = new FileWatchRuntime({ fsEvents: false, broadcaster: createRoomBroadcaster(gateway) });
  };

  /** Connect to `/ws?project=<id>` and resolve once the gateway's `hello` arrived (room joined). */
  const connect = async (projectId: string): Promise<Client> => {
    const port = (server!.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?project=${encodeURIComponent(projectId)}`);
    const client: Client = { ws, received: [] };
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      ws.on('message', (raw) => {
        const ev = JSON.parse(String(raw)) as WsEvent;
        if (ev.kind === 'hello') resolve();
        else client.received.push(ev);
      });
      ws.on('error', reject);
    });
    return client;
  };

  /** Let in-flight frames land: a ping/pong round-trip per socket orders after every earlier send. */
  const settle = async (): Promise<void> => {
    await Promise.all(
      clients.filter((c) => c.ws.readyState === WebSocket.OPEN).map(
        (c) =>
          new Promise<void>((resolve) => {
            c.ws.once('pong', () => resolve());
            c.ws.ping();
          }),
      ),
    );
  };

  const reloaded = (name: string, tier: 'base' | 'overlay'): WsEvent => ({
    kind: 'plugin:reloaded',
    name,
    version: '2.0.0',
    tier,
  });

  it('[ac:ac-zdarzenie-mountu-procesowego-kazdy-room] an event from a process-scope mount reaches the room of every project, each separately', async () => {
    await start();
    // Two tabs on project A, one on B, one on C — three rooms in the gateway map.
    const a1 = await connect('proj-a');
    const a2 = await connect('proj-a');
    const b = await connect('proj-b');
    const c = await connect('proj-c');
    expect(gateway!.roomIds().sort()).toEqual(['proj-a', 'proj-b', 'proj-c']);

    // The base pool rebuild, routed through the M40 mechanism by the mount's scope.
    runtime!.broadcast('process', reloaded('@acme/base-plugin', 'base'));
    await settle();

    // Every socket of every room got it, exactly once (each room separately — no
    // socket is reached twice, none is skipped).
    for (const client of [a1, a2, b, c]) {
      expect(client.received).toEqual([reloaded('@acme/base-plugin', 'base')]);
    }
  });

  it('[ac:ac-zdarzenie-mountu-procesowego-kazdy-room] an event from a context-scope mount still reaches only the room of its own project', async () => {
    await start();
    const a = await connect('proj-a');
    const b = await connect('proj-b');

    // `context:<projectId>#<instance>` — the overlay of project A.
    runtime!.broadcast('context:proj-a#1', reloaded('my-overlay', 'overlay'));
    await settle();

    expect(a.received).toEqual([reloaded('my-overlay', 'overlay')]);
    expect(b.received).toEqual([]);
  });

  it('[ac:ac-zdarzenie-mountu-procesowego-kazdy-room] a process event is addressed per room — a room that closed is not written to, a room that opened later is', async () => {
    await start();
    const a = await connect('proj-a');
    const b = await connect('proj-b');
    b.ws.close();
    await new Promise<void>((r) => b.ws.once('close', () => r()));
    // Wait until the gateway dropped B's empty room.
    const deadline = Date.now() + 2000;
    while (gateway!.roomIds().includes('proj-b') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(gateway!.roomIds()).toEqual(['proj-a']);
    const d = await connect('proj-d');

    runtime!.broadcast('process', reloaded('@acme/base-plugin', 'base'));
    await settle();

    expect(a.received).toEqual([reloaded('@acme/base-plugin', 'base')]);
    expect(d.received).toEqual([reloaded('@acme/base-plugin', 'base')]);
    expect(b.received).toEqual([]);
  });
});
