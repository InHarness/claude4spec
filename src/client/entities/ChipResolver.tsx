import { useEffect } from 'react';
import { getEntityDef } from './registry.js';
import { HostCard } from './HostCard.js';
import { isMissingEntity } from '../state/brokenRefs.js';

/**
 * Self-fetching chip resolver — the single place the host resolves an entity
 * `slug` into data for a pure-presentational `renderChip`. Both render pipelines
 * (tiptap NodeView and chat react-markdown) mount THIS component instead of
 * re-implementing the fetch: it calls the module's registered `useGetBySlug`,
 * shows a skeleton pill while loading, then injects `{ slug, entity }` into the
 * plugin's `renderChip`. The shared QueryClient dedupes by `queryKey`, so N
 * chips of the same slug across both pipelines = 1 fetch.
 *
 * Caller guarantees `getEntityDef(type)` is non-null (broken/unknown types are
 * handled upstream with a broken chip before reaching here).
 */
export function ChipResolver({
  type,
  slug,
  onOpen,
  onMissing,
}: {
  type: string;
  slug: string;
  /**
   * 0.2.15 — optional, matching `EntityChipProps.onOpen`. `undefined` is the
   * "clicking does nothing" case: a broken reference, or an embed-only type
   * rendered where no overlay host is mounted.
   */
  onOpen?: () => void;
  /** 0.2.110 M19 — told whether the entity turned out to be missing. */
  onMissing?: (missing: boolean) => void;
}) {
  const def = getEntityDef(type)!;
  const result = def.useGetBySlug(slug);
  const { data, isLoading } = result;
  const missing = isMissingEntity(result);
  useEffect(() => {
    onMissing?.(missing);
  }, [missing, onMissing]);
  if (isLoading && data === undefined) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        {slug}…
      </span>
    );
  }
  const Chip = def.renderChip;
  return <Chip slug={slug} entity={data ?? null} onOpen={onOpen} />;
}

/**
 * The card half of the host-resolver (2.1.63, M13 chipprops): resolves the
 * entity the same way, then injects into the type's `renderCard` the
 * `EntityCardProps` the reference carries — `caption` only when the tag has the
 * attribute (absent attribute = absent prop, never `''`), and
 * `onCaptionChange` only when the caller can write the reference back (the
 * editor node view). A read-only caller passes neither, so the slot gets no
 * callback. `refLookup` is added by `HostCard`.
 */
export function CardResolver({
  type,
  slug,
  caption,
  onOpen,
  onCaptionChange,
  onMissing,
}: {
  type: string;
  slug: string;
  caption?: string;
  onOpen?: () => void;
  onCaptionChange?: (caption: string | null) => void;
  onMissing?: (missing: boolean) => void;
}) {
  const def = getEntityDef(type)!;
  const result = def.useGetBySlug(slug);
  const { data, isLoading } = result;
  const missing = isMissingEntity(result);
  useEffect(() => {
    onMissing?.(missing);
  }, [missing, onMissing]);
  if (isLoading && data === undefined) {
    return (
      <div
        className="rounded-md p-3 text-[12.5px]"
        style={{ background: 'var(--c-panel)', color: 'var(--c-subtle)' }}
      >
        Loading {def.label} {slug}…
      </div>
    );
  }
  return (
    <HostCard
      type={type}
      card={def.renderCard}
      slug={slug}
      entity={data ?? null}
      onOpen={onOpen}
      {...(caption !== undefined ? { caption } : {})}
      {...(onCaptionChange ? { onCaptionChange } : {})}
    />
  );
}
