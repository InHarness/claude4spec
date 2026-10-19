/**
 * Render slot `renderChip` — the inline-mention embed of a `database-table`.
 *
 * Takes `entity: DatabaseTable | null` and therefore owns a "broken" branch: a
 * reference whose target was deleted, or whose type is not active in
 * `config.entities`. `renderCard` owns one too — `EntityCardProps` extends
 * `EntityChipProps`, so the host passes it `null` just the same. Only `renderRow`
 * is guaranteed a resolved entity.
 *
 * Purely presentational: the host injects the already-resolved entity (resolved
 * through the module's `useGetBySlug` hook); the chip itself never fetches. It must
 * also survive the host's registration smoke test, which renders it with
 * `entity: null` OUTSIDE any provider — so no hooks and no editor context here.
 *
 * VISUAL CONTRACT — the host's own chip, byte-for-byte. Every native entity type
 * (`claude4spec/src/client/entities/{dto,ui-view,ac,endpoint,design-system}/plugin.tsx`)
 * shares one recipe, corroborated by `plugins-doc` `widoki-osadzane.md` (anchor
 * `b7fzdung`): a compact pill on `--c-card` inside a `--c-hair` hairline, 12px, the
 * type icon in `--c-accent`, `align-middle` so it sits on the text baseline, and a
 * hover that moves the border to `--c-hair-strong` (chips go to the hairline —
 * only CARDS hover to the accent). Broken is the catalog's `broken` `Badge` with
 * the slug and is not clickable (2.1.39, M13).
 *
 * Tailwind classes are copied verbatim from the host: `tailwind.config.js` scans
 * only `./src/client/**`, so a utility the host does not itself write is physically
 * absent from the served CSS. Colours are bare `var(--c-*)` — never a literal and
 * never a `var(--x, #fallback)`, which would silently pin a light-mode colour.
 */

import type { FC } from 'react';
import { editorBridge } from '@c4s/plugin-runtime';
import type { EntityChipProps } from '@c4s/plugin-runtime';
import { Badge } from '@c4s/plugin-runtime/ui';
import { DATABASE_TABLE_TYPE } from '../../../identity.js';
import type { DatabaseTable } from '../types.js';
import { DatabaseTableIcon } from './icon.js';

export const DatabaseTableChip: FC<EntityChipProps<DatabaseTable>> = ({ slug, entity, onOpen }) => {
  const open = () => (onOpen ? onOpen() : editorBridge.openEntity(DATABASE_TABLE_TYPE, slug));

  // 2.1.39 (M13): a broken chip is the catalog's broken `Badge` with the slug — not clickable.
  if (!entity) return <Badge variant="broken" label={slug} />;

  return (
    <button
      type="button"
      onClick={open}
      className="c4s-chip inline-flex items-center gap-1 align-middle rounded px-1.5 py-[1px] transition"
      style={{
        border: '1px solid var(--c-hair)',
        background: 'var(--c-card)',
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-hair-strong)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--c-hair)';
      }}
    >
      <DatabaseTableIcon size={11} style={{ color: 'var(--c-accent)' }} />
      <span style={{ color: 'var(--c-ink)' }}>{entity.title}</span>
    </button>
  );
};
