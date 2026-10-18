import { useRef, useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import type { Tag } from '../../shared/entities.js';
import { useTags, useUpdateTag } from '../hooks/useTags.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { EntityListHeader } from '../host-ui-kit/core/EntityListHeader.js';
import { EntityListRow } from '../host-ui-kit/list/EntityListRow.js';
import { EmptyState } from '../host-ui-kit/list/EmptyState.js';
import { InlineEditField } from '../host-ui-kit/form/InlineEditField.js';
import { Popover } from '../host-ui-kit/overlay-feedback/Popover.js';
import { toast } from '../ui/events.js';

/**
 * The palette offered by the colour popover. Tags may still carry any colour
 * the API accepts — this is a picker, not a constraint.
 */
const PALETTE = [
  '#c45a3b',
  '#c99467',
  '#7d9a6d',
  '#5b8c8a',
  '#5f7fa8',
  '#8b6f9e',
  '#a86b81',
  '#8a8a8a',
];

/** No tag row navigates anywhere — the row is an inline editing surface. */
const NO_TAG_LOOKUP = new Map<string, Tag>();

/**
 * ui-view `tags-list` (M18, `/tags`): the page header is the catalog
 * `EntityListHeader` (tag icon, "Tags", tag count — no search, no actions) and
 * the `empty` state the catalog `EmptyState`. Each tag row is the catalog
 * `EntityListRow` (dot in `leading`, name in `children`, per-type counts in
 * `trailing`); name and colour are edited inline through `InlineEditField` and
 * `Popover`.
 */
export function TagsList() {
  const { data: tags = [], isLoading } = useTags();
  const modules = clientPluginHost.listEntities();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <EntityListHeader icon={TagIcon} title="Tags" count={tags.length} />

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 720, padding: '24px 32px 48px' }}>
          {isLoading && (
            <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
              Loading…
            </div>
          )}
          {!isLoading && tags.length === 0 && (
            <EmptyState
              title="No tags yet"
              hint="A tag is created automatically the first time it is assigned to an entity of any active type."
            />
          )}
          {tags.map((t) => (
            <TagRow key={t.slug} tag={t} modules={modules} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TagRow({
  tag,
  modules,
}: {
  tag: Tag;
  modules: ReturnType<typeof clientPluginHost.listEntities>;
}) {
  const update = useUpdateTag();

  // InlineEditField commits once per edit (the blur after Enter sends nothing),
  // so every commit here is a rename the user made.
  function commitName(next: string) {
    const trimmed = next.trim();
    // The slug is derived and immutable; an empty name would leave the row
    // unlabelled with no way back, so refuse rather than send it.
    if (!trimmed || trimmed === tag.name) return;
    update.mutate(
      { slug: tag.slug, input: { name: trimmed } },
      { onError: (err) => toast.error((err as Error).message ?? 'Failed to rename tag') },
    );
  }

  function commitColor(color: string | null) {
    update.mutate(
      { slug: tag.slug, input: { color } },
      { onError: (err) => toast.error((err as Error).message ?? 'Failed to recolor tag') },
    );
  }

  const counts = modules
    .map((m) => {
      const c = tag.counts[m.type] ?? 0;
      return `${c} ${c === 1 ? m.label : m.labelPlural}`;
    })
    .join(' · ');

  return (
    <EntityListRow
      // No `onClick`: the row is an editing surface, not a link — every
      // affordance inside it (name, colour) is its own control.
      // ASSUMPTION:dev-2810 — /tags rows do not navigate (no row onClick, no
      // "Show all [type]" links); the row stays an inline editing surface.
      tagLookup={NO_TAG_LOOKUP}
      leading={<ColorSwatch color={tag.color} onPick={commitColor} />}
      trailing={
        <span className="font-mono text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          {counts}
        </span>
      }
    >
      <div className="flex items-center gap-3">
        <span className="text-[14px] font-medium" style={{ color: 'var(--c-ink)' }}>
          <InlineEditField value={tag.name} onCommit={commitName} />
        </span>
        <span
          className="font-mono text-[11px] px-1.5 py-0.5 rounded"
          style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
        >
          {tag.slug}
        </span>
      </div>
    </EntityListRow>
  );
}

function ColorSwatch({
  color,
  onPick,
}: {
  color: string | null | undefined;
  onPick: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label="Change tag color"
        title="Change color"
        className="rounded-full shrink-0 cursor-pointer"
        style={{
          width: 14,
          height: 14,
          background: color ?? 'var(--c-muted)',
          border: '1px solid var(--c-hair-strong)',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      />
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={ref as React.RefObject<HTMLElement>}
        title="Tag color"
      >
        <div className="flex items-center gap-1.5 flex-wrap" style={{ maxWidth: 180 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className="rounded-full"
              style={{
                width: 18,
                height: 18,
                background: c,
                border: c === color ? '2px solid var(--c-ink)' : '1px solid var(--c-hair-strong)',
              }}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
            />
          ))}
          <button
            type="button"
            className="text-[11.5px] ml-1"
            style={{ color: 'var(--c-muted)' }}
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
          >
            clear
          </button>
        </div>
      </Popover>
    </>
  );
}
