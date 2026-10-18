import { useMemo, useState } from 'react';
import { CheckSquare, Plus, ScanSearch } from 'lucide-react';
import { useAcs } from './hooks.js';
import { AcCreateDialog } from './create-dialog.js';
import { toast } from '@c4s/plugin-runtime';
import {
  ActionBar,
  ActionButton,
  Badge,
  EmptyState,
  EntityListHeader,
  EntityListLayout,
  EntityListRow,
  LoadingState,
  SegmentedControlTabs,
  TagFilterBar,
} from '@c4s/plugin-runtime/ui';
import { startSeededThread } from '@c4s/plugin-runtime';
import type { AcKind, AcStatus } from '../../../types.js';
import { ListPageLayout } from '../../../frontend-kit/ListPageLayout.js';
// The list composes `EntityListHeader`, `EntityListLayout`, `LoadingState` and
// `EmptyState` directly; the package carries no `ListPageHeader` /
// `ListScrollArea` (their debt entries were struck from the slice in 2.1.20).
import { useEntityListQuery } from '../../../frontend-kit/useEntityListQuery.js';
import { AC_LABEL_PLURAL } from '../../../identity.js';

const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'deprecated', label: 'Deprecated' },
  { id: 'all', label: 'All' },
];

const KIND_TABS = [
  { id: 'all', label: 'All kinds' },
  { id: 'requirement', label: 'Requirement' },
  { id: 'edge-case', label: 'Edge case' },
];

/** The type's own empty text — one `EmptyState` for "none" and "none matching" alike. */
export const AC_LIST_EMPTY_TITLE = 'No acceptance criteria.';

/**
 * Seed prompt for the "Analyze consistency" action (brief 0.1.45 §2). Tells the
 * agent to run the LLM audit over *all* active AC by calling
 * `analyze_ac_against_entities` with no arguments.
 */
const ANALYZE_SEED_PROMPT = [
  'Run a consistency audit of all active acceptance criteria.',
  'Call the `analyze_ac_against_entities` tool with no arguments to check every active AC against the entities it verifies.',
  'Then summarize the issues you find, grouped by confidence (highest first), and suggest corrections.',
].join(' ');

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
  // Count of *active* AC, independent of the view's status filter — drives the
  // Analyze-consistency action (disabled when there is nothing to audit).
  const { data: activeAcs = [] } = useAcs({ status: 'active' });
  const activeCount = activeAcs.length;

  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCreate() {
    setDialogOpen(true);
  }

  /**
   * 2.1.16 (`ac-list`) — `EntityListHeader` (icon, title, count = length of the
   * fetched list, search, "New AC") with the `status` and `kind` filters side
   * by side in its `filters` slot; the whole screen is an `EntityListLayout`.
   * Two alternative states: `loading` (`LoadingState`) and `empty` (one
   * `EmptyState` with the type's text, no filter reset — the tag filter clears
   * in its own bar). No pagination, no error state.
   */
  const header = (
    <>
      <EntityListHeader
        icon={CheckSquare}
        title={AC_LABEL_PLURAL}
        count={acs.length}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search title, slug…"
        filters={
          <div className="flex items-center gap-2" data-testid="ac-list-filters">
            <SegmentedControlTabs
              tabs={STATUS_TABS}
              active={statusFilter}
              onChange={(id) => setStatusFilter(id as AcStatus | 'all')}
            />
            <SegmentedControlTabs
              tabs={KIND_TABS}
              active={kindFilter}
              onChange={(id) => setKindFilter(id as AcKind | 'all')}
            />
          </div>
        }
        actions={
          <ActionButton
            variant="primary"
            icon={<Plus size={13} />}
            label="New AC"
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
        ) : acs.length === 0 ? (
          <EmptyState title={AC_LIST_EMPTY_TITLE} />
        ) : (
          acs.map((a) => {
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
                {/*
                  `title`, which since 0.2.51 is the criterion itself. One-line
                  clamp: this page IS the criteria, so it is not cut to the
                  chip's 40 characters.
                */}
                <div
                  className="text-[13.5px] line-clamp-1"
                  style={{
                    color: 'var(--c-ink)',
                    fontWeight: 500,
                    textDecoration: deprecated ? 'line-through' : undefined,
                  }}
                  title={a.title}
                >
                  {a.title}
                </div>
                {/*
                  2.1.28 (ui-view `ac-list`): the `kind` badge and the status
                  badge (only for `deprecated`) are catalog `Badge`s, like the
                  tag chips `EntityListRow` draws. The title keeps its one-line
                  clamp (no ~40-character cut) and every tag chip shows, no "+N more" (2.1.30).
                */}
                <div
                  className="mt-1 flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-wider"
                  style={{ color: 'var(--c-subtle)' }}
                  data-testid="ac-row-badges"
                >
                  <Badge label={a.kind} small dot={false} mono />
                  {deprecated && <Badge label="deprecated" small dot={false} mono />}
                  {a.verifies.length > 0 && <span>verifies {a.verifies.length}</span>}
                </div>
              </EntityListRow>
            );
          })
        )}
      </EntityListLayout>

      {dialogOpen && (
        <AcCreateDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(slug) => {
            setDialogOpen(false);
            onSelect(slug);
            toast.success('AC created');
          }}
        />
      )}

      <ActionBar
        actions={[
          {
            label: 'Analyze consistency',
            icon: <ScanSearch size={14} />,
            variant: 'primary',
            disabled: activeCount === 0,
            title: activeCount === 0 ? 'No active AC to analyze' : undefined,
            onClick: () => startSeededThread(ANALYZE_SEED_PROMPT, { autoSubmit: true }),
          },
        ]}
      />
    </ListPageLayout>
  );
}
