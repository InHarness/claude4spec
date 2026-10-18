import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `DocumentBody` (Panel detalu, `experimental`) — sibling of `FieldGrid`: a
 * freeform single-column "document" layout (large inline-editable title +
 * loose-flowing content) instead of a `label`↔`value` grid. Styled with the
 * token bridge's typography set — the entity style `heading-1` for the title,
 * `lede` and `body` for content (record `document-body`, 2.1.28) — so it
 * matches the host's own `.prose-spec` scale. Contributed by M13.
 *
 * ASSUMPTION:dev-2808 — content is `body`; a paragraph the consumer marks
 * `<p className="lede">` takes the `lede` style (the host's `.prose-spec
 * p.lede` convention). The record does not say how `lede` is selected.
 */

/** Scope attribute the content styles below hang on. */
const CONTENT_ATTR = 'data-c4s-document-body';

/**
 * The `lede` entity style on token-bridge variables (m34l12sc map: font
 * `--font-heading`, size `--text-lede`, weight `--weight-lede`, italic outside
 * the bridge).
 */
const LEDE_CSS = `[${CONTENT_ATTR}] p.lede{font-family:var(--font-heading);font-size:var(--text-lede);font-weight:var(--weight-lede);font-style:italic}`;
export interface DocumentBodyProps {
  title?: { value: string; onChange?(v: string): void; placeholder?: string };
  children: ReactNode;
  maxWidth?: number;
}

function DocumentBodyImpl({ title, children, maxWidth = 1000 }: DocumentBodyProps) {
  return (
    <div className="mx-auto flex flex-col gap-3" style={{ maxWidth, padding: '16px 32px 48px' }}>
      {title && (
        <input
          value={title.value}
          onChange={(e) => title.onChange?.(e.target.value)}
          readOnly={!title.onChange}
          placeholder={title.placeholder}
          className="w-full bg-transparent outline-none"
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 'var(--text-h1)',
            fontWeight: 'var(--weight-heading)',
            color: 'var(--c-ink)',
          }}
        />
      )}
      <style>{LEDE_CSS}</style>
      <div
        {...{ [CONTENT_ATTR]: '' }}
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-body)',
          fontWeight: 'var(--weight-body)',
          color: 'var(--c-ink)',
          lineHeight: 1.7,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const DocumentBody = withStability(DocumentBodyImpl, 'experimental');
