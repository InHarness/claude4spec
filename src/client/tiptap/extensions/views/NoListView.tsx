/**
 * 2.1.63 (M13 `z7l89jhf`, M19 `m19hidden`) — what `<element_list/>` and
 * `<tagged_list/>` render when their ACTIVE entity type declares no `renderRow`
 * slot: the type has no list view. One information block naming the type, with
 * the number of matching entities, and no rows and no chips — in both pipelines
 * (the page editor's `block` variant, the chat's `inline` one).
 *
 * The block does not pretend to be an empty list: an empty list looks exactly
 * like a list without hits, and the page author has to see they picked the
 * wrong tag. `check_consistency` reports the same tag (rule 17).
 *
 * `count` is `null` while the matching entities are still being counted.
 */
export function NoListView({
  type,
  count,
  variant,
}: {
  type: string;
  count: number | null;
  variant: 'inline' | 'block';
}) {
  const counted = count === null ? '…' : `${count} matching ${count === 1 ? 'entity' : 'entities'}`;
  const body = (
    <>
      type <code style={{ fontFamily: 'var(--font-mono)' }}>{type}</code> has no list view
      <span style={{ opacity: 0.7 }}> · </span>
      <span data-no-list-view-count={count ?? undefined}>{counted}</span>
    </>
  );
  const style = {
    background: 'var(--c-panel)',
    border: '1px dashed var(--c-hair-strong)',
    color: 'var(--c-muted)',
  };
  return variant === 'inline' ? (
    <span
      data-no-list-view={type}
      className="inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[11px]"
      style={style}
    >
      {body}
    </span>
  ) : (
    <div data-no-list-view={type} className="rounded-md px-3 py-2 text-[12.5px]" style={style}>
      {body}
    </div>
  );
}
