import { useState } from 'react';
import { Monitor } from 'lucide-react';
import { Badge } from '@c4s/plugin-runtime/ui';
import { useUiViews } from './hooks.js';
import { UiViewCreateDialog } from './create-dialog.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
import { ListPageHeader } from '../../../frontend-kit/ListPageHeader.js';
import { TagFilterBar } from '../../../frontend-kit/TagFilterBar.js';
import { ListScrollArea } from '../../../frontend-kit/ListScrollArea.js';
import { EntityListRow, CountBadge } from '../../../frontend-kit/EntityListRow.js';
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';

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
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCreate() {
    setDialogOpen(true);
  }

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={Monitor}
        title="UI Views"
        count={views.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search title, slug, url, description…"
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
            icon={Monitor}
            onClick={() => onSelect(v.slug)}
            tags={v.tags}
            tagLookup={tagLookup}
            trailing={<CountBadge>{v.paramsCount ?? 0}p</CountBadge>}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13.5px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
                {v.title}
              </span>
              {v.url && (
                <span
                  className="font-mono text-[11px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
                >
                  {v.url}
                </span>
              )}
              {/*
                The mockup chip — PRESENCE-ONLY, by the same convention the URL
                badge above already follows: no mockup renders NOTHING here, not
                a dimmed icon and not an empty container holding width. A
                two-state variant would put an element in every single row.

                `hasMockupHtml` comes off the record the list already fetched
                (the host derives it from the `contentBearing` `mockupHtml`
                field), so the chip costs no request. It must never reach for the
                mockup itself, nor for `mockupHtmlBytes` — the size answers "what
                does fetching this cost", and the list is not where that is
                decided; the `Details` descriptor is.

                Text label only, no emoji and no icon of its own, and no new
                token or class: the existing kit `Badge` in the same `small`
                shape the row's tag chips use.
              */}
              {v.hasMockupHtml === true && <Badge label="Mockup" small dot={false} />}
            </div>
            {v.description && (
              <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
                {v.description}
              </div>
            )}
          </EntityListRow>
        ))}
      </ListScrollArea>

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
