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
   * The token name → custom property name mapping, end to end through the route.
   *
   * It is asserted HERE and not only on the generator because the name is a
   * PUBLIC contract: a mockup derives `var(--heading-1-fontSize)` from the token
   * record alone, never by reading the sheet back. A `var()` naming a property
   * that was never emitted fails silently — no error, just wrong styling — so
   * the mapping needs a test that fails loudly instead.
   */
  describe('token name → custom property name', () => {
    async function seedNamingDs(tokens: unknown[]) {
      const res = await request(t.app)
        .post('/api/design-systems')
        .send({
          title: 'Naming',
          groups: [{ name: 'Naming', tier: 'primitive', tokens }],
          modes: [],
        });
      expect(res.status).toBe(201);
      return res.body.data.slug as string;
    }

    async function sheetFor(tokens: unknown[]) {
      const ds = await seedNamingDs(tokens);
      const slug = await seedView({ designSystemSlug: ds });
      return (await request(t.app).get(`/api/ui-views/${slug}/mockup`)).text;
    }

    it('[ac:ac-token-typography-o-nazwie-heading-1-d] flattens a composite per field, key verbatim, and leaves a scalar name alone', async () => {
      const text = await sheetFor([
        { name: 'space-4', type: 'dimension', value: '16px' },
        {
          name: 'heading-1',
          type: 'typography',
          value: {
            fontFamily: 'Inter, sans-serif',
            fontSize: '32px',
            fontWeight: '700',
            lineHeight: '1.2',
            letterSpacing: '-0.02em',
          },
        },
      ]);

      // One property per FIELD, the key carried over character for character.
      expect(text).toContain('--heading-1-fontSize: 32px;');
      expect(text).toContain('--heading-1-lineHeight: 1.2;');

      // Not kebab-cased on the way in — this is the form a mockup would guess
      // if it assumed CSS convention rather than reading the contract.
      expect(text).not.toContain('--heading-1-font-size');
      expect(text).not.toContain('--heading-1-line-height');

      // And no collective declaration: the generator knows no type's field
      // ORDER or separators, so it composes no shorthand for the author.
      expect(text).not.toMatch(/--heading-1:/);

      // The scalar half of the same rule: verbatim, unprefixed.
      expect(text).toContain('--space-4: 16px;');
    });

    it('[ac:ac-klucz-pola-tokenu-composite-ze-znakie] drops only the offending field of a composite, never the whole token', async () => {
      const text = await sheetFor([
        {
          name: 'shadow-card',
          type: 'shadow',
          value: {
            offsetX: '0px',
            offsetY: '2px',
            'blur.radius': '8px',
            'spread size': '0px',
            color: 'rgba(0,0,0,0.2)',
          },
        },
      ]);

      // The two unusable keys leave nothing behind — not a declaration, not a
      // comment. Silent, by design.
      expect(text).not.toContain('blur.radius');
      expect(text).not.toContain('spread size');

      // ...while their siblings emit exactly as if nothing had happened. This
      // per-FIELD granularity is what separates this case from a bad token
      // NAME, which takes the whole token with it.
      expect(text).toContain('--shadow-card-offsetX: 0px;');
      expect(text).toContain('--shadow-card-offsetY: 2px;');
      expect(text).toContain('--shadow-card-color: rgba(0,0,0,0.2);');
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

  /**
   * The two variant axes, end to end — 0.2.49.
   *
   * The route took NO query parameters until this release, and the property
   * every case here shares is that it still cannot be made to answer anything
   * but `200`. A parameter is either honoured, dropped as if it were never
   * sent, or honoured-with-a-warning; there is no fourth outcome and no `400`.
   */
  describe('variant query params', () => {
    async function seedVariantDs() {
      const res = await request(t.app)
        .post('/api/design-systems')
        .send({
          title: 'Variant',
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

    /** A view with one declared state, attached to a design system with one mode. */
    async function seedVariantView() {
      const ds = await seedVariantDs();
      const slug = await seedView({
        designSystemSlug: ds,
        states: [{ name: 'empty', label: 'Empty', description: 'Nothing matched the filter.' }],
      });
      await withMockup(slug, MOCKUP);
      return slug;
    }

    it('carries states[] through create and back out in the read record', async () => {
      // Unlike `mockupHtml`, `states[]` is ordinary read-surface data: it has no
      // `contentBearing` flag, so it travels inline in the record.
      const slug = await seedVariantView();
      const res = await request(t.app).get(`/api/ui-views/${slug}`);
      expect(res.body.data.states).toEqual([
        { name: 'empty', label: 'Empty', description: 'Nothing matched the filter.' },
      ]);
    });

    it('accepts states[] and mockupHtml in ONE patch', async () => {
      // The atomicity the generator skill promises: split across two calls the
      // entity is momentarily inconsistent — a mockup illustrating a state the
      // view does not declare, or the reverse.
      const slug = await seedView();
      const res = await request(t.app)
        .patch(`/api/ui-views/${slug}`)
        .send({ states: [{ name: 'loading' }], mockupHtml: MOCKUP });
      expect(res.status).toBe(200);
      expect(res.body.data.states).toEqual([{ name: 'loading' }]);
      expect(res.body.data.hasMockupHtml).toBe(true);
    });

    it('rejects null for states[] — an empty array is its empty, not null', async () => {
      // No `clearable` flag, so the generated update shape has no null arm.
      const slug = await seedView();
      const res = await request(t.app).patch(`/api/ui-views/${slug}`).send({ states: null });
      expect(res.status).toBe(400);
    });

    it('sets both attributes on <html> for declared variants', async () => {
      const slug = await seedVariantView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup?state=empty&mode=dark`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('data-preview-state="empty"');
      expect(res.text).toContain('data-preview-mode="dark"');
      // The generator was NOT touched: the mode block was already in the sheet
      // and element-agnostic, so the route only activates what is there.
      expect(res.text).toContain('[data-preview-mode="dark"]');
      expect(res.text).not.toContain('is not declared');
    });

    it('never puts the attributes on <body>', async () => {
      // A mode override redefines custom properties, and it has to cascade over
      // everything the author wrote — the root element is the only ancestor
      // guaranteed to be above all of it.
      const slug = await seedVariantView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup?mode=dark`);
      expect(res.text).toContain('<body>');
      expect(res.text).not.toContain('<body data-preview');
    });

    it('drops a value outside the whitelist and still answers 200', async () => {
      const slug = await seedVariantView();
      const res = await request(t.app).get(
        `/api/ui-views/${slug}/mockup?state=${encodeURIComponent('"><script>')}`,
      );
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('data-preview-state');
      expect(res.text).not.toContain('<script>');
    });

    it('emits an undeclared but well-formed variant verbatim, with a warning', async () => {
      const slug = await seedVariantView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup?state=loading&mode=neon`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('data-preview-state="loading"');
      expect(res.text).toContain('data-preview-mode="neon"');
      expect(res.text).toMatch(/<!--[^>]*state 'loading' is not declared/);
      expect(res.text).toMatch(/<!--[^>]*mode 'neon' is not a mode/);
    });

    it('leaves the headers exactly as they were', async () => {
      const slug = await seedVariantView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup?state=empty&mode=dark`);
      expect(res.headers['content-type']).toContain('text/html; charset=utf-8');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe(
        'sandbox allow-scripts allow-forms allow-modals',
      );
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('reserves no script slot any more', async () => {
      const slug = await seedVariantView();
      const res = await request(t.app).get(`/api/ui-views/${slug}/mockup`);
      expect(res.text).not.toContain('preview harness slot');
    });
  });
});
