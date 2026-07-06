import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { withStability } from '../stability.js';
import { Badge } from '../actions/Badge.js';
import { Popover } from '../overlay-feedback/Popover.js';

/**
 * `TagPicker` (Panel detalu, `experimental`) — multi-select tags with an
 * optional inline create. Chips reuse the existing `Badge` component (no new
 * atom). `onCreate` for a name resolving to an existing slug is a no-op,
 * parity with the backend's auto-create-by-slug behavior — the caller's
 * `tagsService.create` already implements that idempotency.
 *
 * `variant: 'collapsed'` (host parity) shows chips only for `selected` + a
 * "+N" reveal control; the full tag list and inline-create input surface
 * inside a published `Popover` instead of always being visible inline.
 */
export interface TagPickerProps {
  allTags: { slug: string; name: string; color?: string | null }[];
  selected: string[];
  onToggle(slug: string): void;
  onCreate?(name: string): void;
  variant?: 'flat' | 'collapsed';
}

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
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom">
        <div className="flex flex-col gap-2" style={{ minWidth: 200, maxWidth: 280 }}>
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
          {onCreate && <CreateInput onCreate={onCreate} onDone={() => setOpen(false)} />}
        </div>
      </Popover>
    </div>
  );
}

function TagPickerImpl({ variant = 'flat', ...rest }: TagPickerProps) {
  return variant === 'collapsed' ? <CollapsedTagPicker {...rest} /> : <FlatTagPicker {...rest} />;
}

export const TagPicker = withStability(TagPickerImpl, 'experimental');
