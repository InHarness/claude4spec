import { Database } from 'lucide-react';
import { useDatabaseTables } from '../../hooks/useDatabaseTables.js';
import { dispatchNewDatabaseTable } from '../../components/NewDatabaseTablePopover.js';
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

export function DatabaseTablesList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect,
}: Props) {
  const { query, tagLookup, tagBar } = useEntityListQuery('database-table', {
    search,
    tagFilter,
    onTagToggle,
  });
  const { data: tables = [], isLoading } = useDatabaseTables(query);

  function handleCreate(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    dispatchNewDatabaseTable({
      x: rect.left,
      y: rect.bottom + 6,
      onCreated: (slug) => onSelect(slug),
    });
  }

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={Database}
        title="Database Tables"
        count={tables.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search name, slug, description…"
        createLabel="New Table"
        onCreate={handleCreate}
      />
      <TagFilterBar {...tagBar} />
      <ListScrollArea
        loading={isLoading}
        empty={tables.length === 0}
        emptyTitle="No database tables yet. Create one with /dbtable in the editor."
        createLabel="Create your first table"
        onCreate={handleCreate}
      >
        {tables.map((t) => (
          <EntityListRow
            key={t.slug}
            leading={<Database size={16} style={{ color: 'var(--c-accent)' }} />}
            onClick={() => onSelect(t.slug)}
            tags={t.tags}
            tagLookup={tagLookup}
            trailing={<CountBadge>{t.columns.length}c</CountBadge>}
          >
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-[13.5px]"
                style={{ color: 'var(--c-ink)', fontWeight: 500 }}
              >
                {t.name}
              </span>
            </div>
            {t.description && (
              <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                {t.description}
              </div>
            )}
          </EntityListRow>
        ))}
      </ListScrollArea>
    </ListPageLayout>
  );
}
