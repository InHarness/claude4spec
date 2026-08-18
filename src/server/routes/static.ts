import { Router } from 'express';
import { StaticHtmlService, StaticPathTraversalError } from '../services/static-html.js';

/**
 * M30 (L4): `GET /api/static/:rootId/*` — raw static file server rooted at a
 * page root's dir (0.1.96: was the single `pagesDir`). Each request resolves the
 * root's `StaticHtmlService` via `resolveStatic(req.params.rootId)`; unknown id →
 * 404 ROOT_NOT_FOUND.
 *
 * Returns the raw bytes of the file (NOT a `{ data }` envelope), with `Content-Type`
 * inferred from the extension by Express's built-in `send`/mime. Path-traversal ⇒ 403,
 * missing file ⇒ 404. Same origin as the app.
 *
 * 0.2.28 — ISOLATION, corrected. This used to say isolation was enforced by the
 * `sandbox` ATTRIBUTE on `HtmlViewer`'s iframe, "independently of the shared
 * port". That was too strong: the attribute exists only inside an `<iframe>`,
 * so it holds only while the document is being viewed in that frame. Open the
 * same URL top-level — typed by hand, or followed from a link — and the
 * document gets the app's FULL ORIGIN with no isolation at all. Closing that
 * gap needs a response header, which is what the CSP below is; it is the same
 * pattern the `ui-view` mockup document uses, and it buys the isolation without
 * moving the server to a separate port.
 */
export function staticRouter(
  resolveStatic: (rootId: string) => StaticHtmlService | undefined,
): Router {
  const router = Router({ mergeParams: true });

  router.get('/*', async (req, res, next) => {
    try {
      const rootId = (req.params as Record<string, string>).rootId ?? '';
      const staticHtml = resolveStatic(rootId);
      if (!staticHtml) {
        return res.status(404).json({ error: { code: 'ROOT_NOT_FOUND', message: `root '${rootId}' not found` } });
      }
      const relPath = (req.params as Record<string, string>)[0];
      if (!relPath) return res.status(400).json({ error: 'missing path' });

      let abs: string;
      try {
        abs = staticHtml.resolveSafe(relPath);
      } catch (err) {
        if (err instanceof StaticPathTraversalError) {
          return res.status(403).json({ error: 'forbidden' });
        }
        throw err;
      }

      if (!(await staticHtml.existsFile(abs))) {
        return res.status(404).json({ error: 'not found' });
      }

      // Defense-in-depth: stop the browser from MIME-sniffing the response.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // The real isolation contract — enforcing form, and a header rather than
      // an iframe attribute so it survives a top-level open (see above). No
      // `allow-same-origin`: the document gets an opaque origin. `allow-forms`
      // and `allow-modals` are kept on purpose — dropping them would not harden
      // anything, it would silently break a static page with a form or a
      // `confirm()`. `HtmlViewer`'s narrower attribute still intersects with
      // this, so nothing here loosens what the viewer already enforces.
      res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals');
      res.sendFile(abs, (err) => {
        if (err && !res.headersSent) next(err);
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
