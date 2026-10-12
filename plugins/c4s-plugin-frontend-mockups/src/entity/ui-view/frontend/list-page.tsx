import { useState } from 'react';
import { Monitor, Plus } from 'lucide-react';
import {
  ActionButton,
  Badge,
  EmptyState,
  EntityListHeader,
  EntityListLayout,
  EntityListRow,
  LoadingState,
  TagFilterBar,
} from '@c4s/plugin-runtime/ui';
import { useUiViews } from './hooks.js';
import { UiViewCreateDialog } from './create-dialog.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';

/** The type's own empty text — one `EmptyState` for "none" and "none matching" alike. */
export const UI_VIEW_LIST_EMPTY_TITLE = 'No UI views.';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

/**
 * 2.1.16 (`ui-view-list`) — `EntityListHeader` (icon, title, count = length of
 * the fetched list, search, "New View") over the kit `TagFilterBar` (chips,
 * and/or mode, "clear"); the whole screen is an `EntityListLayout`. Rows are the
 * kit `EntityListRow`: title + URL badge + parameter count + mockup chip +
 * description. Two alternative states: `loading` (`LoadingState`) and `empty`
 * (one `EmptyState` with the type's text, no filter reset — the tag filter
 * clears in its own bar). No pagination, no error state.
 */
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
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCreate() {
    setDialogOpen(true);
  }

  const header = (
    <>
      <EntityListHeader
        icon={Monitor}
        title="UI Views"
        count={views.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search title, slug, url, description…"
        actions={
          <ActionButton
            variant="primary"
            icon={<Plus size={13} />}
            label="New View"
            onClick={handleCreate}
          />
        }
      />
      <TagFilterBar {...tagBar} />
    </>
  );

  return (
    <ListPageLayout>
      <EntityListLayout header={header}>
        {isLoading ? (
          <LoadingState lines={5} height={40} />
        ) : views.length === 0 ? (
          <EmptyState title={UI_VIEW_LIST_EMPTY_TITLE} />
        ) : (
          views.map((v) => {
            const paramCount = v.paramsCount ?? 0;
            return (
              <EntityListRow
                key={v.slug}
                icon={Monitor}
                onClick={() => onSelect(v.slug)}
                tags={v.tags}
                tagLookup={tagLookup}
                trailing={
                  <span title={`${paramCount} parameter${paramCount === 1 ? '' : 's'}`}>
                    <Badge label={`${paramCount}p`} mono small dot={false} />
                  </span>
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
                    {v.title}
                  </span>
                  {v.url && <Badge label={v.url} mono small dot={false} />}
                  {/*
                    The mockup chip — PRESENCE-ONLY, by the same convention the URL
                    badge above already follows: no mockup renders NOTHING here, not
                    a dimmed icon and not an empty container holding width.

                    `hasMockupHtml` comes off the record the list already fetched
                    (the host derives it from the `contentBearing` `mockupHtml`
                    field), so the chip costs no request. It must never reach for the
                    mockup itself, nor for `mockupHtmlBytes` — the size stays with the
                    `Details` descriptor.
                  */}
                  {v.hasMockupHtml === true && <Badge label="Mockup" small dot={false} />}
                </div>
                {v.description && (
                  <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                    {v.description}
                  </div>
                )}
              </EntityListRow>
            );
          })
        )}
      </EntityListLayout>

      {dialogOpen && (
        <UiViewCreateDialog
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
