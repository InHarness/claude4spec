/**
 * 2.1.26 — the content of a `contentBearing` field is issued by ONE generic core
 * operation, `get_field_content`, and that operation is the sixth on the plugin
 * runtime surface.
 *
 * - M39 `v0fldrd8` (L2): the operation is generic, not generated per type. A
 *   field enters its domain by the flag alone — the type's author writes no
 *   operation, no route and no tool — and how many such operations exist does
 *   not depend on the installed plugins. The descriptor a generic read answers
 *   with names the operation.
 * - M39 `gz7q92lz` (L11): the read core exposes SIX entity operations to a
 *   loaded envelope through `MountContext` — `getEntities`, `listEntities`,
 *   `searchEntities`, `describeTypes`, `resolveIdentity`, `getFieldContent` —
 *   and no page-, section-, tag- or reference-scoped one; the envelope gets the
 *   serialized record. Additive within the current baseline: no
 *   `HOST_API_VERSION` bump.
 *
 * The plugin under test contributes a type with a content-bearing field and NO
 * backend of its own beyond a `mount` that captures its context — no route, no
 * MCP server, no `contentOperation`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PluginManifest } from '../../../src/shared/plugin-host/manifest.js';
import { HOST_API_VERSION } from '../../../src/shared/plugin-host/manifest.js';
import { HOST_API_RELEASES, HOST_API_UNVERSIONED_CHANGES } from '../../../src/shared/plugin-host/host-api.js';
import { CATALOG } from '../../../src/server/operations/catalog.js';
import { registerCoreOperations } from '../../../src/server/operations/core-operations.js';
import { createPluginTestApp, type PluginTestApp } from '../../helpers/plugin-test-setup.js';

registerCoreOperations();

const BODY = 'Zażółć gęślą jaźń — a body measured in kilobytes, in principle.';

function gadgetManifest(mount: (ctx: Record<string, unknown>) => void): PluginManifest {
  return {
    name: '@acme/c4s-plugin-gadgets',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    contributes: {
      entities: [
        {
          type: 'gadget',
          data: {
            schema: {
              title: { type: 'string', required: true, maxLength: 200 },
              body: { type: 'string', contentBearing: true },
            },
          },
          slugPattern: [{ op: 'slugify', field: 'title' }],
          payloadVersion: 1,
          label: 'Gadget',
          labelPlural: 'Gadgets',
          pathPrefix: '/gadgets',
          systemPrompt: { roleNoun: 'gadget', mcpToolsLine: 'gadget-tools: none' },
          backend: { mount },
        },
      ],
    },
  };
}

const READ_OPS = [
  'getEntities',
  'listEntities',
  'searchEntities',
  'describeTypes',
  'resolveIdentity',
  'getFieldContent',
] as const;

type ReadSurface = {
  getEntities: (i: unknown) => { results: Array<{ slug: string; entity: Record<string, unknown> | null }> };
  describeTypes: (i?: unknown) => { types: Array<{ type: string; contentFields: Array<{ field: string; operation: string }> }> };
  getFieldContent: (i: unknown) => unknown;
};

describe('get_field_content — one generic operation, the sixth on the plugin runtime surface (2.1.26)', () => {
  const opened: PluginTestApp[] = [];
  afterEach(async () => {
    for (const t of opened.splice(0)) await t.cleanup();
  });

  async function openWithGadget(): Promise<{ t: PluginTestApp; ctx: Record<string, unknown>; slug: string }> {
    let seen: Record<string, unknown> | null = null;
    const t = await createPluginTestApp([gadgetManifest((ctx) => void (seen = ctx))]);
    opened.push(t);
    expect(seen).not.toBeNull();
    const created = await request(t.app).post(`${t.baseUrl}/gadgets`).send({ title: 'First gadget', body: BODY });
    expect(created.status).toBe(201);
    return { t, ctx: seen as unknown as Record<string, unknown>, slug: created.body.data.slug as string };
  }

  it('[section:v0fldrd8] [section:uuvadx9p] a plugin type gets its content-bearing field served by the generic operation keyed (type, slug, field) with no operation, route or tool of its own', async () => {
    const operationsBefore = CATALOG.list().map((op) => op.name).sort();
    const { t, ctx, slug } = await openWithGadget();
    const read = ctx as unknown as ReadSurface;

    // The descriptor names the generic operation — the type declared no override.
    const described = read.describeTypes({ types: ['gadget'] }).types[0]!;
    expect(described.contentFields).toEqual([{ field: 'body', operation: 'get_field_content' }]);

    // A generic read carries the descriptor, never the value.
    const record = read.getEntities({ type: 'gadget', slugs: [slug] }).results[0]!.entity!;
    expect(record).not.toHaveProperty('body');
    expect(record).toMatchObject({
      hasBody: true,
      bodyBytes: Buffer.byteLength(BODY, 'utf8'),
      bodyOperation: 'get_field_content',
    });

    // The one cross-cutting REST rendering serves it, though the plugin contributed no route.
    const rest = await request(t.app).get(`${t.baseUrl}/entities/gadget/${slug}/content/body`);
    expect(rest.status).toBe(200);
    expect(rest.body).toEqual({
      type: 'gadget',
      slug,
      field: 'body',
      content: BODY,
      bytes: Buffer.byteLength(BODY, 'utf8'),
    });

    // Installing the type added no operation to the catalog: the count does not depend on plugins…
    expect(CATALOG.list().map((op) => op.name).sort()).toEqual(operationsBefore);
    // …and there is exactly one field-content operation, named for no type.
    expect(CATALOG.list().filter((op) => /content/.test(op.name)).map((op) => op.name)).toEqual(['get_field_content']);
    expect(CATALOG.list().some((op) => op.name.includes('gadget'))).toBe(false);
  }, 60_000);

  it('[section:v0fldrd8] the operation answers every type the same way — a non-content field is INVALID_ARGUMENT naming the covered fields, an unknown slug ENTITY_NOT_FOUND', async () => {
    const { ctx, slug } = await openWithGadget();
    const read = ctx as unknown as ReadSurface;
    const thrown = (fn: () => unknown): Record<string, unknown> => {
      try {
        fn();
      } catch (err) {
        return err as Record<string, unknown>;
      }
      throw new Error('expected a refusal');
    };
    expect(thrown(() => read.getFieldContent({ type: 'gadget', slug, field: 'title' }))).toMatchObject({
      code: 'INVALID_ARGUMENT',
      hint: expect.stringContaining('body'),
    });
    expect(thrown(() => read.getFieldContent({ type: 'gadget', slug: 'no-such-gadget', field: 'body' }))).toMatchObject({
      code: 'ENTITY_NOT_FOUND',
    });
    // A built-in type with its own content-bearing field goes through the very same function.
    const diagram = read.describeTypes({ types: ['diagram'] }).types[0]!;
    expect(diagram.contentFields).toEqual([{ field: 'source', operation: 'get_field_content' }]);
  }, 60_000);

  it('[section:gz7q92lz] MountContext binds exactly the six entity read operations, getFieldContent among them, and no page/section/tag/reference read', async () => {
    const { ctx, slug } = await openWithGadget();
    for (const name of READ_OPS) expect(typeof ctx[name], `MountContext.${name}`).toBe('function');
    for (const absent of ['listPages', 'getPageOutline', 'getSections', 'getPage', 'searchPages', 'listTags', 'findReferences', 'checkConsistency', 'overview']) {
      expect(ctx, `MountContext.${absent}`).not.toHaveProperty(absent);
    }
    // The sixth follows a descriptor to the value — for a type owned by this plugin or any other.
    expect((ctx as unknown as ReadSurface).getFieldContent({ type: 'gadget', slug, field: 'body' })).toEqual({
      type: 'gadget',
      slug,
      field: 'body',
      content: BODY,
      bytes: Buffer.byteLength(BODY, 'utf8'),
    });
  }, 60_000);

  it('[section:gz7q92lz] the six-operation surface is additive within the current baseline: recorded unversioned, no HOST_API_VERSION bump', () => {
    const entry = HOST_API_UNVERSIONED_CHANGES.find((c) => c.slot.startsWith('MountContext.{getEntities'));
    expect(entry?.kind).toBe('slot-added');
    const recorded = entry!.slot.replace(/^MountContext\.\{|\}$/g, '').split(',');
    expect(recorded).toEqual([...READ_OPS]);
    // No release of the Host API was cut for it: the version is still the last recorded release.
    expect(HOST_API_RELEASES[HOST_API_RELEASES.length - 1]!.version).toBe(HOST_API_VERSION);
    expect(HOST_API_VERSION).toBe('2.1.0');
  });
});
