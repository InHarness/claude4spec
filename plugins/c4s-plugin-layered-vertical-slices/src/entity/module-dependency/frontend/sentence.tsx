/**
 * The one visual idea this type has, in one place: an edge READS AS A SENTENCE —
 * *dependent* **wymaga od** *provider*.
 *
 * Row, card and overlay all draw it, and they draw the same one. Composed from
 * the Host UI Kit's `Badge` and nothing local: the two module identifiers are
 * the only thing a reader scans for, so they are the only thing emphasised.
 */

import type { FC } from 'react';
import { Badge } from '@c4s/plugin-runtime/ui';

export const DependencySentence: FC<{ dependent: string; provider: string; small?: boolean }> = ({
  dependent,
  provider,
  small = true,
}) => (
  <span className="inline-flex items-center gap-1.5">
    <Badge label={dependent} mono small={small} />
    <span className="text-[12px]" style={{ color: 'var(--c-muted)' }}>
      wymaga od
    </span>
    <Badge label={provider} mono small={small} />
  </span>
);
