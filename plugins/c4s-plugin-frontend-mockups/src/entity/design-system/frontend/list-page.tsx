import { useState } from 'react';
import { Palette } from 'lucide-react';
import { useDesignSystems } from './hooks.js';
import { countsOf } from './api.js';
import { DesignSystemCreateDialog } from './create-dialog.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
import { ListPageHeader } from '../../../frontend-kit/ListPageHeader.js';
import { TagFilterBar } from '../../../frontend-kit/TagFilterBar.js';
import { ListScrollArea } from '../../../frontend-kit/ListScrollArea.js';
import { EntityListRow, CountBadge } from '../../../frontend-kit/EntityListRow.js';
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';

/** The one empty state — no design systems at all, or none matching the search / tag filter. */
export const DESIGN_SYSTEM_LIST_EMPTY_TITLE =
  'No design systems yet. Create one with /design-system in the editor.';
export const DESIGN_SYSTEM_LIST_CREATE_LABEL = 'Create your first design system';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

/**
 * 2.1.19 (`design-system-list`, `/design-systems`) — header (title, count,
 * server-side search, "New Design System") over the kit `TagFilterBar`, rows
 * through the kit `EntityListRow` (title + groups/tokens count + description).
 * Two alternative states: `loading` — a five-line `LoadingState` skeleton in
 * place of the rows — and `empty` — ONE `EmptyState` for "none in the project"
 * and "none matching" alike, with the create action. No error state.
 *
 * The header and the loading/empty composition go through the package's
 * `ListPageHeader` / `ListScrollArea` — local compositions of catalog
 * components only, not host-local (2.1.20).
 *
 * 2.1.28 (ui-view `design-system-list`): `EntityListRow` and `TagFilterBar` are
 * the kit's (the package files re-export `/ui`); the groups/tokens counter is
 * still the recorded `CountBadge` debt, not `Badge` (ASSUMPTION:dev-2813).
 */
export function DesignSystemsList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect,
}: Props) {
  const { query, tagLookup, tagBar } = useEntityListQuery('design-system', {
    search,
    tagFilter,
    onTagToggle,
  });
  const { data: systems = [], isLoading } = useDesignSystems(query);
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCreate() {
    setDialogOpen(true);
  }

  // Alphabetical by name (list endpoint already orders by name; keep stable).
  const sorted = [...systems].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={Palette}
        title="Design Systems"
        count={systems.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search title, slug, description…"
        createLabel="New Design System"
        onCreate={handleCreate}
      />
      <TagFilterBar {...tagBar} />
      <ListScrollArea
        loading={isLoading}
        empty={systems.length === 0}
        emptyTitle={DESIGN_SYSTEM_LIST_EMPTY_TITLE}
        createLabel={DESIGN_SYSTEM_LIST_CREATE_LABEL}
        onCreate={handleCreate}
      >
        {sorted.map((ds) => {
          const counts = countsOf(ds);
          return (
            <EntityListRow
              key={ds.slug}
              icon={Palette}
              onClick={() => onSelect(ds.slug)}
              tags={ds.tags}
              tagLookup={tagLookup}
              trailing={
                <CountBadge>
                  {counts.groups} groups
                  {counts.tokens !== null && ` / ${counts.tokens} tokens`}
                </CountBadge>
              }
            >
              <div className="flex items-center gap-2">
                <span className="text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
                  {ds.title}
                </span>
              </div>
              {ds.description && (
                <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                  {ds.description}
                </div>
              )}
            </EntityListRow>
          );
        })}
      </ListScrollArea>

      {dialogOpen && (
        <DesignSystemCreateDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(slug) => {
            setDialogOpen(false);
            onSelect(slug);
          }}
        />
      )}
    </ListPageLayout>
  );
}
