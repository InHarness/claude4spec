/**
 * Rules 15-17 — the three ways a `module-dependency` edge can be wrong.
 *
 * They exist because nothing ELSE can catch these. A module is a party to an
 * edge and not an entity type, so neither `dependent` nor `provider` is a `ref`:
 * a typo'd module number produces no `broken` marker anywhere, just a silent
 * false edge that reads as fact. These rules are the whole of the safety net,
 * which is why each one is asserted on its own rather than through the summary.
 *
 * Driven against a fixture module rather than the real envelope: the rules are
 * core behaviour keyed on a type NAME, and the core deliberately does not import
 * from `plugins/` — see `ops/module-dependency-rules.ts`.
 */

import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { applyProjection } from '../db/projection.js';
import { createDiscoveryCore } from './index.js';
import { RawEntityReader } from './raw-entity-reader.js';
import { SerializationEngine } from '../core/plugin-host/serialization-engine.js';
import { MODULE_DEPENDENCY_TYPE } from './ops/module-dependency-rules.js';
import type { DataDeclaration } from '../../shared/plugin-host/data-schema.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';
import type { DiscoveryCore } from './types.js';
import type { Root } from '../../shared/types.js';
import { DEFAULT_PAGES_ROOT_PROPS } from '../../shared/types.js';

const DATA: DataDeclaration = {
  schema: {
    title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' },
    dependent: { type: 'string', required: true, maxLength: 8, default: '' },
    provider: { type: 'string', required: true, maxLength: 8, default: '' },
    needs: { type: 'string', required: true, maxLength: 400, default: '' },
  },
};

function depModule(): BackendModule {
  return {
    type: MODULE_DEPENDENCY_TYPE,
    data: DATA,
    slugPattern: [{ op: 'slugify', field: 'title' }],
    payloadVersion: 1,
    label: 'Module dependency',
    labelPlural: 'Module dependencies',
    displayOrder: 120,
    pathPrefix: '/module-dependencies',
    systemPrompt: { roleNoun: 'Module dependencies' },
  };
}

function host(active: BackendModule[]): ProjectPluginHost {
  const available = [depModule()];
  const byType = new Map(available.map((m) => [m.type, m]));
  const activeTypes = new Set(active.map((m) => m.type));
  return {
    listAvailable: () => available,
    listEntities: () => active,
    listSettings: () => [],
    listCommands: () => [],
    listSubagents: () => [],
    getEntity: (t: string) => (activeTypes.has(t) ? (byType.get(t) ?? null) : null),
    getAvailable: (t: string) => byType.get(t) ?? null,
    isActive: (t: string) => activeTypes.has(t),
    partition: () => ({ active: [...activeTypes], inactive: [], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
  } as unknown as ProjectPluginHost;
}

const pagesRoot = (): Root => ({
  id: 'pages',
  name: 'Pages',
  dir: 'pages',
  builtin: true,
  ...DEFAULT_PAGES_ROOT_PROPS,
});

describe('check_consistency — module-dependency edge rules', () => {
  let cwd: string;
  let db: Database.Database;

  function core(active: BackendModule[] = [depModule()]): DiscoveryCore {
    const pluginHost = host(active);
    return createDiscoveryCore({
      reader: new RawEntityReader(db, pluginHost),
      db,
      host: pluginHost,
      serialization: new SerializationEngine(pluginHost),
      roots: [pagesRoot()],
      projectDir: cwd,
      packageVersion: 'test',
    });
  }

  /** One edge, with its tag if `tag` is given. */
  function edge(
    slug: string,
    dependent: string,
    provider: string,
    needs: string,
    tag?: string,
  ): void {
    db.prepare(
      `INSERT INTO module_dependency (slug, title, dependent, provider, needs)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(slug, `${dependent} wymaga od ${provider}`, dependent, provider, needs);
    if (tag) {
      db.prepare(`INSERT OR IGNORE INTO tag (slug, name) VALUES (?, ?)`).run(tag, tag);
      db.prepare(
        `INSERT INTO entity_tag (entity_type, entity_slug, tag_slug) VALUES (?, ?, ?)`,
      ).run(MODULE_DEPENDENCY_TYPE, slug, tag);
    }
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-module-dep-'));
    db = createTestDb();
    applyProjection(db, [depModule()]);
    await fs.mkdir(path.join(cwd, 'pages'), { recursive: true });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('says nothing about a well-formed corpus', async () => {
    edge('m19-requires-m13', 'M19', 'M13', 'Bez tego nie ma czym zasilić widoku.', 'm19');
    const report = await core().checkConsistency({});

    expect(report.moduleDependenciesMissingTag).toEqual([]);
    expect(report.moduleDependenciesIdentifierInNeeds).toEqual([]);
    expect(report.moduleDependenciesDuplicatePair).toEqual([]);
  });

  describe('rule 15 — the edge does not carry its dependent’s tag', () => {
    it('reports an untagged edge', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Bez tego nie ma czym zasilić widoku.');
      const report = await core().checkConsistency({});

      expect(report.moduleDependenciesMissingTag).toEqual([
        { slug: 'm19-requires-m13', dependent: 'M19', provider: 'M13' },
      ]);
    });

    /**
     * The comparison is case-INSENSITIVE because both spellings are correct in
     * their own place: the style writes `M19` in prose and the corpus carries the
     * tag as `m19`. A case-sensitive rule would report every correctly tagged
     * edge in the specification — the loudest possible false positive.
     */
    it('accepts the corpus’s lower-case tag against the field’s upper-case module', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Reason enough.', 'm19');
      const report = await core().checkConsistency({});
      expect(report.moduleDependenciesMissingTag).toEqual([]);
    });

    /** The PROVIDER's tag is not a substitute — the edge is filed under one side. */
    it('is not satisfied by the provider’s tag', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Reason enough.', 'm13');
      const report = await core().checkConsistency({});
      expect(report.moduleDependenciesMissingTag).toHaveLength(1);
    });
  });

  describe('rule 16 — a module identifier inside needs', () => {
    it('reports the token wherever it sits in the prose', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Pobiera stąd dane, bo M13 trzyma projekcję.', 'm19');
      const report = await core().checkConsistency({});

      expect(report.moduleDependenciesIdentifierInNeeds).toEqual([
        {
          slug: 'm19-requires-m13',
          dependent: 'M19',
          provider: 'M13',
          needs: 'Pobiera stąd dane, bo M13 trzyma projekcję.',
        },
      ]);
    });

    /**
     * The rule fires on the SHAPE, not on the subject: an identifier belonging to
     * a sibling specification is reported too, and that is the ruling rather than
     * a false positive — such text does not belong in this field at all.
     */
    it('fires on a foreign module number as readily as on its own', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Odpowiednik M42 w siostrzanej specyfikacji.', 'm19');
      const report = await core().checkConsistency({});
      expect(report.moduleDependenciesIdentifierInNeeds).toHaveLength(1);
    });

    /**
     * A shared regex with a `g` flag keeps `lastIndex` between calls and would
     * report roughly every second offending row — a rule that looks like it works.
     */
    it('reports EVERY offending row, not every other one', async () => {
      edge('a-requires-b', 'M01', 'M02', 'Zależy od M02.', 'm01');
      edge('c-requires-d', 'M03', 'M04', 'Zależy od M04.', 'm03');
      edge('e-requires-f', 'M05', 'M06', 'Zależy od M06.', 'm05');
      const report = await core().checkConsistency({});
      expect(report.moduleDependenciesIdentifierInNeeds).toHaveLength(3);
    });

    it('leaves ordinary prose alone', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Bez tego nie ma czym zasilić widoku.', 'm19');
      const report = await core().checkConsistency({});
      expect(report.moduleDependenciesIdentifierInNeeds).toEqual([]);
    });
  });

  describe('rule 17 — the same ordered pair twice', () => {
    it('reports both slugs, including the suffix the host minted', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Pierwszy powód.', 'm19');
      edge('m19-requires-m13-2', 'M19', 'M13', 'Drugi powód.', 'm19');
      const report = await core().checkConsistency({});

      expect(report.moduleDependenciesDuplicatePair).toEqual([
        { dependent: 'M19', provider: 'M13', slugs: ['m19-requires-m13', 'm19-requires-m13-2'] },
      ]);
    });

    /**
     * The pair is ORDERED. A mutual relation is two edges BY DESIGN, so reporting
     * it as a duplicate would flag the correct shape as the defect.
     */
    it('does not mistake a mutual relation for a duplicate', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Pierwszy kierunek.', 'm19');
      edge('m13-requires-m19', 'M13', 'M19', 'Drugi kierunek.', 'm13');
      const report = await core().checkConsistency({});
      expect(report.moduleDependenciesDuplicatePair).toEqual([]);
    });
  });

  describe('gating and reporting', () => {
    /**
     * Gated on the TYPE being active, which for this type is the same as the
     * package being active: `module-dependency` has exactly one carrier.
     */
    it('goes quiet when the type is deactivated, without dropping the buckets', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Zależy od M13.');
      const report = await core([]).checkConsistency({});

      expect(report.moduleDependenciesMissingTag).toEqual([]);
      expect(report.moduleDependenciesIdentifierInNeeds).toEqual([]);
      expect(report.moduleDependenciesDuplicatePair).toEqual([]);
    });

    it('counts all three as warnings, never as errors', async () => {
      edge('m19-requires-m13', 'M19', 'M13', 'Zależy od M13.');
      edge('m19-requires-m13-2', 'M19', 'M13', 'Zależy od M13.');
      const report = await core().checkConsistency({});

      // 2 missing tags + 2 identifiers-in-needs + 1 duplicate pair.
      expect(report.summary.warnings).toBeGreaterThanOrEqual(5);
      expect(report.summary.errors).toBe(0);
    });

    it.each([
      [15, 'moduleDependenciesMissingTag'],
      [16, 'moduleDependenciesIdentifierInNeeds'],
      [17, 'moduleDependenciesDuplicatePair'],
    ])('rule %i filters to its own bucket', async (rule, bucket) => {
      edge('m19-requires-m13', 'M19', 'M13', 'Zależy od M13.');
      edge('m19-requires-m13-2', 'M19', 'M13', 'Zależy od M13.');
      const report = await core().checkConsistency({ rule });

      expect(report[bucket]).not.toEqual([]);
      for (const other of [
        'moduleDependenciesMissingTag',
        'moduleDependenciesIdentifierInNeeds',
        'moduleDependenciesDuplicatePair',
      ].filter((b) => b !== bucket)) {
        expect(report[other]).toEqual([]);
      }
      // `summary` counts the whole project, before any filter.
      expect(report.summary.warnings).toBeGreaterThanOrEqual(5);
    });

    it.each(['module-dependency-missing-tag', 'module-dependency-duplicate-pair'])(
      'accepts %s by name as well as by number',
      async (name) => {
        edge('m19-requires-m13', 'M19', 'M13', 'Reason.', undefined);
        await expect(core().checkConsistency({ rule: name })).resolves.toBeDefined();
      },
    );
  });
});
