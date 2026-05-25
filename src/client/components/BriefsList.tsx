import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { FileText, FileWarning, MessageSquarePlus, ChevronDown, ChevronRight } from 'lucide-react';
import type { BriefListItem, PatchListItem } from '../../shared/entities.js';
import { useBriefs, useCreateBriefThread } from '../hooks/useBriefs.js';
import { usePatches, useCreatePatchThread } from '../hooks/usePatches.js';
import { encodeBriefPath } from '../lib/briefs-api.js';
import { encodePatchPath } from '../lib/patches-api.js';
import { useChatStore } from '../state/chat.js';
import { usePersistedState } from '../state/persisted.js';
import { SegmentedControl } from './SegmentedControl.js';

type ImplementedFilter = 'all' | 'done' | 'pending';

/**
 * M21 /briefs list. 3-state filter (All / Done / Pending) sterujący query
 * paramem `?implemented`. Default `all`. Sort po `toRelease` desc (najnowszy
 * release na gorze) z fallbackiem na `path`.
 *
 * M23: patches are shown nested under their originating brief. Patches with no
 * resolvable brief land in a separate "Orphaned patches" group at the bottom.
 */
export function BriefsList() {
  const [filter, setFilter] = useState<ImplementedFilter>('all');
  const implementedFilter =
    filter === 'all' ? undefined : filter === 'done';
  const { data: briefs = [], isLoading } = useBriefs({ implemented: implementedFilter });
  const { data: patches = [] } = usePatches();
  const [collapsed, setCollapsed] = usePersistedState<string[]>(
    'c4s:briefs:collapsed-patches',
    [],
    1,
  );
  const toggleCollapsed = (path: string) =>
    setCollapsed(
      collapsed.includes(path)
        ? collapsed.filter((p) => p !== path)
        : [...collapsed, path],
    );

  const sortedBriefs = briefs
    .slice()
    .sort(
      (a, b) =>
        b.toRelease.localeCompare(a.toRelease, undefined, { numeric: true }) ||
        a.path.localeCompare(b.path),
    );

  // Group patches by their resolved brief; unresolved ⇒ orphan.
  const briefPathSet = new Set(briefs.map((b) => b.path));
  const patchesByBrief = new Map<string, PatchListItem[]>();
  const orphans: PatchListItem[] = [];
  for (const p of patches) {
    if (p.briefPath && briefPathSet.has(p.briefPath)) {
      const arr = patchesByBrief.get(p.briefPath) ?? [];
      arr.push(p);
      patchesByBrief.set(p.briefPath, arr);
    } else {
      orphans.push(p);
    }
  }

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
          {patches.length > 0 && ` · ${patches.length} ${patches.length === 1 ? 'patch' : 'patches'}`}
        </span>
        <span className="flex-1" />
        <SegmentedControl
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'done', label: 'Done' },
            { value: 'pending', label: 'Pending' },
          ]}
        />
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
              const briefPatches = patchesByBrief.get(b.path) ?? [];
              const isCollapsed = collapsed.includes(b.path);
              return (
                <div key={b.path}>
                  <BriefRow
                    brief={b}
                    patchCount={briefPatches.length}
                    isCollapsed={isCollapsed}
                    onToggleCollapsed={() => toggleCollapsed(b.path)}
                  />
                  {briefPatches.length > 0 && !isCollapsed && (
                    <div className="mt-1 ml-6 space-y-1">
                      {briefPatches.map((p) => (
                        <PatchRow key={p.path} patch={p} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {orphans.length > 0 && (
            <div className="mt-8">
              <div
                className="flex items-center gap-2 mb-2 text-[12px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--c-subtle)' }}
              >
                <FileWarning size={13} />
                Orphaned patches
                <span className="font-mono font-normal">({orphans.length})</span>
              </div>
              <div className="space-y-1">
                {orphans.map((p) => (
                  <PatchRow key={p.path} patch={p} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Brief row — wydzielony komponent, by `useCreateBriefThread` mogło żyć w hook
 * scope na poziomie wiersza. Wyświetla `brief.path` jako tytuł (font-mono),
 * obsługuje chevron toggle dla listy patchy oraz ikoniczny przycisk „Run new
 * thread" otwierający chat side panel.
 */
function BriefRow({
  brief,
  patchCount,
  isCollapsed,
  onToggleCollapsed,
}: {
  brief: BriefListItem;
  patchCount: number;
  isCollapsed: boolean;
  onToggleCollapsed(): void;
}) {
  const createThread = useCreateBriefThread(brief.path);
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);

  const handleNewThread = async () => {
    const result = await createThread.mutateAsync(undefined);
    setChatThreadId(result.threadId);
    setChatOpen(true);
  };

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
    >
      {patchCount > 0 ? (
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="rounded p-0.5 btn-ghost shrink-0"
          style={{ marginTop: 1 }}
          title={isCollapsed ? `Show ${patchCount} ${patchCount === 1 ? 'patch' : 'patches'}` : 'Hide patches'}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      ) : (
        <span style={{ width: 22 }} aria-hidden />
      )}
      <FileText size={14} style={{ color: 'var(--c-accent)', marginTop: 3 }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Link
            to="/briefs/$path"
            params={{ path: encodeBriefPath(brief.path) }}
            className="text-[13px] font-mono font-semibold truncate"
            style={{ color: 'var(--c-ink)' }}
          >
            {brief.path}
          </Link>
          {brief.fromRelease === null ? (
            <InitialBadge />
          ) : (
            <ReleaseBadge label={brief.fromRelease} />
          )}
          <span style={{ color: 'var(--c-subtle)', fontSize: 11 }}>→</span>
          <ReleaseBadge label={brief.toRelease} />
          <ImplementedBadge implemented={brief.implemented} />
        </div>
        <div
          className="flex items-center gap-3 mt-1 text-[11px]"
          style={{ color: 'var(--c-subtle)' }}
        >
          <span>last modified {formatRelative(brief.lastModifiedAt ?? brief.generatedAt)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={handleNewThread}
        disabled={createThread.isPending}
        className="rounded-md p-1.5 btn-ghost shrink-0"
        style={{ opacity: createThread.isPending ? 0.5 : 1 }}
        title="Run new thread"
      >
        <MessageSquarePlus size={14} />
      </button>
    </div>
  );
}

/**
 * M23 patch row — nested under a brief, or in the "Orphaned patches" group.
 * Tytuł = `patch.path` (font-mono). Ikoniczny „Run new thread" zamiast długiego
 * tekstowego przycisku; usunięto informację o thread count.
 */
function PatchRow({ patch }: { patch: PatchListItem }) {
  const createThread = useCreatePatchThread(patch.path);
  const setChatThreadId = useChatStore((s) => s.setChatThreadId);
  const setChatOpen = useChatStore((s) => s.setChatOpen);

  const handleNewThread = async () => {
    const result = await createThread.mutateAsync(undefined);
    setChatThreadId(result.threadId);
    setChatOpen(true);
  };

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2 rounded-md"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      <FileWarning size={12} style={{ color: 'var(--c-muted)', marginTop: 3 }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <Link
            to="/patches/$path"
            params={{ path: encodePatchPath(patch.path) }}
            className="text-[12px] font-mono font-medium truncate"
            style={{ color: 'var(--c-ink)' }}
          >
            {patch.path}
          </Link>
          <PatchStatusBadge status={patch.status} />
        </div>
        <div
          className="flex items-center gap-2.5 mt-0.5 text-[10.5px]"
          style={{ color: 'var(--c-subtle)' }}
        >
          <span>{patch.patchKind}</span>
          <span>·</span>
          <span>by {patch.createdBy || 'unknown'}</span>
          <span>·</span>
          <span>modified {formatRelative(patch.lastModified)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={handleNewThread}
        disabled={createThread.isPending}
        className="rounded-md p-1 btn-ghost shrink-0"
        style={{ opacity: createThread.isPending ? 0.5 : 1 }}
        title="Run new thread"
      >
        <MessageSquarePlus size={12} />
      </button>
    </div>
  );
}

function PatchStatusBadge({ status }: { status: string }) {
  const completed = status === 'completed';
  return (
    <span
      className="font-mono text-[9.5px] px-1.5 py-0.5 rounded"
      style={
        completed
          ? { background: 'var(--c-green-soft)', color: 'var(--c-green)' }
          : { background: 'var(--c-yellow)', color: 'var(--c-yellow-ink)' }
      }
      title={completed ? 'Patch resolved' : 'Patch awaiting resolution'}
    >
      {completed ? 'completed' : 'awaiting'}
    </span>
  );
}

function ReleaseBadge({ label }: { label: string }) {
  return (
    <span
      className="font-mono text-[11px] px-1.5 py-0.5 rounded"
      style={{
        background: 'var(--c-hair)',
        color: 'var(--c-ink)',
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
        className="inline-flex items-center font-mono text-[10px] px-1.5 py-0.5 rounded"
        style={{ background: 'var(--c-green-soft)', color: 'var(--c-green)' }}
        title="Brief implemented (declared by implementer-agent or user)"
      >
        implemented
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center font-mono text-[10px] px-1.5 py-0.5 rounded"
      style={{ background: 'var(--c-yellow)', color: 'var(--c-yellow-ink)' }}
      title="Brief pending — not yet implemented"
    >
      pending
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
