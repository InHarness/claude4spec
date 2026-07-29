import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { MethodChip } from '../../../frontend-kit/atoms.js';
import { EndpointCreateDialog } from './create-dialog.js';
import { useEndpoints } from './hooks.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
import { ListPageHeader } from '../../../frontend-kit/ListPageHeader.js';
import { TagFilterBar } from '../../../frontend-kit/TagFilterBar.js';
import { ListScrollArea } from '../../../frontend-kit/ListScrollArea.js';
import { EntityListRow } from '../../../frontend-kit/EntityListRow.js';
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

export function EndpointsList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { query, tagLookup, tagBar } = useEntityListQuery('endpoint', {
    search,
    tagFilter,
    onTagToggle,
  });
  const { data: endpoints = [], isLoading } = useEndpoints(query);

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={ArrowRightLeft}
        title="Endpoints"
        count={endpoints.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search path, summary, slug…"
        createLabel="New endpoint"
        onCreate={() => setDialogOpen(true)}
      />
      <TagFilterBar {...tagBar} />
      <ListScrollArea
        loading={isLoading}
        empty={endpoints.length === 0}
        emptyTitle="No endpoints match your filters."
        createLabel="Create your first endpoint"
        onCreate={() => setDialogOpen(true)}
      >
        {endpoints.map((ep) => (
          <EntityListRow
            key={ep.slug}
            leading={<MethodChip method={ep.method} large />}
            onClick={() => onSelect(ep.slug)}
            tags={ep.tags}
            tagLookup={tagLookup}
            trailing={
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--c-subtle)' }}>
                {ep.slug}
              </span>
            }
          >
            <div className="flex items-center gap-2">
              <span
                className="font-mono text-[13.5px]"
                style={{ color: 'var(--c-ink)', fontWeight: 500 }}
              >
                {ep.path}
              </span>
            </div>
            <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
              {ep.summary || <span style={{ color: 'var(--c-subtle)' }}>— no summary —</span>}
            </div>
          </EntityListRow>
        ))}
      </ListScrollArea>

      {dialogOpen && (
        <EndpointCreateDialog
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
