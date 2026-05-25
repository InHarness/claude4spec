import { Monitor } from 'lucide-react';
import { useUiViews } from '../../hooks/useUiViews.js';
import { dispatchNewUiView } from '../../components/NewUiViewPopover.js';
import { ListPageLayout } from '../_shared/ListPageLayout.js';
import { ListPageHeader } from '../_shared/ListPageHeader.js';
import { TagFilterBar } from '../_shared/TagFilterBar.js';
import { ListScrollArea } from '../_shared/ListScrollArea.js';
import { EntityListRow, CountBadge } from '../_shared/EntityListRow.js';
import { useEntityListQuery } from '../_shared/useEntityListQuery.js';

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
  const { query, tagLookup, tagBar } = useEntityListQuery('ui-view', {
    search,
    tagFilter,
    onTagToggle,
  });
  const { data: views = [], isLoading } = useUiViews(query);

  function handleCreate(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    dispatchNewUiView({
      x: rect.left,
      y: rect.bottom + 6,
      onCreated: (slug) => onSelect(slug),
    });
  }

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={Monitor}
        title="UI Views"
        count={views.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search name, slug, url, description…"
        createLabel="New View"
        onCreate={handleCreate}
      />
      <TagFilterBar {...tagBar} />
      <ListScrollArea
        loading={isLoading}
        empty={views.length === 0}
        emptyTitle="No UI views yet. Create one with /uiview in the editor."
        createLabel="Create your first view"
        onCreate={handleCreate}
      >
        {views.map((v) => (
          <EntityListRow
            key={v.slug}
            leading={<Monitor size={16} style={{ color: 'var(--c-accent)' }} />}
            onClick={() => onSelect(v.slug)}
            tags={v.tags}
            tagLookup={tagLookup}
            trailing={<CountBadge>{v.params.length}p</CountBadge>}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
                {v.name}
              </span>
              {v.url && (
                <span
                  className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  {v.url}
                </span>
              )}
            </div>
            {v.description && (
              <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                {v.description}
              </div>
            )}
          </EntityListRow>
        ))}
      </ListScrollArea>
    </ListPageLayout>
  );
}
