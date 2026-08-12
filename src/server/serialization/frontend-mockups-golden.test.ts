/**
 * L9 byte-identity gate for `ui-view` and `design-system`.
 *
 * The 0.2.18 brief's acceptance criterion for moving these two types into the
 * `c4s-plugin-frontend-mockups` envelope is that serialization stays
 * BYTE-identical — same serializer, same attribute order, same `snapshot()`
 * shape — because every registration path ends in the same registry slot, and a
 * release cut before the move must diff clean against one cut after it.
 *
 * This is the sibling of `api-contracts-golden.test.ts`, written for the same
 * reason and captured the same way: against the host-registered modules, BEFORE
 * the code moves, so the very same file is what proves the move was inert. It
 * drives the fixture through REST, which is registration-path agnostic, so the
 * test does not move with the modules.
 *
 * Fixtures deliberately include the shapes most likely to be normalized away:
 * a NULL `url`, a `ui-view` with no design system, one pointing at a design
 * system that does not exist (`onMissing: 'warn'`, `onDelete: 'leave-dangling'`
 * — a dangling ref must survive serialization rather than being scrubbed), a
 * design system with zero groups and zero modes, all three `params[].in` arms,
 * every token-value arm (literal / alias / composite object), both group tiers,
 * and every one of the five view projections.
 */

import { compositionOf } from '../../shared/plugin-host/composition.js';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../../tests/helpers/test-app.js';
import { canonicalize } from './snapshot.js';
import { genericEntity } from './generic.js';
import type { ViewKind, ViewSet } from './types.js';

const GOLDEN_DIR = path.join(import.meta.dirname, '__goldens__');
const VIEWS: ViewKind[] = [
  'inline_mention',
  'single_element',
  'element_list_item',
  'tagged_list_item',
  'detail',
];

/**
 * Built through REST, not through `requireService` — neither type registers a
 * service, and the generated `/api/{type}s` routes are the write door.
 *
 * Slugs are passed EXPLICITLY: the golden compares by slug, and two of these
 * names do not slugify to the name the golden knows.
 */
async function buildFixture() {
  const app = await createTestApp();
  const post = async (p: string, body: unknown) => {
    const res = await request(app.app).post(p).send(body);
    if (res.status !== 201) {
      throw new Error(`fixture: POST ${p} → ${res.status} ${JSON.stringify(res.body)}`);
    }
  };

  await post('/api/design-systems', {
    slug: 'brand-2026',
    name: 'Brand2026',
    description: 'Podstawowy system — kolory i typografia',
    groups: [
      {
        name: 'color',
        tier: 'primitive',
        tokens: [
          { name: 'brand-primary', type: 'color', value: '#2563eb', description: 'Main brand blue' },
          // The alias arm: a `{token}` string must not be resolved on the way out.
          { name: 'action', type: 'color', value: '{brand-primary}' },
        ],
      },
      {
        name: 'type',
        tier: 'semantic',
        tokens: [
          // The composite arm: an object value whose keys the host does not interpret.
          {
            name: 'heading-1',
            type: 'typography',
            value: { fontSize: '32px', lineHeight: '1.2', fontWeight: 700 },
          },
          // A scale, in authored order — `tokens` is deliberately NOT `unordered`.
          { name: 'size-sm', type: 'fontSize', value: '12px' },
          { name: 'size-md', type: 'fontSize', value: '16px' },
          { name: 'size-xl', type: 'fontSize', value: '24px' },
        ],
      },
      // A group with an empty token list: `tokens: []` must not collapse to undefined.
      { name: 'spacing', tier: 'primitive', tokens: [] },
    ],
    modes: [
      { name: 'dark', overrides: [{ token: 'brand-primary', value: '#60a5fa' }] },
      // A mode with no overrides at all.
      { name: 'high-contrast', overrides: [] },
    ],
  });

  // Zero groups, zero modes — the empty-collection shape.
  await post('/api/design-systems', {
    slug: 'legacy-tokens',
    name: 'LegacyTokens',
    groups: [],
    modes: [],
  });

  await post('/api/ui-views', {
    slug: 'user-profile',
    name: 'UserProfile',
    url: '/users/:id',
    description: 'Ekran profilu — zakładki',
    params: [
      { name: 'id', in: 'path', type: 'uuid', required: true, description: 'User id' },
      { name: 'tab', in: 'query', type: 'enum', required: false, default: 'overview' },
      { name: 'anchor', in: 'hash', type: 'string' },
    ],
    designSystemSlug: 'brand-2026',
  });

  // Null url (modal/drawer without routing), no params, no design system.
  await post('/api/ui-views', {
    slug: 'confirm-dialog',
    name: 'ConfirmDialog',
    url: null,
    params: [],
  });

  /**
   * A DANGLING ref. `onMissing: 'warn'` / `onDelete: 'leave-dangling'` mean the
   * value is kept as authored; a serializer that scrubbed unresolvable refs
   * would silently drop it, and this is the fixture that says so.
   */
  await post('/api/ui-views', {
    slug: 'orphan-view',
    name: 'OrphanView',
    url: '/orphan',
    params: [],
    designSystemSlug: 'never-existed',
  });

  return app;
}

function projections(app: Awaited<ReturnType<typeof buildFixture>>) {
  const reader = app.rawReader;
  const out: Record<string, unknown> = {};

  for (const type of ['design-system', 'ui-view']) {
    const module = app.host.getEntity(type);
    if (!module) throw new Error(`fixture: type '${type}' is not registered`);
    const serializer = module.serializer as Record<string, unknown>;
    const views = serializer.views as ViewSet<unknown> | undefined;
    const slugs = (
      app.db
        .prepare(`SELECT slug FROM ${compositionOf(module).mainTable} ORDER BY slug`)
        .all() as Array<{ slug: string }>
    ).map((r) => r.slug);

    out[`${type}.payloadVersion`] = module.payloadVersion;
    for (const slug of slugs) {
      const raw = app.rawReader.getEntity(type, slug);
      if (!raw) throw new Error(`fixture: ${type} '${slug}' vanished`);

      // The stamp envelope is wall-clock, so it is stripped rather than
      // golden'd; its presence is covered by `snapshot-parity`.
      const { createdAt: _c, updatedAt: _u, ...snap } = app.host.snapshot(type, raw, reader) as Record<
        string,
        unknown
      >;
      out[`${type}/${slug}/snapshot`] = canonicalize(snap);
      for (const view of VIEWS) {
        const fn = views?.[view];
        // Falls back to `genericEntity` rather than recording `null`, and passes
        // the SCHEMA as `SerializationEngine` does — without it `genericEntity`
        // short-circuits its column→field re-keying and the golden would record
        // a snake_case shape the engine never emits.
        //
        // NOT canonicalized: view projections are handed to the client as-is, so
        // their key order is part of the contract in a way the snapshot's is not.
        out[`${type}/${slug}/${view}`] = fn
          ? fn(raw, reader)
          : genericEntity(raw, view, module.data?.schema);
      }
    }
  }
  return out;
}

describe('L9 serialization goldens — ui-view + design-system', () => {
  it('matches the committed goldens byte for byte', async () => {
    const app = await buildFixture();
    try {
      const actual = JSON.stringify(projections(app), null, 2) + '\n';
      const file = path.join(GOLDEN_DIR, 'frontend-mockups.json');

      if (process.env.UPDATE_GOLDENS === '1') {
        fs.mkdirSync(GOLDEN_DIR, { recursive: true });
        fs.writeFileSync(file, actual);
      }
      expect(fs.readFileSync(file, 'utf-8')).toBe(actual);
    } finally {
      app.cleanup();
    }
  });
});
