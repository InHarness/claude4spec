/**
 * 2.1.57 — rule 3 ("unreferenced entities") reads the structural link junction
 * (M19 `q91m4kgl` / `5tfhxy2p`, M39 `z5cl1q4o`).
 *
 * The junction is found from the declaration, so the fixture is a pair of types
 * the host has never heard of shaped like `endpoint.linkedDtos` → `endpoint_dto`:
 * a value collection with `keyFields` (its own projection table) whose item
 * carries a `ref` to the other type.
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../../tests/helpers/test-db.js';
import { applyProjection } from '../../db/projection.js';
import { createDiscoveryCore } from '../index.js';
import { RawEntityReader } from '../raw-entity-reader.js';
import { SerializationEngine } from '../../core/plugin-host/serialization-engine.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';
import type { BackendModule, ProjectPluginHost } from '../../core/plugin-host/types.js';
import type { DiscoveryCore } from '../types.js';

const TITLE = { type: 'string', required: true, maxLength: 200, default: 'Untitled' } as const;

const PAYLOAD_DATA: DataDeclaration = { schema: { title: TITLE } };

const GATEWAY_DATA: DataDeclaration = {
  schema: {
    title: TITLE,
    linkedPayloads: {
      type: 'collection',
      collection: { kind: 'value', identity: ['payload', 'relation'] },
      projectionTable: 'gateway_payload',
      keyFields: ['payload', 'relation'],
      item: {
        type: 'object',
        fields: {
          payload: { type: 'string', column: 'payload_slug', required: true, ref: 'payload' },
          relation: { type: 'enum', values: ['request', 'response'], required: true },
        },
      },
    },
  },
};

function module(type: string, data: DataDeclaration): BackendModule {
  return {
    type,
    data,
    slugPattern: [{ op: 'slugify', field: 'title' }],
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    pathPrefix: `/${type}s`,
    systemPrompt: { roleNoun: type },
  };
}

function host(modules: BackendModule[]): ProjectPluginHost {
  const byType = new Map(modules.map((m) => [m.type, m]));
  return {
    listAvailable: () => modules,
    listEntities: () => modules,
    listCommands: () => [],
    listSubagents: () => [],
    getEntity: (t: string) => byType.get(t) ?? null,
    getAvailable: (t: string) => byType.get(t) ?? null,
    isActive: (t: string) => byType.has(t),
    partition: () => ({ active: [...byType.keys()], inactive: [], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
    entityExists: () => false,
    registerEntityService: () => {},
    getEntityService: () => null,
    snapshot: () => ({}) as never,
    restore: () => ({}) as never,
    diff: () => ({}) as never,
    clearMcpFactories: () => {},
  } as unknown as ProjectPluginHost;
}

describe('check_consistency — rule 3 reads the endpoint↔dto-shaped junction', () => {
  let cwd: string;
  let db: Database.Database;
  let core: DiscoveryCore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-consistency-junction-'));
    db = createTestDb();
    const modules = [module('payload', PAYLOAD_DATA), module('gateway', GATEWAY_DATA)];
    applyProjection(db, modules);
    const pluginHost = host(modules);
    core = createDiscoveryCore({
      reader: new RawEntityReader(db, pluginHost),
      db,
      host: pluginHost,
      serialization: new SerializationEngine(pluginHost),
      roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
      projectDir: cwd,
      packageVersion: 'test',
    });

    for (const slug of ['linked', 'orphan']) {
      db.prepare('INSERT INTO payload (slug, title) VALUES (?, ?)').run(slug, slug);
    }
    db.prepare("INSERT INTO gateway (slug, title) VALUES ('get-orders', 'GET /orders')").run();
    // `linked` is reachable only through the gateway's contract — no page embeds it.
    db.prepare(
      "INSERT INTO gateway_payload (gateway_slug, payload_slug, relation) VALUES ('get-orders', 'linked', 'response')",
    ).run();

    const page = path.join(cwd, 'pages', 'api.md');
    await fs.mkdir(path.dirname(page), { recursive: true });
    await fs.writeFile(page, '# API\n\n<inline_mention type="gateway" slug="get-orders"/>\n', 'utf-8');
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  const unreferenced = async (): Promise<Array<{ type: string; slug: string }>> =>
    (await core.checkConsistency({})).unreferencedEntities as Array<{ type: string; slug: string }>;

  it('[section:5tfhxy2p] an entity linked structurally through the junction is not reported unreferenced; an unlinked one still is', async () => {
    const rows = await unreferenced();
    expect(rows).not.toContainEqual({ type: 'payload', slug: 'linked' });
    expect(rows).toContainEqual({ type: 'payload', slug: 'orphan' });
    // The page-embedded gateway is marked by the page sweep, as before.
    expect(rows).not.toContainEqual({ type: 'gateway', slug: 'get-orders' });
  });

  it('[section:q91m4kgl] the junction is the rule\'s second read: removing the link row brings the warning back', async () => {
    db.prepare("DELETE FROM gateway_payload WHERE payload_slug = 'linked'").run();
    expect(await unreferenced()).toContainEqual({ type: 'payload', slug: 'linked' });

    // The rule filter selects rule 3 by number and still honours the junction.
    db.prepare(
      "INSERT INTO gateway_payload (gateway_slug, payload_slug, relation) VALUES ('get-orders', 'linked', 'request')",
    ).run();
    const filtered = await core.checkConsistency({ rule: 3 });
    expect(filtered.unreferencedEntities).not.toContainEqual({ type: 'payload', slug: 'linked' });
    expect(filtered.unreferencedEntities).toContainEqual({ type: 'payload', slug: 'orphan' });
  });

  it('[section:z5cl1q4o] find_references still does not traverse the endpoint↔dto edge', async () => {
    expect(await unreferenced()).not.toContainEqual({ type: 'payload', slug: 'linked' });
    const refs = await core.findReferences({ target: 'entity', type: 'payload', slug: 'linked' });
    expect(refs.references).toEqual([]);
    expect(refs.total).toBe(0);
  });
});
