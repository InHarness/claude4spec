import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { withStability } from '../stability.js';
import { TagChip } from '../actions/TagChip.js';
import { ActionButton } from '../actions/ActionButton.js';
import { Popover } from '../overlay-feedback/Popover.js';
import { tagSlug } from '../../../shared/slug.js';
import type { Tag } from '../../../shared/plugin-host/tag.js';

/**
 * `TagPicker` (Panel detalu, `experimental`) — multi-select tags with an
 * optional inline create. Each chip is the catalog `TagChip` (2.1.39). `onCreate` for a name resolving to an existing slug creates nothing,
 * parity with the backend's auto-create-by-slug behavior — checked here
 * (`idempotentCreate`; an existing unselected tag is selected via `onToggle`)
 * and again by `tagsService`, which feeds `onCreate`.
 *
 * `variant: 'collapsed'` (host parity) shows chips only for `selected` + a
 * "+N" reveal control (a ghost `ActionButton`); the full tag list and inline-create input surface
 * inside a published `Popover` instead of always being visible inline.
 */
export interface TagPickerProps {
  /** Every tag of the project — the public `Tag` type (2.1.41); `useTags()` items go in as is. */
  allTags: Tag[];
  selected: string[];
  onToggle(slug: string): void;
  onCreate?(name: string): void;
  variant?: 'flat' | 'collapsed';
}

/** Height cap for the `collapsed` variant's tag-catalog `Popover`; a large catalog scrolls instead of growing unbounded. */
const TAG_CATALOG_MAX_HEIGHT = 240;

function CreateInput({ onCreate, onDone }: { onCreate: (name: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const name = draft.trim();
    if (!name) return;
    onCreate(name);
    setDraft('');
    onDone();
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="New tag…"
        className="flex-1 rounded-md px-2 py-1 text-[12px]"
        style={{ background: 'var(--c-card)', color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
        autoFocus
      />
      <button
        type="button"
        onClick={submit}
        disabled={!draft.trim()}
        aria-label="Create tag"
        className="rounded-md p-1 btn-ghost"
        style={{ color: 'var(--c-accent)', opacity: draft.trim() ? 1 : 0.4 }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function FlatTagPicker({ allTags, selected, onToggle, onCreate }: Omit<TagPickerProps, 'variant'>) {
  const selectedSet = new Set(selected);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {allTags.map((tag) => (
          <TagChip
            key={tag.slug}
            label={tag.name}
            color={tag.color ?? undefined}
            active={selectedSet.has(tag.slug)}
            onClick={() => onToggle(tag.slug)}
          />
        ))}
      </div>
      {onCreate && <CreateInput onCreate={onCreate} onDone={() => {}} />}
    </div>
  );
}

function CollapsedTagPicker({ allTags, selected, onToggle, onCreate }: Omit<TagPickerProps, 'variant'>) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const selectedSet = new Set(selected);
  const selectedTags = allTags.filter((t) => selectedSet.has(t.slug));
  const restCount = allTags.length - selectedTags.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedTags.map((tag) => (
        <TagChip key={tag.slug} label={tag.name} color={tag.color ?? undefined} active onClick={() => onToggle(tag.slug)} />
      ))}
      {/* ActionButton takes no ref, so the Popover anchors on this wrapper. */}
      <span ref={anchorRef} className="inline-flex">
        <ActionButton
          variant="ghost"
          label={restCount > 0 ? `+${restCount}` : '+ tag'}
          onClick={() => setOpen((v) => !v)}
        />
      </span>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="bottom"
        maxHeight={TAG_CATALOG_MAX_HEIGHT}
        footer={onCreate ? <CreateInput onCreate={onCreate} onDone={() => setOpen(false)} /> : undefined}
      >
        <div className="flex flex-wrap gap-1.5" style={{ minWidth: 200, maxWidth: 280 }}>
          {allTags.map((tag) => (
            <TagChip
              key={tag.slug}
              label={tag.name}
              color={tag.color ?? undefined}
              active={selectedSet.has(tag.slug)}
              onClick={() => onToggle(tag.slug)}
            />
          ))}
        </div>
      </Popover>
    </div>
  );
}

/**
 * 2.1.28 (record `tag-picker`): `onCreate` for a name whose slug already exists
 * is idempotent — no create, parity with the backend's auto-create by slug,
 * which resolves such a name to the existing tag rather than making a second
 * one. The picker checks the slug against `allTags` with the backend's own
 * `tagSlug` and never calls the author's `onCreate` for it. Like the backend,
 * it still lets the caller apply the tag it resolved to: an existing tag that
 * is not selected is selected through `onToggle(slug)`; one already selected
 * is left as is (a full no-op).
 */
export function idempotentCreate(
  allTags: readonly Tag[],
  selected: readonly string[],
  onToggle: (slug: string) => void,
  onCreate: ((name: string) => void) | undefined,
): ((name: string) => void) | undefined {
  if (!onCreate) return undefined;
  return (name: string) => {
    const slug = tagSlug(name);
    const existing = allTags.find((t) => t.slug === slug);
    if (existing) {
      if (!selected.includes(existing.slug)) onToggle(existing.slug);
      return;
    }
    onCreate(name);
  };
}

function TagPickerImpl({ variant = 'flat', onCreate, ...rest }: TagPickerProps) {
  const create = idempotentCreate(rest.allTags, rest.selected, rest.onToggle, onCreate);
  return variant === 'collapsed' ? (
    <CollapsedTagPicker {...rest} onCreate={create} />
  ) : (
    <FlatTagPicker {...rest} onCreate={create} />
  );
}

export const TagPicker = withStability(TagPickerImpl, 'experimental');
