import { useMemo, useState } from 'react';
import { Braces, Plus, Search } from 'lucide-react';
import { TagChip } from '../../components/atoms.js';
import { useDtos, useCreateDto } from '../../hooks/useDtos.js';
import { useTags } from '../../hooks/useTags.js';
import { openPopover, toast } from '../../ui/events.js';
import type { Dto } from '../../../shared/entities.js';

interface Props {
  search: string;
  tagFilter: string[];
  onSearchChange: (q: string) => void;
  onTagToggle: (tag: string) => void;
  onSelect: (slug: string) => void;
}

export function DtosList({
  search,
  tagFilter,
  onSearchChange,
  onTagToggle,
  onSelect,
}: Props) {
  const [tagMode, setTagMode] = useState<'and' | 'or'>('or');
  const createDto = useCreateDto();

  const query = useMemo(
    () => ({
      search: search || undefined,
      tags: tagFilter.length ? tagFilter : undefined,
      tagFilter: tagFilter.length ? tagMode : undefined,
    }),
    [search, tagFilter, tagMode]
  );

  const { data: dtos = [], isLoading } = useDtos(query);
  const { data: tags = [] } = useTags();

  const tagsWithDtos = tags.filter((t) => t.counts.dto > 0);

  async function handleCreate(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const result = await openPopover(
      'create-dto',
      { x: rect.left, y: rect.bottom + 6 },
      {},
    );
    if (!result) return;
    try {
      const dto = await createDto.mutateAsync(result);
      onSelect(dto.slug);
      toast.success(`DTO ${dto.name} created`);
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
        <Braces size={18} style={{ color: 'var(--c-accent)' }} />
        <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
          DTOs
        </h2>
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {dtos.length} {dtos.length === 1 ? 'result' : 'results'}
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
            placeholder="Search name, slug, description…"
            style={{ color: 'var(--c-ink)' }}
          />
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={13} /> New DTO
        </button>
      </div>

      {tagsWithDtos.length > 0 && (
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
          {tagsWithDtos.map((tag) => (
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
          {!isLoading && dtos.length === 0 && (
            <div
              className="text-center py-20 rounded-lg"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              <div className="text-[14px] mb-2">No DTOs match your filters.</div>
              <button
                onClick={handleCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium mt-2"
                style={{ background: 'var(--c-accent)', color: '#fff' }}
              >
                <Plus size={13} /> Create your first DTO
              </button>
            </div>
          )}
          {!isLoading &&
            dtos.map((d) => (
              <DtoRow
                key={d.slug}
                dto={d}
                onClick={() => onSelect(d.slug)}
                tagLookup={new Map(tags.map((t) => [t.slug, t]))}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function DtoRow({
  dto,
  onClick,
  tagLookup,
}: {
  dto: Dto;
  onClick: () => void;
  tagLookup: Map<string, { slug: string; name: string; color: string | null }>;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-md transition mb-1"
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      <Braces size={16} style={{ color: 'var(--c-accent)' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[14px]" style={{ color: 'var(--c-ink)', fontWeight: 500 }}>
            {dto.name}
          </span>
        </div>
        {dto.description && (
          <div className="text-[12.5px] truncate mt-0.5" style={{ color: 'var(--c-muted)' }}>
            {dto.description}
          </div>
        )}
        {dto.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1.5">
            {dto.tags.map((ts) => (
              <TagChip
                key={ts}
                tag={tagLookup.get(ts) ?? { slug: ts, name: ts, color: null }}
                small
              />
            ))}
          </div>
        )}
      </div>
      <span
        className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
      >
        {dto.fields.length}f
      </span>
    </button>
  );
}
