import { getEntityDef } from './registry.js';

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
}: {
  type: string;
  slug: string;
  /**
   * 0.2.15 — optional, matching `EntityChipProps.onOpen`. `undefined` is the
   * "clicking does nothing" case: a broken reference, or an embed-only type
   * rendered where no overlay host is mounted.
   */
  onOpen?: () => void;
}) {
  const def = getEntityDef(type)!;
  const { data, isLoading } = def.useGetBySlug(slug);
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
