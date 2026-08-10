/**
 * 0.2.15 — what a list tag renders when its entity type has no `renderRow`.
 *
 * A hidden ("embed-only") type — `diagram`, `spreadsheet` — supplies a chip and
 * a card and nothing else, so `<element_list/>` and `<tagged_list/>` of that
 * type have no row to draw. That is a CONTRACT, not a gap, and this is where it
 * becomes visible: the alternative is an empty list frame that looks like a
 * query returning nothing, which sends the author looking for missing data
 * instead of for the wrong tag.
 */
export function NotListable({ type, label }: { type: string; label?: string }) {
  return (
    <div
      className="rounded-md px-3 py-2 text-[12.5px]"
      style={{
        background: 'var(--c-panel)',
        border: '1px dashed var(--c-hair-strong)',
        color: 'var(--c-muted)',
      }}
    >
      <strong style={{ fontFamily: 'var(--font-mono)' }}>{label ?? type}</strong> cannot be listed —
      embed it one at a time with{' '}
      <code style={{ fontFamily: 'var(--font-mono)' }}>
        &lt;single_element type="{type}" slug="…"/&gt;
      </code>
      .
    </div>
  );
}
