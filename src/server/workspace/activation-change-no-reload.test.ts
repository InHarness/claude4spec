/**
 * 2.1.16 (M50 `8h2a734u`, `6z6uzzhv`) — a save on Settings → Entities rebuilds
 * the project's context WITHOUT reloading the page that saved. A Trust plugins
 * answer also rebuilds it in-process (no server restart), but keeps the M31
 * page reload: it loads/unloads the whole overlay layer, not just activation.
 *
 * The client half (the ELEMENTS tabs re-read activation in place) is pinned in
 * `src/client/components/SidebarElements.render.test.ts`. This file pins the
 * consequence of the same save on the server and back over the wire, the path
 * that used to reload the tab anyway:
 *
 *   PATCH /config { entities } → onContextConfigChanged → ProjectContextCache
 *   .invalidate → reapIdle → the retired context's dispose → WsGateway.closeRoom
 *   → `project:disposed` on every socket of the project → the SPA's
 *   `handleProjectDisposed` (`useFileWatcher`).
 *
 * The context is a stand-in whose `dispose(opts)` ends the way the real one
 * does (`gateway.closeRoom(projectId, opts?.reason)`, project-context.ts); the
 * route, the cache, the gateway, the socket and the client handler are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import express from 'express';
import request from 'supertest';
import { WebSocket } from 'ws';
import { configPath } from '../config.js';
import { configRouter } from '../routes/config.js';
import { pluginHostRouter } from '../core/plugin-host/cross-cutting.js';
import { WsGateway } from '../ws/gateway.js';
import { ProjectContextCache } from './context-cache.js';
import { handleProjectDisposed } from '../../client/lib/project-disposed.js';
import type { ProjectContext } from './project-context.js';
import type { ProjectRecord } from './types.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { ContextInvalidation, WsEvent } from '../../shared/types.js';
import type { PluginHostRouterDeps } from '../core/plugin-host/cross-cutting.js';

const PROJECT = 'proj-a';
const base = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
const adr = { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false };

let dir: string;
let server: Server;
let gateway: WsGateway;
let cache: ProjectContextCache;
/** The context the tab has been browsing — the one an invalidation retires. */
let live: ProjectContext;
let disposed: Array<ContextInvalidation | undefined>;
let sockets: WebSocket[];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-activation-'));
  const file = configPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      $schemaVersion: 4,
      name: 'demo',
      entities: ['endpoint', 'dto'],
      roots: [base, adr],
      onboardingCompleted: true,
    }),
  );
  disposed = [];
  sockets = [];

  const app = express().use(express.json());
  server = createServer(app);
  gateway = new WsGateway(server);
  cache = new ProjectContextCache(async (p) => {
    return {
      projectId: p.id,
      hasInFlightTurn: () => false,
      // The tail of the real dispose sequence (project-context.ts).
      dispose: async (opts?: ContextInvalidation) => {
        disposed.push(opts);
        gateway.closeRoom(p.id, opts?.reason);
      },
    } as unknown as ProjectContext;
  });
  const onContextConfigChanged = (opts?: ContextInvalidation) => cache.invalidate(PROJECT, opts);
  app.use(
    configRouter({
      cwd: dir,
      skillRegistry: { isSelectable: () => true, unselectableReason: () => '' } as unknown as SkillRegistry,
      onContextConfigChanged,
    }),
  );
  app.use(
    pluginHostRouter({
      registry: { setProjectTrust: () => {} },
      workspace: { name: 'default' },
      projectId: PROJECT,
      basePackages: [],
      overlayRecords: [],
      localPluginsPresent: true,
      trust: undefined,
      onContextConfigChanged,
    } as unknown as PluginHostRouterDeps),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  // The project's context is live — the tab has been browsing it.
  live = await cache.get({ id: PROJECT } as ProjectRecord);
});

afterEach(async () => {
  // The rebuild the invalidation started is released before the gateway closes.
  await cache.disposeAll();
  for (const s of sockets) s.terminate();
  await gateway.close();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A tab's project socket; resolves with the `project:disposed` it receives. */
async function openTab(): Promise<{ disposedEvent: Promise<Extract<WsEvent, { kind: 'project:disposed' }>> }> {
  const port = (server.address() as { port: number }).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?project=${PROJECT}`);
  sockets.push(ws);
  let resolveDisposed!: (e: Extract<WsEvent, { kind: 'project:disposed' }>) => void;
  const disposedEvent = new Promise<Extract<WsEvent, { kind: 'project:disposed' }>>((r) => (resolveDisposed = r));
  await new Promise<void>((resolve, reject) => {
    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString()) as WsEvent;
      if (event.kind === 'hello') resolve();
      if (event.kind === 'project:disposed') resolveDisposed(event);
    });
    ws.on('error', reject);
  });
  return { disposedEvent };
}

/** What the SPA does with the event (`useFileWatcher` → `handleProjectDisposed`). */
function spaAnswer(event: Extract<WsEvent, { kind: 'project:disposed' }>) {
  const reload = vi.fn();
  const invalidateAll = vi.fn();
  handleProjectDisposed(event, { reload, invalidateAll });
  return { reload, invalidateAll };
}

describe('an activation change rebuilds the context without reloading the page (M50 8h2a734u)', () => {
  it('[ac:ac-po-zapisie-aktywnych-typow-w-ustawien] a Settings → Entities save rebuilds the context (no server restart) and its project:disposed does not reload the saving tab', async () => {
    const savingTab = await openTab();

    const res = await request(server).patch('/config').send({ entities: ['dto'] });
    expect(res.status).toBe(200);
    expect(res.body.entities).toEqual(['dto']);

    // The same process: the old context retired and disposed, and (2.1.60, M31
    // `m31ctx001`) its successor built at once, without waiting for a request.
    expect(disposed).toEqual([{ reason: 'activation-changed' }]);
    await vi.waitFor(() => expect(cache.getLive(PROJECT)).not.toBeNull());
    expect(cache.getLive(PROJECT)).not.toBe(live);

    // The room still hears that its context is gone — and why.
    const event = await savingTab.disposedEvent;
    expect(event).toEqual({ kind: 'project:disposed', reason: 'activation-changed' });

    // The SPA keeps the page (the ELEMENTS tabs were re-read in place by
    // `afterSave`); it only refetches its queries against the rebuilt context.
    const { reload, invalidateAll } = spaAnswer(event);
    expect(reload).not.toHaveBeenCalled();
    expect(invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('a Trust plugins answer rebuilds the context in-process (no server restart) and keeps the M31 reload — the overlay layer changed, not just activation', async () => {
    const tab = await openTab();

    await request(server).post('/trust-plugins').send({ trust: true }).expect(200);

    // Same process: the old context retired and disposed, and rebuilt at once.
    expect(disposed).toEqual([undefined]);
    await vi.waitFor(() => expect(cache.getLive(PROJECT)).not.toBeNull());
    expect(cache.getLive(PROJECT)).not.toBe(live);
    // Not presented as an activation-only change on the wire.
    const event = await tab.disposedEvent;
    expect(event).toEqual({ kind: 'project:disposed' });
    const { reload, invalidateAll } = spaAnswer(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(invalidateAll).not.toHaveBeenCalled();
  });

  it('a save of another context-rebuild field keeps the M31 reload contract', async () => {
    const tab = await openTab();

    // `entities` together with a different rebuilding field is not an activation-only save.
    await request(server)
      .patch('/config')
      .send({ entities: ['dto'], roots: [base, adr] })
      .expect(200);

    const event = await tab.disposedEvent;
    expect(event).toEqual({ kind: 'project:disposed' });
    expect(disposed).toEqual([undefined]);
    expect(spaAnswer(event).reload).toHaveBeenCalledTimes(1);
  });
});
