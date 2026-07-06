import { useRef, useState, type ReactNode } from 'react';
import { withStability } from '../stability.js';
import { Popover } from '../overlay-feedback/Popover.js';

/**
 * `GroupedRelationPicker` (Pickers, `experimental`) — relations grouped
 * per-type (e.g. request/response/error DTO links on an endpoint).
 * Generalizes the host's per-relation-type `LinkedDtos` picker. Pure-
 * presentational — it never mutates; the actual link/unlink is the plugin
 * author's callback.
 *
 * `items` is each group's full candidate list; `selected` holds the ids
 * currently linked per group key. The optional `badge` on an item renders
 * as-is (e.g. a status-code chip) — the picker itself has no notion of
 * per-link metadata beyond the id, so a consumer that needs an editable
 * per-link value (a status code, say) passes an interactive node there.
 */
export interface GroupedRelationPickerProps {
  groups: { key: string; label: string; items: { id: string; label: string; badge?: ReactNode }[] }[];
  selected: Record<string, string[]>;
  onAdd(groupKey: string, id: string): void;
  onRemove(groupKey: string, id: string): void;
  onSearch?(q: string): void;
}

function GroupRow({
  group,
  selectedIds,
  onAdd,
  onRemove,
  onSearch,
}: {
  group: GroupedRelationPickerProps['groups'][number];
  selectedIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onSearch?: (q: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const anchorRef = useRef<HTMLButtonElement>(null);
  const byId = new Map(group.items.map((i) => [i.id, i]));
  const available = group.items.filter((i) => !selectedIds.includes(i.id));

  return (
    <div style={{ padding: '10px 12px' }}>
      <div className="flex items-center gap-2">
        <span
          className="text-[10.5px] uppercase font-mono tracking-wider"
          style={{ color: 'var(--c-subtle)', minWidth: 64 }}
        >
          {group.label}
        </span>
        <div className="flex-1 flex flex-wrap items-center gap-1.5">
          {selectedIds.length === 0 && (
            <span className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
              —
            </span>
          )}
          {selectedIds.map((id) => {
            const item = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded px-1.5 py-[2px]"
                style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)', fontSize: 12 }}
              >
                {item?.label ?? id}
                {item?.badge}
                <button
                  onClick={() => onRemove(id)}
                  className="opacity-70 hover:opacity-100"
                  style={{ color: 'var(--c-subtle)' }}
                  aria-label={`unlink ${item?.label ?? id}`}
                >
                  ×
                </button>
              </span>
            );
          })}
          <button
            ref={anchorRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11.5px] px-2 py-0.5 rounded-full"
            style={{ color: 'var(--c-subtle)', border: '1px dashed var(--c-hair-strong)' }}
          >
            + link
          </button>
        </div>
      </div>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom">
        <div className="flex flex-col gap-1.5" style={{ minWidth: 200, maxWidth: 280 }}>
          {onSearch && (
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onSearch(e.target.value);
              }}
              placeholder="Search…"
              className="rounded px-2 py-1 text-[12px]"
              style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
            />
          )}
          {available.length === 0 ? (
            <span className="text-[11.5px] italic px-1" style={{ color: 'var(--c-subtle)' }}>
              Nothing available to link.
            </span>
          ) : (
            available.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onAdd(item.id);
                  setOpen(false);
                }}
                className="text-left text-[12px] rounded px-2 py-1"
                style={{ color: 'var(--c-ink)' }}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}

function GroupedRelationPickerImpl({ groups, selected, onAdd, onRemove, onSearch }: GroupedRelationPickerProps) {
  return (
    <div className="rounded-md" style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}>
      {groups.map((group, i) => (
        <div key={group.key} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--c-hair)' }}>
          <GroupRow
            group={group}
            selectedIds={selected[group.key] ?? []}
            onAdd={(id) => onAdd(group.key, id)}
            onRemove={(id) => onRemove(group.key, id)}
            onSearch={onSearch}
          />
        </div>
      ))}
    </div>
  );
}

export const GroupedRelationPicker = withStability(GroupedRelationPickerImpl, 'experimental');
