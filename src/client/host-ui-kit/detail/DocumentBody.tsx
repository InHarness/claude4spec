import type { ReactNode } from 'react';
import { withStability } from '../stability.js';

/**
 * `DocumentBody` (Panel detalu, `experimental`) — sibling of `FieldGrid`: a
 * freeform single-column "document" layout (large inline-editable title +
 * loose-flowing content) instead of a `label`↔`value` grid. Styled with the
 * token bridge's typography set (`--text-h1`/`--font-heading` for the title,
 * `--text-lede`/`--text-body` for content) so it matches the host's own
 * `.prose-spec` scale. Contributed by M13.
 */
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
      <div
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-body)',
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
