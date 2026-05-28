import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, FileText, GitCommit, MoreHorizontal, Plus, RotateCcw } from 'lucide-react';
import type {
  RawDeltaEntityChange,
  RawDeltaPageChange,
} from '../../shared/entities.js';
import {
  useRelease,
  useReleases,
  useReleaseDiff,
  useReleaseSnapshot,
  useRestoreSpec,
  useUpdateRelease,
} from '../hooks/useReleases.js';
import { useReleasePushes } from '../hooks/useReleasePushes.js';
import { listReleaseActions } from '../lib/release-actions/registry.js';
import { EntityDiffCard } from './release/EntityDiffCard.js';
import { PageDiffCard } from './release/PageDiffCard.js';
import { ReleasePushesList } from './release/ReleasePushesList.js';
import { UnreleasedBanner } from './release/UnreleasedBanner.js';
import { CreateBriefDialog } from './CreateBriefDialog.js';
// Side-effect import: registers the M25 "Push to remote" action in the registry.
import './release/push-to-remote-action.js';

interface Props {
  idOrName: string;
}

/**
 * Sekcje per typ w kolejności wymaganej przez spec m17uidet01:
 *   Pages → Endpoints → DTOs → Database Tables → UI Views.
 */
const ENTITY_SECTION_ORDER = [
  { type: 'endpoint', label: 'Endpoints' },
  { type: 'dto', label: 'DTOs' },
  { type: 'database-table', label: 'Database Tables' },
  { type: 'ui-view', label: 'UI Views' },
] as const;

const TYPE_LABEL_SINGULAR: Record<string, string> = {
  endpoint: 'endpoint',
  dto: 'DTO',
  'database-table': 'table',
  'ui-view': 'view',
};

const TYPE_LABEL_PLURAL: Record<string, string> = {
  endpoint: 'endpoints',
  dto: 'DTOs',
  'database-table': 'tables',
  'ui-view': 'views',
};

export function ReleaseDetail({ idOrName }: Props) {
  const { data: release, isLoading } = useRelease(idOrName);
  const { data: allReleases = [] } = useReleases();
  const restoreSpec = useRestoreSpec();
  const updateRelease = useUpdateRelease();
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [compareTo, setCompareTo] = useState<string | null>(null);
  // M21 m21ui: Generate brief modal — `to` jest biezacym release, user wybiera `from`.
  const [generateBriefOpen, setGenerateBriefOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // v0.1.12 — najnowszy release jest mutowalny (id == MAX(id)). Lista jest newest-first.
  const maxReleaseId = allReleases[0]?.id ?? null;
  const isLatest = release ? release.id === maxReleaseId : false;

  // Inline-edit drafts dla name/description (tylko gdy isLatest).
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const lastReleaseIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (release && release.id !== lastReleaseIdRef.current) {
      lastReleaseIdRef.current = release.id;
      setNameDraft(release.name);
      setDescriptionDraft(release.description);
    } else if (release) {
      // Po sukcesie mutacji odświeżamy drafty z aktualnych wartości,
      // ale tylko gdy nie jesteśmy w trakcie edycji (drafty == server values).
      // Tu trzymamy bieżące wartości serwera w razie zewnętrznej zmiany.
      if (!updateRelease.isPending) {
        setNameDraft((d) => (d === release.name ? d : release.name));
        setDescriptionDraft((d) => (d === release.description ? d : release.description));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release?.id, release?.name, release?.description, updateRelease.isPending]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function saveName() {
    if (!release || !isLatest) return;
    const next = nameDraft.trim();
    if (!next || next === release.name) {
      setNameDraft(release.name);
      return;
    }
    try {
      await updateRelease.mutateAsync({ idOrName: release.id, name: next });
    } catch (err) {
      alert((err as Error).message);
      setNameDraft(release.name);
    }
  }

  async function saveDescription() {
    if (!release || !isLatest) return;
    const next = descriptionDraft.trim();
    if (!next || next === release.description) {
      setDescriptionDraft(release.description);
      return;
    }
    try {
      await updateRelease.mutateAsync({ idOrName: release.id, description: next });
    } catch (err) {
      alert((err as Error).message);
      setDescriptionDraft(release.description);
    }
  }

  async function pullUnreleased() {
    if (!release || !isLatest) return;
    try {
      await updateRelease.mutateAsync({ idOrName: release.id, assignUnreleased: true });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  // Default compare target: previous release (older), or `__INITIAL__` for the first release.
  const sortedByDate = [...allReleases].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt),
  );
  const currentIdx = sortedByDate.findIndex((r) => r.name === release?.name);
  const defaultCompare =
    currentIdx > 0 ? sortedByDate[currentIdx - 1]!.name : '__INITIAL__';
  const activeCompare = compareTo ?? defaultCompare;

  const diffFrom = activeCompare === '__INITIAL__' ? null : activeCompare;
  const { data: diff } = useReleaseDiff(diffFrom, release?.name);
  // For `deleted` rendering we need the snapshot of the `from` release.
  // diff.from === null ⇒ initial brief diff (synthetic empty fromSnap), no snapshot to fetch.
  const { data: fromSnapshot } = useReleaseSnapshot(diff?.from?.name ?? undefined);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--c-subtle)' }}>
        Loading release…
      </div>
    );
  }
  if (!release) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--c-subtle)' }}>
        Release not found.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div
        className="flex items-start gap-3 px-8 py-4"
        style={{ borderBottom: '1px solid var(--c-hair)' }}
      >
        <Link
          to="/releases"
          className="rounded-md p-1 mt-0.5"
          style={{ color: 'var(--c-muted)' }}
          title="Back to releases"
        >
          <ArrowLeft size={16} />
        </Link>
        <GitCommit size={18} style={{ color: 'var(--c-accent)', marginTop: 1 }} />
        <div className="flex-1 min-w-0">
          {isLatest ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={(e) => {
                e.currentTarget.style.border = '1px solid transparent';
                e.currentTarget.style.background = 'transparent';
                saveName();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setNameDraft(release.name);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = '1px solid var(--c-hair)';
                e.currentTarget.style.background = 'var(--c-card)';
              }}
              disabled={updateRelease.isPending}
              title="Click to rename — only the latest release is mutable"
              className="w-full text-[18px] font-semibold tracking-tight font-mono bg-transparent outline-none rounded-sm px-1 -ml-1"
              style={{
                color: 'var(--c-ink)',
                border: '1px solid transparent',
              }}
            />
          ) : (
            <h2 className="text-[18px] font-semibold tracking-tight font-mono" style={{ color: 'var(--c-ink)' }}>
              {release.name}
            </h2>
          )}
          <div className="text-[12px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--c-subtle)' }}>
            <span>by {release.createdBy} · {formatDate(release.createdAt)}</span>
            <PushedBadge releaseId={release.id} />
          </div>
          {isLatest ? (
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onBlur={(e) => {
                e.currentTarget.style.border = '1px solid transparent';
                e.currentTarget.style.background = 'transparent';
                saveDescription();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setDescriptionDraft(release.description);
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = '1px solid var(--c-hair)';
                e.currentTarget.style.background = 'var(--c-card)';
              }}
              disabled={updateRelease.isPending}
              rows={Math.max(1, descriptionDraft.split('\n').length)}
              title="Click to edit description — Cmd/Ctrl+Enter to save"
              className="w-full text-[13px] mt-2 bg-transparent outline-none resize-none rounded-sm px-1 -ml-1"
              style={{
                color: 'var(--c-muted)',
                border: '1px solid transparent',
              }}
            />
          ) : (
            <div className="text-[13px] mt-2" style={{ color: 'var(--c-muted)' }}>
              {release.description}
            </div>
          )}
          <div className="text-[11.5px] font-mono mt-2" style={{ color: 'var(--c-subtle)' }}>
            {Object.entries(release.countBreakdown.entities)
              .map(([type, n]) => `${n} ${type}`)
              .join(' · ')}{' '}
            · {release.countBreakdown.pages} pages · {release.countBreakdown.total} total captures
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="Release actions"
            className="flex items-center justify-center rounded-md p-1.5"
            style={{
              background: menuOpen ? 'var(--c-panel)' : 'var(--c-card)',
              color: 'var(--c-muted)',
              border: '1px solid var(--c-hair)',
            }}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 py-1"
              style={{
                top: 'calc(100% + 4px)',
                minWidth: 240,
                background: 'var(--c-card)',
                border: '1px solid var(--c-hair-strong)',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                zIndex: 40,
              }}
            >
              <button
                onClick={() => {
                  pullUnreleased();
                  setMenuOpen(false);
                }}
                disabled={!isLatest || updateRelease.isPending}
                title={
                  isLatest
                    ? 'Pull all unreleased entity/page versions into this release'
                    : 'Frozen — pull only allowed on latest release'
                }
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12.5px]"
                style={{
                  color: 'var(--c-muted)',
                  opacity: isLatest ? 1 : 0.5,
                  cursor: isLatest ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={(e) => {
                  if (isLatest && !updateRelease.isPending)
                    e.currentTarget.style.background = 'var(--c-panel)';
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Plus size={13} />
                Pull in unreleased changes
              </button>
              <button
                onClick={() => {
                  setConfirmRestore(true);
                  setMenuOpen(false);
                }}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-[12.5px]"
                style={{ color: 'var(--c-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-panel)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <RotateCcw size={13} />
                Restore entire spec
              </button>
              {/* M17 actions registry — extension point (M25 "Push to remote", …). */}
              {listReleaseActions().map((a) => (
                <div key={a.id}>{a.render({ release, onClose: () => setMenuOpen(false) })}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto nice-scroll">
        <div className="mx-auto" style={{ maxWidth: 920, padding: '24px 32px 48px' }}>
          {/* M25: unreleased-changes banner — only on the latest (mutable) release. */}
          {isLatest && <UnreleasedBanner />}

          {/* Compare-to selector */}
          <div className="flex items-center gap-2 mb-4 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
            <span>Compare to:</span>
            <select
              value={activeCompare ?? ''}
              onChange={(e) => setCompareTo(e.target.value || null)}
              className="rounded-md px-2 py-1 text-[12.5px] font-mono"
              style={{
                background: 'var(--c-card)',
                border: '1px solid var(--c-hair)',
                color: 'var(--c-ink)',
              }}
            >
              <option value="">— none —</option>
              <option value="__INITIAL__">— initial state —</option>
              {allReleases
                .filter((r) => r.name !== release.name)
                .map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name}
                  </option>
                ))}
            </select>
            {activeCompare && (
              <span className="text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
                {activeCompare === '__INITIAL__' ? 'initial state' : activeCompare} → {release.name}
              </span>
            )}
          </div>

          {!activeCompare && (
            <div
              className="text-center py-12 rounded-lg text-[12.5px]"
              style={{
                background: 'var(--c-card)',
                border: '1px dashed var(--c-hair-strong)',
                color: 'var(--c-subtle)',
              }}
            >
              Select a release to compare against to see the diff.
            </div>
          )}

          {activeCompare && diff && (
            <DeltaSection
              entityChanges={diff.entities}
              pageChanges={diff.pages}
              fromSnapshot={fromSnapshot}
            />
          )}

          {/* M25: push history for this release. */}
          <ReleasePushesList releaseId={release.id} />
        </div>
      </div>

      <footer
        className="px-8 py-2.5 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
      >
        <div className="flex-1" />
        <button
          onClick={() => setGenerateBriefOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
          title="Generate a narrative brief comparing this release with another"
        >
          <FileText size={12} />
          Generate brief from this release
        </button>
      </footer>

      {confirmRestore && (
        <ConfirmRestoreDialog
          title={`Restore entire spec to "${release.name}"?`}
          description="This generates normal mutations through the write API; the resulting changes will appear as a new round of unreleased entity/page versions. Append-only — undoable by another restore."
          confirmLabel="Restore spec"
          loading={restoreSpec.isPending}
          onConfirm={async () => {
            try {
              await restoreSpec.mutateAsync(release.name);
              setConfirmRestore(false);
            } catch (err) {
              alert((err as Error).message);
            }
          }}
          onCancel={() => setConfirmRestore(false)}
        />
      )}
      {generateBriefOpen && (
        <CreateBriefDialog
          toReleaseName={release.name}
          onClose={() => setGenerateBriefOpen(false)}
        />
      )}
    </div>
  );
}

function DeltaSection({
  entityChanges,
  pageChanges,
  fromSnapshot,
}: {
  entityChanges: RawDeltaEntityChange[];
  pageChanges: RawDeltaPageChange[];
  fromSnapshot: ReturnType<typeof useReleaseSnapshot>['data'];
}) {
  const visiblePages = pageChanges.filter((c) => c.op !== 'noop');
  const entitiesByType = useMemo(() => groupByType(entityChanges), [entityChanges]);

  const counter = useMemo(
    () => buildGlobalCounter(visiblePages.length, entitiesByType),
    [visiblePages.length, entitiesByType],
  );

  if (counter.total === 0) {
    return (
      <div
        className="text-center py-12 rounded-lg text-[12.5px]"
        style={{
          background: 'var(--c-card)',
          border: '1px dashed var(--c-hair-strong)',
          color: 'var(--c-subtle)',
        }}
      >
        No changes between these two releases.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Globalny licznik zmian (m17uidet01) */}
      <div
        className="text-[13px]"
        style={{ color: 'var(--c-ink)' }}
      >
        <strong>{counter.total} {counter.total === 1 ? 'change' : 'changes'}:</strong>{' '}
        <span style={{ color: 'var(--c-muted)' }}>{counter.parts.join(', ')}</span>
      </div>

      {/* Pages first (m17uidet01 kolejność) */}
      {visiblePages.length > 0 && (
        <section>
          <SectionHeading label={`Pages (${visiblePages.length})`} />
          <div className="space-y-2">
            {visiblePages.map((c) => (
              <PageDiffCard key={c.path} change={c} />
            ))}
          </div>
        </section>
      )}

      {/* Entities w kolejności: Endpoints → DTOs → Database Tables → UI Views. Sekcje z 0 zmian — UKRYTE. */}
      {ENTITY_SECTION_ORDER.map(({ type, label }) => {
        const items = entitiesByType.get(type) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={type}>
            <SectionHeading label={`${label} (${items.length})`} />
            <div className="space-y-2">
              {items.map((c) => (
                <EntityDiffCard
                  key={`${c.type}-${c.slug}`}
                  change={c}
                  fromSnapshot={fromSnapshot ?? undefined}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Encje typu spoza ENTITY_SECTION_ORDER — fallback na końcu. */}
      {Array.from(entitiesByType.keys())
        .filter((t) => !ENTITY_SECTION_ORDER.some((s) => s.type === t))
        .map((type) => {
          const items = entitiesByType.get(type)!;
          if (items.length === 0) return null;
          return (
            <section key={type}>
              <SectionHeading label={`${type} (${items.length})`} />
              <div className="space-y-2">
                {items.map((c) => (
                  <EntityDiffCard
                    key={`${c.type}-${c.slug}`}
                    change={c}
                    fromSnapshot={fromSnapshot ?? undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}

function groupByType(changes: RawDeltaEntityChange[]): Map<string, RawDeltaEntityChange[]> {
  const out = new Map<string, RawDeltaEntityChange[]>();
  for (const c of changes) {
    if (c.op === 'noop') continue;
    const arr = out.get(c.type) ?? [];
    arr.push(c);
    out.set(c.type, arr);
  }
  return out;
}

function buildGlobalCounter(
  pagesCount: number,
  entitiesByType: Map<string, RawDeltaEntityChange[]>,
): { total: number; parts: string[] } {
  const parts: string[] = [];
  if (pagesCount > 0) parts.push(`${pagesCount} ${pagesCount === 1 ? 'page' : 'pages'}`);
  let total = pagesCount;
  for (const { type } of ENTITY_SECTION_ORDER) {
    const n = entitiesByType.get(type)?.length ?? 0;
    if (n === 0) continue;
    total += n;
    const label = n === 1 ? TYPE_LABEL_SINGULAR[type] ?? type : TYPE_LABEL_PLURAL[type] ?? type;
    parts.push(`${n} ${label}`);
  }
  for (const [type, items] of entitiesByType) {
    if (ENTITY_SECTION_ORDER.some((s) => s.type === type)) continue;
    if (items.length === 0) continue;
    total += items.length;
    parts.push(`${items.length} ${type}`);
  }
  return { total, parts };
}

function SectionHeading({ label }: { label: string }) {
  return (
    <h3
      className="text-[11px] uppercase tracking-wider font-mono font-semibold mb-2"
      style={{ color: 'var(--c-subtle)' }}
    >
      {label}
    </h3>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString();
  } catch {
    return iso;
  }
}

/** "Pushed" / "Pushed N×" badge next to the release name — counts successful pushes. */
function PushedBadge({ releaseId }: { releaseId: number }) {
  const { data: pushes = [] } = useReleasePushes(releaseId);
  const n = pushes.filter((p) => p.status === 'success').length;
  if (n === 0) return null;
  return (
    <span
      className="inline-block rounded text-[10px] font-mono px-1.5 py-0.5"
      style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent-ink)' }}
    >
      {n === 1 ? 'Pushed' : `Pushed ${n}×`}
    </span>
  );
}

function ConfirmRestoreDialog({
  title,
  description,
  confirmLabel,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg flex flex-col"
        style={{
          width: 480,
          background: 'var(--c-bg)',
          border: '1px solid var(--c-hair-strong)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--c-hair)' }}>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--c-ink)' }}>
            {title}
          </div>
        </div>
        <div className="px-5 py-4 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
          {description}
        </div>
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--c-hair)' }}
        >
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1 text-[12.5px]"
            style={{
              background: 'var(--c-card)',
              color: 'var(--c-muted)',
              border: '1px solid var(--c-hair)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="rounded-md px-3 py-1 text-[12.5px]"
            style={{
              background: 'var(--c-accent)',
              color: '#fff',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Restoring…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
