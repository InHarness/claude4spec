import { useMemo, useState } from 'react';
import { CheckSquare, Plus, Search } from 'lucide-react';
import { TagChip } from '../../components/atoms.js';
import { useAcs, useCreateAc } from '../../hooks/useAcs.js';
import { useTags } from '../../hooks/useTags.js';
import { openPopover, toast } from '../../ui/events.js';
import type { Ac, AcKind, AcStatus } from '../../../shared/entities.js';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

export function AcsList({ search, tagFilter, onSearchChange, onTagToggle, onSelect }: Props) {
  const [tagMode, setTagMode] = useState<'and' | 'or'>('or');
  const [statusFilter, setStatusFilter] = useState<AcStatus | 'all'>('active');
  const [kindFilter, setKindFilter] = useState<AcKind | 'all'>('all');
  const createAc = useCreateAc();

  const query = useMemo(
    () => ({
      search: search || undefined,
      tags: tagFilter.length ? tagFilter : undefined,
      tagFilter: tagFilter.length ? tagMode : undefined,
      status: statusFilter,
      ...(kindFilter !== 'all' ? { kind: kindFilter } : {}),
    }),
    [search, tagFilter, tagMode, statusFilter, kindFilter],
  );

  const { data: acs = [], isLoading } = useAcs(query);
  const { data: tags = [] } = useTags();

  const tagsWithAcs = tags.filter((t) => (t.counts.ac ?? 0) > 0);

  async function handleCreate(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const result = await openPopover(
      'create-ac',
      { x: rect.left, y: rect.bottom + 6 },
      {},
    );
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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <CheckSquare size={18} style={{ color: 'var(--c-accent)' }} />
        <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
          Acceptance Criteria
        </h2>
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {acs.length} {acs.length === 1 ? 'result' : 'results'}
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
            placeholder="Search text, slug, description…"
            style={{ color: 'var(--c-ink)' }}
          />
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={13} /> New AC
        </button>
      </div>

      <div
        className="px-8 py-2 flex items-center gap-2 flex-wrap text-[11.5px]"
        style={{ borderBottom: '1px solid var(--c-hair)', color: 'var(--c-muted)' }}
      >
        <span className="text-[10.5px] uppercase font-mono tracking-wider" style={{ color: 'var(--c-subtle)' }}>
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

        <span className="ml-4 text-[10.5px] uppercase font-mono tracking-wider" style={{ color: 'var(--c-subtle)' }}>
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

      {tagsWithAcs.length > 0 && (
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
          {tagsWithAcs.map((tag) => (
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
          {!isLoading && acs.length === 0 && (
            <div
              className="text-center py-20 rounded-lg"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              <div className="text-[14px] mb-2">No AC match your filters.</div>
              <div className="text-[12px] mb-4">
                Create with <span className="font-mono">/ac</span> in the editor or chat.
              </div>
              <button
                onClick={handleCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium mt-2"
                style={{ background: 'var(--c-accent)', color: '#fff' }}
              >
                <Plus size={13} /> Create your first AC
              </button>
            </div>
          )}
          {!isLoading &&
            acs.map((a) => (
              <AcListRow
                key={a.slug}
                ac={a}
                onClick={() => onSelect(a.slug)}
                tagLookup={new Map(tags.map((t) => [t.slug, t]))}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function AcListRow({
  ac,
  onClick,
  tagLookup,
}: {
  ac: Ac;
  onClick: () => void;
  tagLookup: Map<string, { slug: string; name: string; color: string | null }>;
}) {
  const deprecated = ac.status === 'deprecated';
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 rounded-md transition mb-1"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
        opacity: deprecated ? 0.65 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <CheckSquare size={16} style={{ color: 'var(--c-accent)', marginTop: 2 }} />
      <div className="flex-1 min-w-0">
        <div
          className="text-[13.5px]"
          style={{
            color: 'var(--c-ink)',
            fontWeight: 500,
            textDecoration: deprecated ? 'line-through' : undefined,
          }}
        >
          {ac.text}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-wider" style={{ color: 'var(--c-subtle)' }}>
          <span>{ac.kind}</span>
          {deprecated && <span>· deprecated</span>}
          {ac.verifies.length > 0 && <span>· verifies {ac.verifies.length}</span>}
        </div>
        {ac.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1.5">
            {ac.tags.map((ts) => (
              <TagChip
                key={ts}
                tag={tagLookup.get(ts) ?? { slug: ts, name: ts, color: null }}
                small
              />
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
