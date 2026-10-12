import { useState } from 'react';
import { ArrowRightLeft, Plus } from 'lucide-react';
import {
  ActionButton,
  EmptyState,
  EntityListHeader,
  EntityListLayout,
  EntityListRow,
  LoadingState,
  TagFilterBar,
} from '@c4s/plugin-runtime/ui';
import { MethodChip } from '../../../frontend-kit/atoms.js';
import { EndpointCreateDialog } from './create-dialog.js';
import { useEndpoints } from './hooks.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';

/** The type's own empty text — one `EmptyState` for "none" and "none matching" alike. */
export const ENDPOINT_LIST_EMPTY_TITLE = 'No endpoints.';

/** The second line of a row whose endpoint has no `summary`. */
export const ENDPOINT_NO_SUMMARY = '— no summary —';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

/**
 * 2.1.16 (`endpoint-list`) — `EntityListHeader` (icon, title, count = length of
 * the fetched list, search, "New endpoint") and the kit `TagFilterBar` (with
 * "clear"), the whole screen an `EntityListLayout`. Each row is the kit
 * `EntityListRow`: `leading` = the method chip (`Badge`), main content = `path`,
 * second line = `summary` or "— no summary —", `trailing` = the slug. Two
 * alternative states: `loading` (`LoadingState`) and `empty` (one `EmptyState`
 * with the type's text whether the project has no endpoint or none matches the
 * search / tag filter; no filter reset — the tag filter clears in its own bar).
 * No pagination, no error state.
 */
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

  const header = (
    <>
      <EntityListHeader
        icon={ArrowRightLeft}
        title="Endpoints"
        count={endpoints.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search path, summary, slug…"
        actions={
          <ActionButton
            variant="primary"
            icon={<Plus size={13} />}
            label="New endpoint"
            onClick={() => setDialogOpen(true)}
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
        ) : endpoints.length === 0 ? (
          <EmptyState title={ENDPOINT_LIST_EMPTY_TITLE} />
        ) : (
          endpoints.map((ep) => (
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
                {ep.summary || <span style={{ color: 'var(--c-subtle)' }}>{ENDPOINT_NO_SUMMARY}</span>}
              </div>
            </EntityListRow>
          ))
        )}
      </EntityListLayout>

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
