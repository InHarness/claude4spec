/**
 * 2.1.41 (M13) — where a `ref` flag may stand, and what happens when it stands
 * elsewhere or names a type nobody contributes: a WARNING, never a rejection.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_SLUG_PATTERN, fixtureModule } from '../../../../tests/helpers/fixture-module.js';
import { PluginRegistryImpl } from './registry.js';
import { buildBasePluginPackages } from './base-packages.js';
import { logRefRegistrationWarnings, refRegistrationWarnings } from './ref-warnings.js';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';
import type { FieldNode } from '../../../shared/plugin-host/data-schema.js';

const REF = { onMissing: 'warn', onDelete: 'leave-dangling' } as const;

/** An external plugin contributing one type `op` with the given extra fields. */
function opsPlugin(fields: Record<string, FieldNode>): PluginManifest {
  return {
    name: '@acme/c4s-plugin-ops',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    contributes: {
      entities: [
        {
          type: 'op',
          data: { schema: { title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' }, ...fields } },
          slugPattern: FIXTURE_SLUG_PATTERN,
          payloadVersion: 1,
          label: 'Op',
          labelPlural: 'Ops',
          pathPrefix: '/ops',
          systemPrompt: { roleNoun: 'op', mcpToolsLine: 'op-tools: ...' },
        },
      ],
    },
  };
}

/** The pool as the server builds it: a built-in `endpoint` first, then the external package. */
function poolWith(manifest: PluginManifest): PluginRegistryImpl {
  const registry = new PluginRegistryImpl();
  registry.registerEntityModule(fixtureModule('endpoint'));
  registry.registerPlugin(manifest);
  return registry;
}

const loaded = (m: PluginManifest) => [
  { package: m.name, status: 'loaded' as const, contributedTypes: ['op'] },
];

afterEach(() => vi.restoreAllMocks());

describe('ref registration warnings', () => {
  it('[ac:ac-plugin-zewnetrzny-deklarujacy-ref-end] an external plugin declaring ref: \'endpoint\' registers with no error and no warning when a built-in package contributes endpoint', () => {
    const manifest = opsPlugin({
      restVia: { type: 'string', ref: 'endpoint', clearable: true, ...REF },
      restEndpoints: {
        type: 'collection',
        collection: 'value',
        item: { type: 'object', fields: { endpoint: { type: 'string', required: true, ref: 'endpoint', ...REF } } },
      },
    });
    expect(manifest).not.toHaveProperty('dependsOn');
    let registry!: PluginRegistryImpl;
    expect(() => {
      registry = poolWith(manifest);
    }).not.toThrow();
    expect(registry.getAvailable('op')).not.toBeNull();
    expect(refRegistrationWarnings(registry.listAvailable())).toEqual([]);
  });

  it('[ac:ac-typ-deklarujacy-ref-na-elemencie-skal] a type declaring ref on a scalar collection element registers, and the registration reports a warning in the log and in doctor', () => {
    const manifest = opsPlugin({
      aliases: { type: 'collection', collection: 'value', item: { type: 'string', ref: 'endpoint', ...REF } },
    });
    const registry = poolWith(manifest);
    // Registered: the type is in the pool.
    expect(registry.getAvailable('op')).not.toBeNull();

    const warnings = refRegistrationWarnings(registry.listAvailable());
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.type).toBe('op');
    // Names the type, the field path and the reason.
    expect(warnings[0]!.message).toMatch(/^op: data\.schema field "aliases\[\]" declares ref: 'endpoint' in a scalar element of a collection/);

    // Log channel.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logRefRegistrationWarnings(warnings);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REF_WARNING op: data.schema field "aliases[]"'));

    // `doctor` channel: `/_meta/plugins` carries it on the package's record.
    const records = buildBasePluginPackages(registry, loaded(manifest));
    const ops = records.find((r) => r.package === manifest.name)!;
    expect(ops.status).toBe('loaded');
    expect(ops.warnings).toEqual([warnings[0]!.message]);
  });

  it('warns for each of the four forbidden places and names the reason', () => {
    const manifest = opsPlugin({
      nested: { type: 'object', fields: { target: { type: 'string', ref: 'endpoint', ...REF } } },
      byKey: { type: 'record', key: { type: 'string' }, value: { type: 'string', ref: 'endpoint', ...REF } },
      nRows: { type: 'number', column: 'n_rows', default: 0 },
      nCols: { type: 'number', column: 'n_cols', default: 0 },
      cells: {
        type: 'collection',
        collection: 'keyed',
        keyFields: ['r', 'c'],
        axes: [
          { key: 'r', extent: 'nRows' },
          { key: 'c', extent: 'nCols' },
        ],
        item: {
          type: 'object',
          fields: {
            r: { type: 'number', required: true },
            c: { type: 'number', required: true },
            target: { type: 'string', ref: 'endpoint', ...REF },
          },
        },
      },
    });
    const messages = refRegistrationWarnings(poolWith(manifest).listAvailable()).map((w) => w.message);
    expect(messages).toEqual([
      expect.stringMatching(/"nested\.target" .* in an object nested outside a collection/),
      expect.stringMatching(/"byKey\.\$value" .* in a record<K,V> node/),
      expect.stringMatching(/"cells\[\]\.target" .* in a keyed collection/),
    ]);
  });

  it('warns — not rejects — for a ref naming a type no registered package contributes', () => {
    const manifest = opsPlugin({ cliVia: { type: 'string', ref: 'cli-command', ...REF } });
    const registry = poolWith(manifest);
    const [warning, ...rest] = refRegistrationWarnings(registry.listAvailable());
    expect(rest).toEqual([]);
    expect(warning!.message).toMatch(/"cliVia" declares ref: 'cli-command', which no registered package contributes/);
  });

  it('never warns about the polymorphic ac.verifies[] exception', () => {
    const manifest = opsPlugin({
      verifies: {
        type: 'collection',
        collection: { kind: 'value', identity: ['type', 'slug'] },
        item: {
          type: 'object',
          fields: { type: { type: 'string', required: true }, slug: { type: 'string', required: true, ref: '$type', ...REF } },
        },
      },
    });
    expect(refRegistrationWarnings(poolWith(manifest).listAvailable())).toEqual([]);
  });
});
