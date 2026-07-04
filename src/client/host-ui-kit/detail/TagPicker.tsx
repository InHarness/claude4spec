import { useState } from 'react';
import { Plus } from 'lucide-react';
import { withStability } from '../stability.js';
import { Badge } from '../actions/Badge.js';

/**
 * `TagPicker` (Panel detalu, `experimental`) — multi-select tags with an
 * optional inline create. Chips reuse the existing `Badge` component (no new
 * atom). `onCreate` for a name resolving to an existing slug is a no-op,
 * parity with the backend's auto-create-by-slug behavior — the caller's
 * `tagsService.create` already implements that idempotency.
 */
export interface TagPickerProps {
  allTags: { slug: string; name: string; color?: string }[];
  selected: string[];
  onToggle(slug: string): void;
  onCreate?(name: string): void;
}

function TagPickerImpl({ allTags, selected, onToggle, onCreate }: TagPickerProps) {
  const [draft, setDraft] = useState('');
  const selectedSet = new Set(selected);

  const submitCreate = () => {
    const name = draft.trim();
    if (!name || !onCreate) return;
    onCreate(name);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {allTags.map((tag) => (
          <Badge
            key={tag.slug}
            label={tag.name}
            color={tag.color}
            active={selectedSet.has(tag.slug)}
            onClick={() => onToggle(tag.slug)}
          />
        ))}
      </div>
      {onCreate && (
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitCreate();
              }
            }}
            placeholder="New tag…"
            className="flex-1 rounded-md px-2 py-1 text-[12px]"
            style={{ background: 'var(--c-card)', color: 'var(--c-ink)', border: '1px solid var(--c-hair)' }}
          />
          <button
            type="button"
            onClick={submitCreate}
            disabled={!draft.trim()}
            aria-label="Create tag"
            className="rounded-md p-1 btn-ghost"
            style={{ color: 'var(--c-accent)', opacity: draft.trim() ? 1 : 0.4 }}
          >
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

export const TagPicker = withStability(TagPickerImpl, 'experimental');
