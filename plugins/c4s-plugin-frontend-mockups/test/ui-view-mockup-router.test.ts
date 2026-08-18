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
