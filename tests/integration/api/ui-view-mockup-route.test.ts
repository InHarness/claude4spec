import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';

/**
 * `GET /api/ui-views/:slug/mockup` — the mockup document.
 *
 * The first domain route `ui-view` contributes, and the first place in the
 * envelope where one type consumes another type's service (the design system's
 * CSS generator, in-process through `getEntityService`).
 */
describe('ui-view mockup document', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  const MOCKUP = '<main><h1>Profil użytkownika</h1></main>';

  async function seedView(over: Record<string, unknown> = {}) {
    const res = await request(t.app)
      .post('/api/ui-views')
      .send({ title: 'User Profile', ...over });
    expect(res.status).toBe(201);
    return res.body.data.slug as string;
  }

  async function withMockup(slug: string, mockupHtml: string | null) {
    const res = await request(t.app).patch(`/api/ui-views/${slug}`).send({ mockupHtml });
    expect(res.status).toBe(200);
  }

  describe('status', () => {
    it('answers 200 for a view with no mockup and no design system', async () => {
      const slug = await seedView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup`);
      expect(res.status).toBe(200);
      // A placeholder, NOT a 404: the address has to stay stable so the detail
      // panel's frame shows an empty state rather than a browser error page.
      expect(res.text).toContain('data-mockup-placeholder');
    });

    it('answers 404 for a slug that does not exist', async () => {
      expect((await request(t.app).get('/api/ui-views/nope/mockup')).status).toBe(404);
    });

    /** Two segments, so it cannot shadow the generated `GET /:slug`. */
    it('leaves the generated CRUD read untouched', async () => {
      const slug = await seedView();
      const res = await request(t.app).get(`/api/ui-views/${slug}`);
      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe(slug);
    });
  });

  describe('headers — all four, none optional', () => {
    it('serves html, nosniff, an enforcing sandbox CSP and no-store', async () => {
      const slug = await seedView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup`);
      expect(res.headers['content-type']).toMatch(/^text\/html; charset=utf-8/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe(
        'sandbox allow-scripts allow-forms allow-modals',
      );
      expect(res.headers['cache-control']).toBe('no-store');
    });

    /**
     * The single most important assertion in this file. `allow-same-origin`
     * would hand the document the app's own origin back, which is the entire
     * thing the header exists to prevent.
     */
    it('never grants allow-same-origin, popups-to-escape or top-navigation', async () => {
      const slug = await seedView();
      const csp = (await request(t.app).get(`/api/ui-views/${slug}/mockup`)).headers[
        'content-security-policy'
      ];
      expect(csp).not.toContain('allow-same-origin');
      expect(csp).not.toContain('allow-popups-to-escape-sandbox');
      expect(csp).not.toContain('allow-top-navigation');
    });

    /** Report-Only enforces nothing; the sandbox directive would be decorative. */
    it('is never delivered in the report-only form', async () => {
      const slug = await seedView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup`);
      expect(res.headers['content-security-policy-report-only']).toBeUndefined();
      // …nor via <meta>, which cannot carry `sandbox` at all.
      expect(res.text).not.toContain('http-equiv');
    });

    /**
     * `script-src` would kill the very material being served — this document
     * requires inline-script and inline-style semantics by construction.
     */
    it('hardens through sandbox, never through script-src', async () => {
      const slug = await seedView();
      const csp = (await request(t.app).get(`/api/ui-views/${slug}/mockup`)).headers[
        'content-security-policy'
      ];
      expect(csp).not.toContain('script-src');
    });
  });

  describe('the body is a document, not an envelope', () => {
    it('returns raw HTML rather than { data }', async () => {
      const slug = await seedView();
      await withMockup(slug, MOCKUP);
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup`);
      expect(res.text.startsWith('<!doctype html>')).toBe(true);
      expect(() => JSON.parse(res.text)).toThrow();
    });

    it('writes mockupHtml literally, byte for byte', async () => {
      const slug = await seedView();
      await withMockup(slug, MOCKUP);
      expect((await request(t.app).get(`/api/ui-views/${slug}/mockup`)).text).toContain(MOCKUP);
    });

    it('loads no CSS subresource — the sheet is inline', async () => {
      const slug = await seedView();
      const text = (await request(t.app).get(`/api/ui-views/${slug}/mockup`)).text;
      expect(text).toContain('<style>');
      expect(text).not.toContain('<link');
    });
  });

  describe('composition with a design system', () => {
    async function seedDs() {
      const res = await request(t.app)
        .post('/api/design-systems')
        .send({
          title: 'Brand',
          groups: [
            {
              name: 'Brand',
              tier: 'primitive',
              tokens: [{ name: 'blue-500', type: 'color', value: '#2563eb' }],
            },
          ],
          modes: [{ name: 'dark', overrides: [{ token: 'blue-500', value: '#1e3a8a' }] }],
        });
      expect(res.status).toBe(201);
      return res.body.data.slug as string;
    }

    it('inlines the tokens and one block per mode', async () => {
      const ds = await seedDs();
      const slug = await seedView({ designSystemSlug: ds });
      const text = (await request(t.app).get(`/api/ui-views/${slug}/mockup`)).text;
      expect(text).toContain('--blue-500: #2563eb;');
      expect(text).toContain('[data-preview-mode="dark"]');
      expect(text).toContain('--blue-500: #1e3a8a;');
    });

    /**
     * `onMissing: 'warn'` — and the comment is not decoration. A document with
     * no tokens renders fine and is indistinguishable from a mockup that was
     * meant to be unstyled, so this is the only signal the relation is broken.
     */
    it('degrades to 200 plus a warning comment when the design system is gone', async () => {
      const slug = await seedView({ designSystemSlug: 'never-existed' });
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('never-existed');
      expect(res.text).toMatch(/<!--[\s\S]*?not found/);
    });

    it('serves the reset alone when there is no design system at all', async () => {
      const slug = await seedView();
      const text = (await request(t.app).get(`/api/ui-views/${slug}/mockup`)).text;
      expect(text).toContain('box-sizing');
      expect(text).not.toContain(':root');
    });
  });

  /**
   * The route is a DIFFERENT resource with a different subject; it must not
   * become a second door onto the field's raw value.
   */
  describe('the contentBearing read path is untouched', () => {
    it('still keeps mockupHtml out of records, descriptors instead', async () => {
      const slug = await seedView();
      await withMockup(slug, MOCKUP);
      const res = await request(t.app).get(`/api/ui-views/${slug}`);
      expect(res.body.data).not.toHaveProperty('mockupHtml');
      expect(res.body.data.hasMockupHtml).toBe(true);
      expect(res.body.data.mockupHtmlBytes).toBe(Buffer.byteLength(MOCKUP, 'utf8'));
    });

    it('still serves the raw value only through the supervised content route', async () => {
      const slug = await seedView();
      await withMockup(slug, MOCKUP);
      const res = await request(t.app).get(`/api/entities/ui-view/${slug}/content/mockupHtml`);
      expect(res.status).toBe(200);
      expect(res.body.content).toBe(MOCKUP);
    });
  });
});
