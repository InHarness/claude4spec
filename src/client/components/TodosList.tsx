import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FileText, StickyNote } from 'lucide-react';
import { useTodos } from '../hooks/useTodos.js';
import type { TodoHit } from '../../shared/types.js';

export function TodosList() {
  const { data, isLoading } = useTodos();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const all = data?.todos ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (t) => t.comment.toLowerCase().includes(q) || t.pagePath.toLowerCase().includes(q)
    );
  }, [data, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, TodoHit[]>();
    for (const t of filtered) {
      const arr = map.get(t.pagePath);
      if (arr) arr.push(t);
      else map.set(t.pagePath, [t]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const total = data?.counts.total ?? 0;

  if (isLoading && !data) {
    return (
      <div className="flex-1 p-10 text-[13px]" style={{ color: 'var(--c-subtle)' }}>
        Loading TODOs…
      </div>
    );
  }

  const isEmpty = total === 0;

  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 820, padding: '40px 48px 120px' }}>
        <div className="flex items-center gap-2 mb-4">
          <StickyNote size={18} style={{ color: '#a87033' }} />
          <h1 className="text-[18px] font-semibold" style={{ color: 'var(--c-ink)' }}>
            TODOs
          </h1>
          <span
            className="text-[12px] font-mono"
            style={{ color: 'var(--c-subtle)' }}
          >
            · {total}
          </span>
        </div>

        {!isEmpty && (
          <input
            type="search"
            placeholder="Filter by comment or file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md px-3 py-1.5 text-[13px] mb-5 outline-none"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-hair-strong)',
              color: 'var(--c-ink)',
            }}
          />
        )}

        {isEmpty ? (
          <div
            className="rounded-md p-8 text-center text-[13px]"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-subtle)',
              border: '1px dashed var(--c-hair-strong)',
            }}
          >
            No TODOs yet — use <span className="font-mono">/todo</span> in the editor to mark
            things you need to come back to.
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rounded-md p-5 text-center text-[13px]"
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-subtle)',
              border: '1px dashed var(--c-hair-strong)',
            }}
          >
            No TODOs match “{query}”.
          </div>
        ) : (
          grouped.map(([pagePath, hits]) => (
            <TodoGroup key={pagePath} pagePath={pagePath} hits={hits} />
          ))
        )}
      </div>
    </div>
  );
}

function TodoGroup({ pagePath, hits }: { pagePath: string; hits: TodoHit[] }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <FileText size={12} style={{ color: 'var(--c-muted)' }} />
        <h2 className="text-[12px] font-mono" style={{ color: 'var(--c-muted)' }}>
          {pagePath}
        </h2>
        <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
          {hits.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {hits.map((t) => (
          <TodoRow key={`${t.pagePath}:${t.anchor}`} hit={t} />
        ))}
      </div>
    </section>
  );
}

function TodoRow({ hit }: { hit: TodoHit }) {
  const navigate = useNavigate();
  const go = () => {
    void navigate({
      to: '/space/$rootId/$',
      params: { rootId: hit.rootId, _splat: hit.pagePath },
      hash: `anchor-${hit.anchor}`,
    });
  };
  return (
    <button
      onClick={go}
      className="w-full text-left rounded-md px-3 py-2 flex items-start gap-3"
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-hair-strong)',
      }}
    >
      <span
        className="inline-flex items-center justify-center rounded mt-0.5 shrink-0"
        style={{
          width: 18,
          height: 18,
          background: 'rgba(200, 130, 60, 0.14)',
          color: '#a87033',
        }}
      >
        <StickyNote size={11} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px]" style={{ color: 'var(--c-ink)' }}>
          {hit.comment || <span style={{ color: 'var(--c-subtle)' }}>(no comment)</span>}
        </div>
        <div
          className="text-[11px] font-mono mt-0.5"
          style={{ color: 'var(--c-subtle)' }}
        >
          line {hit.line}
        </div>
      </div>
    </button>
  );
}
