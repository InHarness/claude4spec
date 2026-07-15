import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { createReferenceToolsServer, type ReferenceToolsDeps } from './reference-tools.js';
import { PagesService } from '../services/pages.js';
import { clearExtensionReferenceTypes, registerExtensionReferenceType } from '../../shared/reference-extensions.js';
import type { ProjectPluginHost, BackendModule } from '../core/plugin-host/types.js';

/**
 * Regression for the rule-12 generalization (brief 0-1-128-to-0-1-129): a
 * `<diagram/>` tag has no `type` attribute (the tag name IS the type), so
 * before this change `check_consistency` silently skipped it entirely —
 * neither flagging a broken reference nor marking a referenced diagram as
 * used. Widening the main loop's `tagType` resolution to fall back to the
 * registered extension's `entityType` fixes both.
 */

function diagramModule(): BackendModule {
  return {
    type: 'diagram',
    table: 'diagram',
    label: 'Diagram',
    labelPlural: 'Diagrams',
    displayOrder: 70,
    pathPrefix: '/diagrams',
    slugFrom: () => 'diagram-x',
    serializer: {} as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: 'Diagrams',
      countStat: { placeholder: 'diagramCount', sqlQuery: 'SELECT 0', label: 'diagrams' },
    },
  };
}

function fakeHost(): ProjectPluginHost {
  const modules = new Map<string, BackendModule>([['diagram', diagramModule()]]);
  return {
    listAvailable: () => Array.from(modules.values()),
    listEntities: () => Array.from(modules.values()),
    listSettings: () => [],
    listCommands: () => [],
    getEntity: (type) => modules.get(type) ?? null,
    getAvailable: (type) => modules.get(type) ?? null,
    isActive: (type) => modules.has(type),
    partition: () => ({ active: ['diagram'], inactive: [], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
    computeEntityCounts: () => ({}),
    entityExists: () => false,
    registerEntityService: () => {},
    getEntityService: () => null,
    snapshot: () => ({}) as never,
    restore: () => ({}) as never,
    diff: () => ({}) as never,
    clearMcpFactories: () => {},
  };
}

async function connectClient(deps: ReferenceToolsDeps): Promise<Client> {
  const { server } = createReferenceToolsServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function checkConsistency(client: Client): Promise<any> {
  const res = await client.callTool({ name: 'check_consistency', arguments: {} });
  expect(res.isError).toBeFalsy();
  const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
  return JSON.parse(text);
}

describe('check_consistency — rule 12 (extension tags with entityType)', () => {
  let cwd: string;
  let db: Database.Database;
  let pagesService: PagesService;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-reference-tools-test-'));
    db = createTestDb();
    pagesService = new PagesService(cwd, 'pages', 'pages');
    await pagesService.ensureRoot();
    clearExtensionReferenceTypes();
    registerExtensionReferenceType({ tag: 'diagram', attrOrder: ['slug', 'caption'], entityType: 'diagram' });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
    clearExtensionReferenceTypes();
  });

  function deps(): ReferenceToolsDeps {
    return {
      pluginHost: fakeHost(),
      tagsService: { getEntityTagSlugs: () => [], list: () => [] } as unknown as ReferenceToolsDeps['tagsService'],
      referencesService: {} as ReferenceToolsDeps['referencesService'],
      pagesService,
      sectionsService: { has: () => false } as unknown as ReferenceToolsDeps['sectionsService'],
      ws: { broadcast: () => {} } as unknown as ReferenceToolsDeps['ws'],
      db,
      cwd,
      entityStore: {} as ReferenceToolsDeps['entityStore'],
    };
  }

  it('flags a broken <diagram/> reference (slug does not exist)', async () => {
    await pagesService.write('page.md', { body: '# Page\n\n<diagram slug="nonexistent" caption="x"/>\n' });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.brokenReferences).toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'nonexistent', category: 'broken-reference' }),
    );
  });

  it('does not flag a valid <diagram/> reference, and marks the diagram as referenced', async () => {
    db.prepare(`INSERT INTO diagram (slug, format, source) VALUES ('flow', 'mermaid', 'graph TD; A-->B')`).run();
    await pagesService.write('page.md', { body: '# Page\n\n<diagram slug="flow" caption="x"/>\n' });
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.brokenReferences).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'flow' }),
    );
    expect(result.unreferencedEntities).not.toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'flow' }),
    );
  });

  it('an unreferenced diagram entity is reported as unreferenced', async () => {
    db.prepare(`INSERT INTO diagram (slug, format, source) VALUES ('orphan', 'mermaid', 'graph TD; A-->B')`).run();
    const client = await connectClient(deps());

    const result = await checkConsistency(client);

    expect(result.unreferencedEntities).toContainEqual(
      expect.objectContaining({ type: 'diagram', slug: 'orphan' }),
    );
  });
});
