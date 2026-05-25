import { useMemo, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { useAcs, useCreateAc } from '../../hooks/useAcs.js';
import { openPopover, toast } from '../../ui/events.js';
import type { AcKind, AcStatus } from '../../../shared/entities.js';
import { ListPageLayout } from '../_shared/ListPageLayout.js';
import { ListPageHeader } from '../_shared/ListPageHeader.js';
import { TagFilterBar } from '../_shared/TagFilterBar.js';
import { ListScrollArea } from '../_shared/ListScrollArea.js';
import { EntityListRow } from '../_shared/EntityListRow.js';
import { useEntityListQuery } from '../_shared/useEntityListQuery.js';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

export function AcsList({ search, tagFilter, onSearchChange, onTagToggle, onSelect }: Props) {
  const [statusFilter, setStatusFilter] = useState<AcStatus | 'all'>('active');
  const [kindFilter, setKindFilter] = useState<AcKind | 'all'>('all');
  const createAc = useCreateAc();

  const extraQuery = useMemo(
    () => ({ status: statusFilter, ...(kindFilter !== 'all' ? { kind: kindFilter } : {}) }),
    [statusFilter, kindFilter],
  );
  const { query, tagLookup, tagBar } = useEntityListQuery('ac', {
    search,
    tagFilter,
    onTagToggle,
    extraQuery,
  });
  const { data: acs = [], isLoading } = useAcs(query);

  async function handleCreate(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const result = await openPopover('create-ac', { x: rect.left, y: rect.bottom + 6 }, {});
    if (!result) return;
    try {
      const ac = await createAc.mutateAsync(result);
      onSelect(ac.slug);
      toast.success('AC created');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <ListPageLayout>
      <ListPageHeader
        icon={CheckSquare}
        title="Acceptance Criteria"
        count={acs.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search text, slug, description…"
        createLabel="New AC"
        onCreate={handleCreate}
      />

      <div
        className="px-8 py-2 flex items-center gap-2 flex-wrap text-[11.5px]"
        style={{ borderBottom: '1px solid var(--c-hair)', color: 'var(--c-muted)' }}
      >
        <span
          className="text-[10.5px] uppercase font-mono tracking-wider"
          style={{ color: 'var(--c-subtle)' }}
        >
          status:
        </span>
        {(['active', 'deprecated', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="rounded-full px-2 py-0.5 text-[10.5px] uppercase font-mono tracking-wider"
            style={{
              background: statusFilter === s ? 'var(--c-accent-soft)' : 'transparent',
              color: statusFilter === s ? 'var(--c-accent-ink, var(--c-accent))' : 'var(--c-muted)',
              border: '1px solid var(--c-hair)',
            }}
          >
            {s}
          </button>
        ))}

        <span
          className="ml-4 text-[10.5px] uppercase font-mono tracking-wider"
          style={{ color: 'var(--c-subtle)' }}
        >
          kind:
        </span>
        {(['all', 'requirement', 'edge-case'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKindFilter(k)}
            className="rounded-full px-2 py-0.5 text-[10.5px] uppercase font-mono tracking-wider"
            style={{
              background: kindFilter === k ? 'var(--c-accent-soft)' : 'transparent',
              color: kindFilter === k ? 'var(--c-accent-ink, var(--c-accent))' : 'var(--c-muted)',
              border: '1px solid var(--c-hair)',
            }}
          >
            {k}
          </button>
        ))}
      </div>

      <TagFilterBar {...tagBar} />
      <ListScrollArea
        loading={isLoading}
        empty={acs.length === 0}
        emptyTitle="No AC match your filters."
        emptyHint={
          <>
            Create with <span className="font-mono">/ac</span> in the editor or chat.
          </>
        }
        createLabel="Create your first AC"
        onCreate={handleCreate}
      >
        {acs.map((a) => {
          const deprecated = a.status === 'deprecated';
          return (
            <EntityListRow
              key={a.slug}
              leading={
                <CheckSquare size={16} style={{ color: 'var(--c-accent)', marginTop: 2 }} />
              }
              onClick={() => onSelect(a.slug)}
              tags={a.tags}
              tagLookup={tagLookup}
              align="start"
              style={{ opacity: deprecated ? 0.65 : 1 }}
            >
              <div
                className="text-[13.5px]"
                style={{
                  color: 'var(--c-ink)',
                  fontWeight: 500,
                  textDecoration: deprecated ? 'line-through' : undefined,
                }}
              >
                {a.text}
              </div>
              <div
                className="mt-1 flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-wider"
                style={{ color: 'var(--c-subtle)' }}
              >
                <span>{a.kind}</span>
                {deprecated && <span>· deprecated</span>}
                {a.verifies.length > 0 && <span>· verifies {a.verifies.length}</span>}
              </div>
            </EntityListRow>
          );
        })}
      </ListScrollArea>
    </ListPageLayout>
  );
}
