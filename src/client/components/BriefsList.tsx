import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { FileText, MessageSquare } from 'lucide-react';
import { useBriefs } from '../hooks/useBriefs.js';
import { encodeBriefPath } from '../lib/briefs-api.js';

type ImplementedFilter = 'all' | 'done' | 'pending';

/**
 * M21 /briefs list. 3-state filter (All / Done / Pending) sterujący query
 * paramem `?implemented`. Default `all`. Sort po `toRelease` desc (najnowszy
 * release na gorze) z fallbackiem na `path`.
 */
export function BriefsList() {
  const [filter, setFilter] = useState<ImplementedFilter>('all');
  const implementedFilter =
    filter === 'all' ? undefined : filter === 'done';
  const { data: briefs = [], isLoading } = useBriefs({ implemented: implementedFilter });
  const sortedBriefs = briefs
    .slice()
    .sort(
      (a, b) =>
        b.toRelease.localeCompare(a.toRelease, undefined, { numeric: true }) ||
        a.path.localeCompare(b.path),
    );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-center gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <FileText size={18} style={{ color: 'var(--c-accent)' }} />
        <h2
          className="text-[18px] font-semibold tracking-tight"
          style={{ color: 'var(--c-ink)' }}
        >
          Briefs
        </h2>
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
          {briefs.length} {briefs.length === 1 ? 'brief' : 'briefs'}
        </span>
        <span className="flex-1" />
        <div
          className="flex items-center gap-0.5 p-0.5 rounded-md"
          style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
        >
          <FilterTab label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterTab label="Done" active={filter === 'done'} onClick={() => setFilter('done')} />
          <FilterTab label="Pending" active={filter === 'pending'} onClick={() => setFilter('pending')} />
        </div>
      </div>

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 1000, padding: '24px 32px 48px' }}>
          {isLoading && (
            <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
              Loading…
            </div>
          )}
          {!isLoading && sortedBriefs.length === 0 && (
            <div
              className="text-center py-20 rounded-lg"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              <div className="text-[14px]">
                {filter === 'done'
                  ? 'No implemented briefs yet.'
                  : filter === 'pending'
                  ? 'No pending briefs — everything is done.'
                  : 'No briefs yet.'}
              </div>
              {filter !== 'done' && (
                <div className="text-[12px] mt-1">
                  Open any release detail and click <strong>Generate brief from this release</strong>.
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            {sortedBriefs.map((b) => {
              const title = b.title ?? humanizePath(b.path);
              return (
                <div
                  key={b.path}
                  className="flex items-start gap-3 px-4 py-3 rounded-md"
                  style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
                >
                  <FileText size={14} style={{ color: 'var(--c-accent)', marginTop: 3 }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <Link
                        to="/briefs/$path"
                        params={{ path: encodeBriefPath(b.path) }}
                        className="text-[14px] font-semibold"
                        style={{ color: 'var(--c-ink)' }}
                      >
                        {title}
                      </Link>
                      {b.fromRelease === null ? (
                        <InitialBadge />
                      ) : (
                        <ReleaseBadge label={b.fromRelease} />
                      )}
                      <span style={{ color: 'var(--c-subtle)', fontSize: 11 }}>→</span>
                      <ReleaseBadge label={b.toRelease} />
                      <ImplementedBadge implemented={b.implemented} />
                    </div>
                    <div
                      className="flex items-center gap-3 mt-1 text-[11px]"
                      style={{ color: 'var(--c-subtle)' }}
                    >
                      <span className="font-mono">{b.path}</span>
                      <span>·</span>
                      <span>
                        {b.threadCount === 0 ? (
                          'no threads'
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare size={10} />
                            {b.threadCount} {b.threadCount === 1 ? 'thread' : 'threads'}
                          </span>
                        )}
                      </span>
                      <span>·</span>
                      <span>last modified {formatRelative(b.lastModifiedAt ?? b.generatedAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReleaseBadge({ label }: { label: string }) {
  return (
    <span
      className="font-mono text-[11px] px-1.5 py-0.5 rounded"
      style={{
        background: 'var(--c-accent)',
        color: '#fff',
      }}
    >
      {label}
    </span>
  );
}

function ImplementedBadge({ implemented }: { implemented: boolean }) {
  if (implemented) {
    return (
      <span
        className="inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-hair)', color: 'var(--c-ink)' }}
        title="Brief implemented (declared by implementer-agent or user)"
      >
        ✅ implemented
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
      title="Brief pending — not yet implemented"
    >
      ⏳ pending
    </span>
  );
}

function InitialBadge() {
  return (
    <span
      className="font-mono text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{
        background: 'transparent',
        color: 'var(--c-muted)',
        border: '1px dashed var(--c-hair-strong)',
      }}
      title="Initial brief — comparing against an empty baseline (no previous release)"
    >
      initial
    </span>
  );
}

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-0.5 rounded text-[11.5px] font-medium"
      style={{
        background: active ? 'var(--c-card)' : 'transparent',
        color: active ? 'var(--c-ink)' : 'var(--c-muted)',
        border: active ? '1px solid var(--c-hair-strong)' : '1px solid transparent',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function humanizePath(p: string): string {
  return p.replace(/\.md$/, '').replace(/-/g, ' ');
}

function formatRelative(iso: string): string {
  if (!iso) return 'unknown';
  try {
    const ts = new Date(iso.replace(' ', 'T') + 'Z').getTime();
    const diff = Date.now() - ts;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(ts).toLocaleDateString();
  } catch {
    return iso;
  }
}
