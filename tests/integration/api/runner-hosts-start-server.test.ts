import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHandle } from '../../../src/server/index.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { RunnerHostStore } from '../../../src/server/runner-hosts/host-records.js';
import { RunnerHostStub, until } from '../../helpers/runner-host-stub.js';

/**
 * M54 L10 `i58ogfc2` / `m9e73y05` through the REAL `startServer`: the
 * runner-host supervisor is created before listen and connects in the
 * background — listen does not wait for a host. The host is a local stub that
 * accepts the connection and never answers `GET /host`, so an attempt can only
 * end by its own 3 s timeout; the start must be serving long before that.
 *
 * The registry and `secret.key` live in a temp home (`C4S_HOME`); the server
 * listens on an ephemeral loopback port in `prod` mode (no Vite).
 */
describe('runner-host supervisor through startServer', () => {
  let home: string;
  let prevHome: string | undefined;
  let server: ServerHandle | undefined;
  let stub: RunnerHostStub;
  /** When each held `GET /host` arrived and when the master gave up on it. */
  const held: Array<{ arrivedAt: number; closedAt: number | null }> = [];
  let resolvedAt = 0;

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-start-runner-hosts-'));
    prevHome = process.env.C4S_HOME;
    const registryDir = path.join(home, 'registry');
    process.env.C4S_HOME = registryDir;

    stub = await RunnerHostStub.start();
    stub.onHost = (req: IncomingMessage) => {
      const entry = { arrivedAt: performance.now(), closedAt: null as number | null };
      held.push(entry);
      req.socket.on('close', () => {
        entry.closedAt = performance.now();
      });
    };

    const registry = new WorkspaceRegistry(registryDir);
    const created = registry.selectOrCreate({ name: 'default' });
    new RunnerHostStore(registry, created).add({ url: stub.url(), token: 'c4sr_Q1w2E3r4T5y6U7i8O9p0AsDfGhJkL' });

    const workspace = registry.openView('default');
    server = await startServer({ cwd: home, registry, workspace, port: 0, host: '127.0.0.1', mode: 'prod' });
    resolvedAt = performance.now();
  }, 120_000);

  afterAll(async () => {
    await server?.shutdown();
    await stub?.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('[ac:ac-nieosiagalny-host-nie-opoznia-startu] an unreachable host does not delay the server starting to listen', async () => {
    // The server is listening and answering…
    const res = await fetch(`http://127.0.0.1:${server!.port}/api/workspace/no-such-route`);
    expect(res.status).toBeLessThan(500);

    // …while the supervisor's attempt on the host is still without an answer:
    // it was sent (in the background), and the master had not given up on it
    // (3 s timeout) before the start resolved.
    await until(() => held.length >= 1, 10_000, 'GET /host from the supervisor');
    const first = held[0]!;
    expect(first.closedAt === null || first.closedAt > resolvedAt).toBe(true);
  }, 30_000);

  it('[section:i58ogfc2] process shutdown closes the supervisor’s connections to the host', async () => {
    await until(() => held.length >= 1, 10_000, 'GET /host from the supervisor');
    await server!.shutdown();
    server = undefined;
    await until(() => held.every((h) => h.closedAt !== null), 5_000, 'held requests closed');
  }, 30_000);
});
