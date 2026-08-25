import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uiViewMockupRouter } from '../src/entity/ui-view/backend/routes.js';
import type { MockupMountContext } from '../src/host-kit/host-types.js';

/**
 * The router's DEGRADATION paths, driven through a stub `MountContext`.
 *
 * These two cases cannot be reached from `tests/integration/api/` — one needs a
 * project whose `config.entities` omits `design-system`, the other a config file
 * with a hostile `language` — so the context is faked here instead. Both assert
 * the same property: the route's contract is a DOCUMENT, and neither a
 * deactivated type nor a malformed config may turn it into an error.
 */
function ctxWith(over: Partial<MockupMountContext> & { cwd?: string }): MockupMountContext {
  return {
    cwd: over.cwd ?? tmpdir(),
    reader: {
      getEntity: () => ({ slug: 'profile', data: { title: 'Profile', design_system_slug: 'brand', mockup_html: '<p>hi</p>' } }),
      ...(over.reader ?? {}),
    },
    host: { getEntityService: () => ({ stylesheetFor: () => 'body{}' }), ...(over.host ?? {}) },
    discovery: over.discovery ?? (() => ({ getEntities: () => ({ results: [] }) })),
  } as unknown as MockupMountContext;
}

function appWith(ctx: MockupMountContext) {
  const app = express();
  app.use('/ui-views', uiViewMockupRouter(ctx));
  return app;
}

describe('ui-view mockup router — degradation', () => {
  it('answers with the document when design-system is not an active type', async () => {
    // `getEntities` calls `requireActiveType` and THROWS `INVALID_TYPE` when the
    // type is missing from `config.entities`. `dependsOn` is a soft ordering
    // hint, not referential integrity, so this project is reachable — and it
    // must see the documented degradation, not a JSON error.
    const ctx = ctxWith({
      discovery: () => {
        throw Object.assign(new Error('INVALID_TYPE'), { code: 'INVALID_TYPE' });
      },
    });
    const res = await request(appWith(ctx)).get('/ui-views/profile/mockup');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<p>hi</p>');
    // Unreadable and absent are the same story to a reader: no tokens.
    expect(res.text).toMatch(/<!--[\s\S]*?not found/);
  });

  it('falls back to `en` when config.language names an Object.prototype key', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'c4s-mockup-'));
    mkdirSync(join(cwd, '.claude4spec'), { recursive: true });
    writeFileSync(join(cwd, '.claude4spec', 'config.json'), JSON.stringify({ language: 'toString' }));
    const res = await request(appWith(ctxWith({ cwd }))).get('/ui-views/profile/mockup');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="en">');
  });
});

/**
 * The variant query params — the route's SECOND input channel, and the only one
 * whose value ends up inside an attribute the server itself writes.
 *
 * Every case here asserts the same property from a different angle: the
 * resource is a DOCUMENT, so no input to it may produce a status other than
 * `200`. The whitelist drops what it cannot vouch for, and an undeclared but
 * well-formed name is answered with a comment rather than an error.
 */
describe('ui-view mockup router — variant query params', () => {
  /** A view declaring one state, pointing at a design system with one mode. */
  function variantCtx(): MockupMountContext {
    return ctxWith({
      reader: {
        getEntity: () => ({
          slug: 'profile',
          data: {
            title: 'Profile',
            design_system_slug: 'brand',
            mockup_html: '<p>hi</p>',
            // Already DECODED: `decodeColumn` JSON-parses an embedded collection
            // before the row ever reaches a reader, so this is the real shape.
            states: [{ name: 'empty', label: 'Empty' }],
          },
        }),
      },
      discovery: () => ({
        getEntities: () => ({
          results: [
            {
              slug: 'brand',
              entity: { groups: [], modes: [{ name: 'dark', overrides: [] }] },
            },
          ],
        }),
      }),
    } as unknown as Partial<MockupMountContext>);
  }

  const get = (query: string) => request(appWith(variantCtx())).get(`/ui-views/profile/mockup${query}`);

  it('sets both attributes on <html> for declared variants', async () => {
    const res = await get('?state=empty&mode=dark');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-preview-state="empty"');
    expect(res.text).toContain('data-preview-mode="dark"');
    expect(res.text).not.toContain('is not declared');
    expect(res.text).not.toContain('is not a mode');
  });

  it('drops a value outside the whitelist as if the param were absent', async () => {
    // NOT a 400, and NOT an escaped attribute: the character class is a
    // security boundary, and a value that fails it is treated as no parameter
    // at all so nothing hostile reaches the attribute in any form.
    const res = await get('?state=%3Cscript%3E&mode=dark');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('data-preview-state');
    expect(res.text).toContain('data-preview-mode="dark"');
  });

  it('drops an over-long value — the length cap is part of the boundary', async () => {
    const res = await get(`?state=${'a'.repeat(200)}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('data-preview-state');
  });

  it('drops a repeated param, which Express hands back as an array', async () => {
    const res = await get('?state=empty&state=other');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('data-preview-state');
  });

  it('emits an undeclared-but-safe state verbatim, with a warning comment', async () => {
    const res = await get('?state=loading');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-preview-state="loading"');
    expect(res.text).toMatch(/<!--[^>]*state 'loading' is not declared/);
  });

  it('emits an undeclared-but-safe mode verbatim, with a warning comment', async () => {
    const res = await get('?mode=neon');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-preview-mode="neon"');
    expect(res.text).toMatch(/<!--[^>]*mode 'neon' is not a mode/);
  });

  it('treats every mode as unknown when the view has no design system', async () => {
    // No design system means no mode vocabulary, so the case needs no branch of
    // its own — an empty list makes every name undeclared.
    const ctx = ctxWith({
      reader: {
        getEntity: () => ({
          slug: 'profile',
          data: { title: 'Profile', mockup_html: '<p>hi</p>', states: '[]' },
        }),
      },
    });
    const res = await request(appWith(ctx)).get('/ui-views/profile/mockup?mode=dark');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-preview-mode="dark"');
    expect(res.text).toMatch(/<!--[^>]*mode 'dark' is not a mode/);
  });

  it('accepts the raw JSON string too, for a reader that hands back the column verbatim', async () => {
    const ctx = ctxWith({
      reader: {
        getEntity: () => ({
          slug: 'profile',
          data: {
            title: 'Profile',
            mockup_html: '<p>hi</p>',
            states: JSON.stringify([{ name: 'empty' }]),
          },
        }),
      },
    });
    const res = await request(appWith(ctx)).get('/ui-views/profile/mockup?state=empty');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-preview-state="empty"');
    expect(res.text).not.toContain('is not declared');
  });

  it('survives a states column that is not parseable JSON', async () => {
    const ctx = ctxWith({
      reader: {
        getEntity: () => ({
          slug: 'profile',
          data: { title: 'Profile', mockup_html: '<p>hi</p>', states: 'not json' },
        }),
      },
    });
    const res = await request(appWith(ctx)).get('/ui-views/profile/mockup?state=empty');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-preview-state="empty"');
  });
});
