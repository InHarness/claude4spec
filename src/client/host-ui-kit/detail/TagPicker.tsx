import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { withStability } from '../stability.js';
import { Badge } from '../actions/Badge.js';
import { Popover } from '../overlay-feedback/Popover.js';
import { tagSlug } from '../../../shared/slug.js';

/**
 * `TagPicker` (Panel detalu, `experimental`) — multi-select tags with an
 * optional inline create. Chips reuse the existing `Badge` component (no new
 * atom). `onCreate` for a name resolving to an existing slug creates nothing,
 * parity with the backend's auto-create-by-slug behavior — checked here
 * (`idempotentCreate`; an existing unselected tag is selected via `onToggle`)
 * and again by `tagsService`, which feeds `onCreate`.
 *
 * `variant: 'collapsed'` (host parity) shows chips only for `selected` + a
 * "+N" reveal control; the full tag list and inline-create input surface
 * inside a published `Popover` instead of always being visible inline.
 */
/** One selectable tag — `{ slug; name; color? }`, written inline per its `ui-kit-component` record `tag-picker`. */
type TagPickerTag = { slug: string; name: string; color?: string | null };

export interface TagPickerProps {
  /**
   * 2.1.26 (record `tag-picker`): the item shape is written INLINE and is not the
   * catalog's `Tag` type (record `tag-filter-bar`) — the picker reads no `description`.
   * `useTags()` items are still assignable to it as is.
   */
  allTags: TagPickerTag[];
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
          <Badge
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
  const anchorRef = useRef<HTMLButtonElement>(null);
  const selectedSet = new Set(selected);
  const selectedTags = allTags.filter((t) => selectedSet.has(t.slug));
  const restCount = allTags.length - selectedTags.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectedTags.map((tag) => (
        <Badge key={tag.slug} label={tag.name} color={tag.color ?? undefined} active onClick={() => onToggle(tag.slug)} />
      ))}
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11.5px] px-2 py-0.5 rounded-full"
        style={{ color: 'var(--c-subtle)', border: '1px dashed var(--c-hair-strong)' }}
      >
        {restCount > 0 ? `+${restCount}` : '+ tag'}
      </button>
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
            <Badge
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
  allTags: readonly TagPickerTag[],
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
