import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { WsEvent } from '../../../src/shared/types.js';
import { createPluginTestApp, type PluginTestApp } from '../../helpers/plugin-test-setup.js';

/**
 * 2.1.49 (M17 m17ui001, `m17-requires-m49`) — open tabs learn about a new or an
 * edited release through the local server's events (M49). The event that
 * refreshes the release list (`['releases']`) is the base
 * `file:changed { rootId: 'releases' }`; `release:created` / `release:updated`
 * reach only the release diff. A release file written by the app itself runs no
 * chain and its watcher event is suppressed, so the release file store
 * announces the write — proven here on a real project context, through the
 * same room the open tabs listen on.
 */

type FileChanged = Extract<WsEvent, { kind: 'file:changed' }>;

const releaseFileEvents = (events: WsEvent[]): Array<Pick<FileChanged, 'event' | 'path' | 'origin'>> =>
  events
    .filter((e): e is FileChanged => e.kind === 'file:changed' && e.rootId === 'releases')
    .map(({ event, path, origin }) => ({ event, path, origin }));

describe('release writes reach open tabs as file:changed in the releases root (M17 m17ui001, M49)', () => {
  let t: PluginTestApp | null = null;

  afterEach(async () => {
    await t?.cleanup();
    t = null;
  });

  it('[section:m17ui001] creating a release over REST broadcasts file:changed { rootId: releases, event: change } for its file, by the time the response arrives', async () => {
    t = await createPluginTestApp([]);
    t.broadcasts.length = 0;

    const res = await request(t.app).post(`${t.baseUrl}/releases`).send({ name: 'alpha', description: 'First cut' });
    expect(res.status).toBe(201);

    expect(t.broadcasts).toContainEqual({ kind: 'release:created', releaseId: res.body.id, name: 'alpha' });
    expect(releaseFileEvents(t.broadcasts)).toContainEqual({ event: 'change', path: 'alpha.json', origin: 'server' });
  });

  it('[section:m17ui001] editing a release broadcasts file:changed in the releases root — change for a description edit, unlink + change for a rename', async () => {
    t = await createPluginTestApp([]);
    const created = await request(t.app).post(`${t.baseUrl}/releases`).send({ name: 'alpha', description: 'First cut' });
    expect(created.status).toBe(201);

    t.broadcasts.length = 0;
    const edited = await request(t.app).patch(`${t.baseUrl}/releases/alpha`).send({ description: 'Second wording' });
    expect(edited.status).toBe(200);
    expect(releaseFileEvents(t.broadcasts)).toContainEqual({ event: 'change', path: 'alpha.json', origin: 'server' });

    t.broadcasts.length = 0;
    const renamed = await request(t.app).patch(`${t.baseUrl}/releases/alpha`).send({ name: 'beta' });
    expect(renamed.status).toBe(200);
    const events = releaseFileEvents(t.broadcasts);
    expect(events).toContainEqual({ event: 'unlink', path: 'alpha.json', origin: 'server' });
    expect(events).toContainEqual({ event: 'change', path: 'beta.json', origin: 'server' });
  });
});
