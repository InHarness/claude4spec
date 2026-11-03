/**
 * 2.1.65 (M13 `tvqcehf5`, `b2ahrh1b`, `mzjftvzp`, `rwfzluc7`) — the host
 * registers an entity type ONLY through the registration of an envelope.
 *
 * - `registerEntityModule` is the low-level slot `registerPlugin` fans
 *   `contributes.entities` out to, and nothing else calls it: it is off the
 *   `PluginRegistry` interface, private on the implementation, and no source
 *   file outside the registry names it as a call.
 * - Every built-in type, the criteria (`ac`) and the diagrams (`diagram`)
 *   included, arrives as the envelope of its package: each type the base holds
 *   after the built-in envelopes load belongs to a plugin record. Tier (a), the
 *   direct registration, is empty.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import { PluginManifestError } from './manifest-adapter.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';
import { MAX_PROJECTION_DEPTH } from '../../../shared/plugin-host/data-schema.js';
import { loadBuiltinEnvelopes } from './loader.js';
import { fixtureModule } from '../../../../tests/helpers/fixture-module.js';
import { registerFixtureEnvelope } from '../../../../tests/helpers/fixture-envelope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(abs));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

describe('[section:tvqcehf5] registerEntityModule is the fan-out slot of registerPlugin, not a door of its own', () => {
  it('[section:tvqcehf5] the PluginRegistry interface declares registerPlugin and no registerEntityModule member', () => {
    const types = fs.readFileSync(path.join(here, 'types.ts'), 'utf-8');
    const iface = types.slice(types.indexOf('export interface PluginRegistry {'));
    const body = iface.slice(0, iface.indexOf('\n}\n'));
    expect(body).toMatch(/^\s*registerPlugin\(manifest: PluginManifest\): void;/m);
    expect(body).not.toMatch(/^\s*registerEntityModule\(/m);
  });

  it('[section:tvqcehf5] the implementation keeps the slot private, and the only call to it is the fan-out inside registerPlugin', () => {
    const registry = fs.readFileSync(path.join(here, 'registry.ts'), 'utf-8');
    expect(registry).toMatch(/private registerEntityModule\(module: BackendModule\): void/);
    const calls = registry.match(/\.registerEntityModule\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const registerPlugin = registry.slice(registry.indexOf('  registerPlugin(manifest: PluginManifest): void {'));
    expect(registerPlugin.slice(0, registerPlugin.indexOf('\n  }\n'))).toContain('this.registerEntityModule(module)');
  });

  it('[section:b2ahrh1b] no source file outside the registry registers a type directly', () => {
    const offenders = sourceFiles(SRC).filter(
      (f) => !f.endsWith(path.join('plugin-host', 'registry.ts')) && /\.registerEntityModule\(/.test(fs.readFileSync(f, 'utf-8')),
    );
    expect(offenders).toEqual([]);
  });

  it('[section:b2ahrh1b] a type registered through its envelope is owned by that envelope record, and goes away with it', () => {
    const registry = new PluginRegistryImpl();
    registerFixtureEnvelope(registry, fixtureModule('glossary'), '@fixture/glossary');
    expect(registry.getAvailable('glossary')).not.toBeNull();
    expect(registry.listPluginRecords()).toEqual([
      expect.objectContaining({ name: '@fixture/glossary', contributedTypes: ['glossary'] }),
    ]);
    registry.unregisterPlugin('@fixture/glossary');
    expect(registry.getAvailable('glossary')).toBeNull();
  });
});

describe('[section:mzjftvzp] every built-in type comes in the envelope of its package — tier (a) is empty', () => {
  it('[section:mzjftvzp] [section:rwfzluc7] after the built-in envelopes load, every available type — ac and diagram included — belongs to a plugin record', async () => {
    const registry = new PluginRegistryImpl();
    // Nothing is in the base before the loader runs: the host registers no type of its own.
    expect(registry.listAvailable()).toEqual([]);

    await loadBuiltinEnvelopes(registry);
    const available = registry.listAvailable().map((m) => m.type);
    expect(available).toEqual(expect.arrayContaining(['ac', 'diagram']));

    const owned = new Map<string, string>();
    for (const record of registry.listPluginRecords()) {
      for (const type of record.contributedTypes) owned.set(type, record.name);
    }
    for (const type of available) {
      expect({ type, owner: owned.get(type) ?? null }).toEqual({ type, owner: expect.any(String) });
    }
    expect(owned.get('ac')).toBe('c4s-plugin-ac');
  }, 60_000);
});

/**
 * The manifest rejections the registration of an envelope makes (M13 `m13l11sc`,
 * Load-time validation "Przy rejestracji"): a manifest is refused with a loud
 * error before anything reaches the projection — and, the registration being
 * atomic, the envelope leaves no type and no record behind.
 */
describe('[section:m13l11sc] registerPlugin rejects the manifest — no reserved title, a broken element identity, too deep a nesting', () => {
  const TITLE = { type: 'string', required: true, maxLength: 200, default: 'Untitled' };

  function refused(data: DataDeclaration, slugField = 'title'): unknown {
    const registry = new PluginRegistryImpl();
    let thrown: unknown;
    try {
      registerFixtureEnvelope(
        registry,
        fixtureModule('glossary', { data, slugPattern: [{ op: 'slugify', field: slugField }] }),
        '@fixture/rejected',
      );
    } catch (err) {
      thrown = err;
    }
    expect(registry.getAvailable('glossary')).toBeNull();
    expect(registry.listPluginRecords()).toEqual([]);
    return thrown;
  }

  it('[section:m13l11sc] a schema without the reserved `title` field is refused at registration', () => {
    const thrown = refused({ schema: { name: { type: 'string', required: true } } } as unknown as DataDeclaration, 'name');
    expect(thrown).toBeInstanceOf(PluginManifestError);
    expect((thrown as Error).message).toMatch(/reserved `title` field is required/);
  });

  it('[section:m13l11sc] an element identity breaking its rules is refused at registration — a name not in the item, and rekeyOn not a proper prefix', () => {
    const items = (collection: unknown) =>
      ({
        schema: {
          title: TITLE,
          items: {
            type: 'collection',
            collection,
            item: { type: 'object', fields: { label: { type: 'string' }, kind: { type: 'string' } } },
          },
        },
      }) as unknown as DataDeclaration;
    const notAField = refused(items({ kind: 'value', identity: ['nope'] }));
    expect(notAField).toBeInstanceOf(PluginManifestError);
    expect((notAField as Error).message).toMatch(/is not a field of\s+its item/);
    const notAPrefix = refused(items({ kind: 'value', identity: ['label', 'kind'], rekeyOn: ['kind'] }));
    expect(notAPrefix).toBeInstanceOf(PluginManifestError);
    expect((notAPrefix as Error).message).toMatch(/not a\s+proper, non-empty prefix/);
  });

  it('[section:m13l11sc] a nesting past the host projection depth limit is refused at registration', () => {
    let node = { type: 'string' } as Record<string, unknown>;
    for (let i = 0; i <= MAX_PROJECTION_DEPTH; i += 1) node = { type: 'object', fields: { deeper: node } };
    const thrown = refused({ schema: { title: TITLE, nest: node } } as unknown as DataDeclaration);
    expect(thrown).toBeInstanceOf(PluginManifestError);
    expect((thrown as Error).message).toMatch(/past the projection limit/);
  });
});
