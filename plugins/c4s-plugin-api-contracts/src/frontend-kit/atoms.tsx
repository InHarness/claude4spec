/**
 * `MethodChip` is no longer a debt entry (struck in 2.1.20): it binds the
 * method → colour/label mapping to the catalog's `Badge` (a value marker) and
 * draws nothing of its own.
 *
 * 2.1.39: the package's local tag chip (recorded as debt in 2.1.19) is gone —
 * the catalog now has a `TagChip` of its own, and a plugin must not define a
 * component under a catalog name. Tag chips come from `@c4s/plugin-runtime/ui`.
 */
import type { HttpMethod } from '../types.js';
import type { Tag } from '@c4s/plugin-runtime';
import { Badge, TagChip } from '@c4s/plugin-runtime/ui';

export const METHOD_STYLE: Record<
  HttpMethod,
  { bg: string; fg: string; label: string }
> = {
  GET: { bg: 'var(--c-blue-soft)', fg: 'var(--c-blue)', label: 'GET' },
  POST: { bg: 'var(--c-green-soft)', fg: 'var(--c-green)', label: 'POST' },
  PUT: { bg: 'var(--c-purple-soft)', fg: 'var(--c-purple)', label: 'PUT' },
  PATCH: { bg: 'var(--c-yellow)', fg: 'var(--c-yellow-ink)', label: 'PATCH' },
  DELETE: { bg: 'var(--c-red-soft)', fg: 'var(--c-red)', label: 'DEL' },
};

interface MethodChipProps {
  method: HttpMethod;
  large?: boolean;
}

/**
 * HTTP method chip. Delegates to the Host UI Kit's `Badge` (M34/L12,
 * `experimental`): `Badge` owns the pill styling; this binds the method →
 * label/ink mapping (`METHOD_STYLE`) to it. Since 2.1.39 `Badge` is a plain
 * value marker, so only the ink (`fg`) carries the method colour.
 */
export function MethodChip({ method, large = false }: MethodChipProps) {
  const s = METHOD_STYLE[method] ?? METHOD_STYLE.GET;
  return <Badge label={s.label} foreground={s.fg} mono small={!large} minWidth={large ? 56 : 42} />;
}

/**
 * 2.1.40 — a `renderRow` slot's tag strip: the record's tags as catalog
 * `TagChip`s in the colours of the `tagLookup` the host handed the slot (never
 * one built from `useTags` — a slot does not fetch). A tag missing from the map
 * shows its slug in the default colour.
 */
export function RowTagChips({ tags, tagLookup }: { tags: string[]; tagLookup: ReadonlyMap<string, Tag> }) {
  if (tags.length === 0) return null;
  return (
    <span className="shrink-0 flex items-center gap-1 flex-wrap" data-testid="row-tags">
      {tags.map((ts) => {
        const tag = tagLookup.get(ts);
        return <TagChip key={ts} label={tag?.name ?? ts} color={tag?.color ?? undefined} small />;
      })}
    </span>
  );
}
