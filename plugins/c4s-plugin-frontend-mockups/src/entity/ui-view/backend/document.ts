/**
 * The mockup DOCUMENT — the pure composition half of `GET /:slug/mockup`.
 *
 * The order of the elements is a CONTRACT, not an implementation detail:
 *
 *   1. `<!doctype html>`
 *   2. `<head>` — `<meta charset>`, `<title>` from the view, then the whole
 *      sheet as an inline `<style>`
 *   3. `<body>` — `mockupHtml`, verbatim
 *   4. a reserved slot for `<script>` as the LAST element of `<body>`, empty
 *      today, held for a future preview-state harness
 *
 * The sheet is INLINE rather than a second resource for three reasons:
 * atomicity (document and tokens come from one read, so there is no window in
 * which the two disagree), no FOUC (the mockup arrives already styled), and
 * self-sufficiency (saved to a file, the document still renders). Loading this
 * document must not produce a single subresource request for CSS.
 *
 * `mockupHtml` is a BODY FRAGMENT and is pasted verbatim — not parsed, not
 * validated, not repaired, per the literal-write rule. An author who pastes
 * their own `<html>`/`<head>` gets a nested document; that is their choice, not
 * a server error.
 *
 * Nothing here sanitizes, and nothing here should: the isolation contract for
 * this document is the route's `Content-Security-Policy: sandbox` header, and
 * only that. See `routes.ts`.
 */

/** Escape for TEXT/attribute context — used on the title, never on the mockup. */
function escapeText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Neutralise every sequence that ends an HTML comment, so a design-system slug
 * cannot break out of the warning below.
 *
 * TWO terminators, not one: the tokenizer's comment-end state closes on `-->`,
 * and its comment-end-BANG state closes on `--!>` as well. `designSystemSlug`
 * is a free string with no slug pattern (dangling refs are legal), so both are
 * reachable by a plain `PATCH`. The `<` escape below already blocks tag
 * injection; without the `--!>` case the escape merely leaks the warning's tail
 * as character data in `<head>`, which shunts the parser into `<body>` ahead of
 * the `<style>` element.
 */
function escapeComment(raw: string): string {
  return raw.replace(/--+!?>/g, (m) => m.replace(/>/, '&gt;')).replace(/</g, '&lt;');
}

/**
 * The body shown when the view has no `mockupHtml`.
 *
 * A placeholder rather than a `404`, because the ADDRESS IS STABLE: the detail
 * panel's frame points here from the moment the view exists, and an empty state
 * inside the frame is what a person should see — not the browser's own error
 * page, which is what a 404 into an iframe actually renders.
 */
const PLACEHOLDER = '<p data-mockup-placeholder>No mockup yet for this view.</p>';

export interface MockupDocumentInput {
  /** The view's `title` — the document's `<title>`. */
  title: string;
  /** The view's `mockupHtml`, or null/empty when it has none. */
  mockupHtml: string | null;
  /** The generated token sheet — at minimum the reset. */
  stylesheet: string;
  /** BCP-47 tag for `<html lang>`. */
  lang: string;
  /**
   * Set when `designSystemSlug` points at a design system that is not there.
   *
   * This warning is the whole reason the case is visible at all: a document
   * with no tokens renders perfectly well and is INDISTINGUISHABLE from a
   * mockup that was meant to be unstyled. The comment is the only signal.
   */
  missingDesignSystemSlug?: string | null;
}

export function renderMockupDocument(input: MockupDocumentInput): string {
  const warning = input.missingDesignSystemSlug
    ? `\n<!-- claude4spec: design system '${escapeComment(input.missingDesignSystemSlug)}' ` +
      `not found — this mockup is rendered WITHOUT tokens (broken relation) -->`
    : '';

  const body = input.mockupHtml && input.mockupHtml.length > 0 ? input.mockupHtml : PLACEHOLDER;

  return (
    `<!doctype html>\n` +
    `<html lang="${escapeText(input.lang)}">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<title>${escapeText(input.title)}</title>${warning}\n` +
    `<style>\n${input.stylesheet}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `${body}\n` +
    // Reserved, and empty by design — the future preview-state harness goes
    // here, LAST, so it runs after the mockup's own markup exists.
    `<!-- claude4spec: preview harness slot -->\n` +
    `</body>\n` +
    `</html>\n`
  );
}
