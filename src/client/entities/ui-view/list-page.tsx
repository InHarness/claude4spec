import { useMemo, useState } from 'react';
import { Monitor, Plus, Search } from 'lucide-react';
import { TagChip } from '../../components/atoms.js';
import { useUiViews } from '../../hooks/useUiViews.js';
import { useTags } from '../../hooks/useTags.js';
import { dispatchNewUiView } from '../../components/NewUiViewPopover.js';
import type { UiView } from '../../../shared/entities.js';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

export function UiViewsList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect,
}: Props) {
  const [tagMode, setTagMode] = useState<'and' | 'or'>('or');

  const query = useMemo(
    () => ({
      search: search || undefined,
      tags: tagFilter.length ? tagFilter : undefined,
      tagFilter: tagFilter.length ? tagMode : undefined,
    }),
    [search, tagFilter, tagMode]
  );

  const { data: views = [], isLoading } = useUiViews(query);
  const { data: tags = [] } = useTags();

  const tagsWithViews = tags.filter((t) => t.counts['ui-view'] > 0);

  function handleCreate(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    dispatchNewUiView({
      x: rect.left,
      y: rect.bottom + 6,
      onCreated: (slug) => onSelect(slug),
    });
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <Monitor size={18} style={{ color: 'var(--c-accent)' }} />
        <h2
          className="text-[18px] font-semibold tracking-tight"
          style={{ color: 'var(--c-ink)' }}
        >
          UI Views
        </h2>
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {views.length} {views.length === 1 ? 'result' : 'results'}
        </span>
        <span className="flex-1" />
        <div
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
          style={{
            background: 'var(--c-card)',
            border: '1px solid var(--c-hair)',
            width: 280,
          }}
        >
          <Search size={13} style={{ color: 'var(--c-subtle)' }} />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="bg-transparent flex-1 text-[13px] outline-none"
            placeholder="Search name, slug, url, description…"
            style={{ color: 'var(--c-ink)' }}
          />
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={13} /> New View
        </button>
      </div>

      {tagsWithViews.length > 0 && (
        <div
          className="px-8 py-3 flex items-center gap-2 flex-wrap"
          style={{ borderBottom: '1px solid var(--c-hair)' }}
        >
          <span
            className="text-[10.5px] uppercase font-mono tracking-wider"
            style={{ color: 'var(--c-subtle)' }}
          >
            Filter by tag:
          </span>
          {tagsWithViews.map((tag) => (
            <TagChip
              key={tag.slug}
              tag={tag}
              active={tagFilter.includes(tag.slug)}
              onClick={() => onTagToggle(tag.slug)}
              small
            />
          ))}
          <span className="flex-1" />
          {tagFilter.length > 1 && (
            <button
              onClick={() => setTagMode((m) => (m === 'and' ? 'or' : 'and'))}
              className="text-[10.5px] uppercase font-mono tracking-wider px-2 py-0.5 rounded"
              style={{ color: 'var(--c-muted)', background: 'var(--c-panel)' }}
              title="Toggle AND / OR filter"
            >
              match {tagMode}
            </button>
          )}
          {tagFilter.length > 0 && (
            <button
              onClick={() => tagFilter.forEach(onTagToggle)}
              className="text-[10.5px] font-mono px-2 py-0.5 rounded"
              style={{ color: 'var(--c-muted)' }}
            >
              clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 1000, padding: '16px 32px 48px' }}>
          {isLoading && (
            <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
              Loading…
            </div>
          )}
          {!isLoading && views.length === 0 && (
            <div
              className="text-center py-20 rounded-lg"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              <div className="text-[14px] mb-2">
                No UI views yet. Create one with /uiview in the editor.
              </div>
              <button
                onClick={handleCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium mt-2"
                style={{ background: 'var(--c-accent)', color: '#fff' }}
              >
                <Plus size={13} /> Create your first view
              </button>
            </div>
          )}
          {!isLoading &&
            views.map((v) => (
              <UiViewListRow
                key={v.slug}
                view={v}
                onClick={() => onSelect(v.slug)}
                tagLookup={new Map(tags.map((x) => [x.slug, x]))}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function UiViewListRow({
  view,
  onClick,
  tagLookup,
}: {
  view: UiView;
  onClick: () => void;
  tagLookup: Map<string, { slug: string; name: string; color: string | null }>;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-md transition mb-1"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <Monitor size={16} style={{ color: 'var(--c-accent)' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-[13.5px]"
            style={{ color: 'var(--c-ink)', fontWeight: 500 }}
          >
            {view.name}
          </span>
          {view.url && (
            <span
              className="font-mono text-[11px] px-1.5 py-0.5 rounded"
              style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
            >
              {view.url}
            </span>
          )}
        </div>
        {view.description && (
          <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
            {view.description}
          </div>
        )}
        {view.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1.5">
            {view.tags.map((ts) => (
              <TagChip
                key={ts}
                tag={tagLookup.get(ts) ?? { slug: ts, name: ts, color: null }}
                small
              />
            ))}
          </div>
        )}
      </div>
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {view.params.length}p
      </span>
    </button>
  );
}
