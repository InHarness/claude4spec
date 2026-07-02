import { useEffect, useState } from 'react';
import { Layers, X } from 'lucide-react';
import type { Root } from '../../../shared/types.js';
import type { RawDelta } from '../../../shared/entities.js';
import { apiFetch, handle } from '../../lib/api-core.js';

/**
 * 0.1.96 brief scope. Whole-release covers every releasable root (no `roots`
 * frontmatter / slug segment). A scoped brief carries an explicit list of
 * briefTarget root ids.
 */
export type BriefScope =
  | { kind: 'whole-release' }
  | { kind: 'roots'; roots: string[] };

type Count = number | null | 'loading';

interface FieldsProps {
  /** `null` = initial brief (no predecessor). Only used to probe changed-page counts. */
  fromReleaseName: string | null;
  toReleaseName: string;
  /** `config.roots` — filtered to `briefTarget` internally. */
  roots: Root[];
  /** Reports the current scope up on every mode/selection change. */
  onChange: (scope: BriefScope) => void;
  /**
   * Override the per-root changed-page count probe. Defaults to a
   * `release_diff({ summaryOnly: true, roots: [id] })` REST call.
   */
  fetchChangedCount?: (rootId: string) => Promise<number | null>;
}

/**
 * 0.1.96 brief-scope picker fields (M21 modal-scope, L13). Two modes:
 *   - whole-release (default): the brief covers every releasable root.
 *   - selected roots: the author checks specific briefTarget roots; each shows
 *     its changed-page count for the `from → to` diff so the scope is informed.
 *
 * Presentational + probe logic only (no dialog chrome / confirm button) so it can
 * be embedded directly inside the "Generate brief" modal (CreateBriefDialog) as
 * well as the standalone `BriefScopeModal`. The chosen `BriefScope` flows through
 * to `createBrief({ roots })` — `kind: 'whole-release'` ⇒ omit `roots`,
 * `kind: 'roots'` ⇒ pass the array.
 */
export function BriefScopeFields({
  fromReleaseName,
  toReleaseName,
  roots,
  onChange,
  fetchChangedCount,
}: FieldsProps) {
  const targets = roots.filter((r) => r.briefTarget);

  const [mode, setMode] = useState<'whole-release' | 'roots'>('whole-release');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [counts, setCounts] = useState<Record<string, Count>>({});

  useEffect(() => {
    let cancelled = false;
    const probe =
      fetchChangedCount ??
      ((rootId: string) => defaultChangedCount(fromReleaseName, toReleaseName, rootId));
    setCounts(Object.fromEntries(targets.map((r) => [r.id, 'loading' as Count])));
    for (const root of targets) {
      probe(root.id)
        .then((n) => {
          if (!cancelled) setCounts((prev) => ({ ...prev, [root.id]: n }));
        })
        .catch(() => {
          if (!cancelled) setCounts((prev) => ({ ...prev, [root.id]: null }));
        });
    }
    return () => {
      cancelled = true;
    };
    // targets is derived from `roots`; re-probe when the diff endpoints change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromReleaseName, toReleaseName, roots]);

  // Report the scope up whenever mode/selection changes. Called directly from the
  // handlers (not an effect) so the parent never needs to memoize `onChange`.
  const emit = (nextMode: 'whole-release' | 'roots', nextSelected: Set<string>) => {
    if (nextMode === 'whole-release') onChange({ kind: 'whole-release' });
    else onChange({ kind: 'roots', roots: targets.filter((r) => nextSelected.has(r.id)).map((r) => r.id) });
  };

  const chooseMode = (next: 'whole-release' | 'roots') => {
    setMode(next);
    emit(next, selected);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    emit(mode, next);
  };

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="radio"
          name="brief-scope"
          checked={mode === 'whole-release'}
          onChange={() => chooseMode('whole-release')}
          className="mt-0.5"
        />
        <span>
          <span style={{ color: 'var(--c-ink)' }}>Whole release</span>
          <span className="block text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
            Cover every releasable root.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="radio"
          name="brief-scope"
          checked={mode === 'roots'}
          onChange={() => chooseMode('roots')}
          className="mt-0.5"
        />
        <span>
          <span style={{ color: 'var(--c-ink)' }}>Selected roots</span>
          <span className="block text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
            Scope the brief to specific roots.
          </span>
        </span>
      </label>

      {mode === 'roots' && (
        <div
          className="rounded-md p-2 space-y-1.5"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
        >
          {targets.length === 0 && (
            <div className="text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
              No brief-target roots configured.
            </div>
          )}
          {targets.map((root) => {
            const count = counts[root.id];
            return (
              <label
                key={root.id}
                className="flex items-center justify-between gap-2 cursor-pointer px-1 py-0.5"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(root.id)}
                    onChange={() => toggle(root.id)}
                  />
                  <span style={{ color: 'var(--c-ink)' }}>{root.name}</span>
                  <span className="font-mono text-[11px]" style={{ color: 'var(--c-muted)' }}>
                    {root.id}
                  </span>
                </span>
                <span className="font-mono text-[11px]" style={{ color: 'var(--c-muted)' }}>
                  {count === 'loading'
                    ? '…'
                    : count == null
                      ? '—'
                      : `${count} changed`}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ModalProps {
  fromReleaseName: string | null;
  toReleaseName: string;
  roots: Root[];
  onConfirm: (scope: BriefScope) => void;
  onClose: () => void;
  fetchChangedCount?: (rootId: string) => Promise<number | null>;
}

/**
 * Standalone brief-scope modal (dialog chrome around `BriefScopeFields`). Not
 * currently mounted in the "Generate brief" flow — the scope fields are embedded
 * directly in `CreateBriefDialog` — but kept as a self-contained picker for any
 * caller that wants scope selection as its own step.
 */
export function BriefScopeModal({
  fromReleaseName,
  toReleaseName,
  roots,
  onConfirm,
  onClose,
  fetchChangedCount,
}: ModalProps) {
  const [scope, setScope] = useState<BriefScope>({ kind: 'whole-release' });
  const canConfirm = scope.kind === 'whole-release' || scope.roots.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-lg w-[480px] p-5"
        style={{
          background: 'var(--c-bg)',
          border: '1px solid var(--c-hair-strong)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers size={16} style={{ color: 'var(--c-accent)' }} />
            <h3 className="text-[14px] font-semibold" style={{ color: 'var(--c-ink)' }}>
              Brief scope
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 btn-ghost"
            style={{ color: 'var(--c-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="text-[12.5px]">
          <BriefScopeFields
            fromReleaseName={fromReleaseName}
            toReleaseName={toReleaseName}
            roots={roots}
            onChange={setScope}
            fetchChangedCount={fetchChangedCount}
          />
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[12.5px] btn-ghost"
            style={{ color: 'var(--c-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(scope)}
            disabled={!canConfirm}
            className="px-3 py-1.5 rounded text-[12.5px]"
            style={{ background: 'var(--c-accent)', color: '#fff', opacity: canConfirm ? 1 : 0.6 }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Default probe — `release_diff({ summaryOnly: true, roots: [rootId] })` via REST.
 * Returns the changed-page count for `rootId` between `from → to`, or `null` when
 * the diff cannot be computed.
 */
async function defaultChangedCount(
  fromReleaseName: string | null,
  toReleaseName: string,
  rootId: string,
): Promise<number | null> {
  const fromSeg = fromReleaseName === null ? '__INITIAL__' : encodeURIComponent(fromReleaseName);
  const params = new URLSearchParams({ summaryOnly: 'true', roots: rootId });
  try {
    const delta = await handle<RawDelta>(
      await apiFetch(
        `/api/releases/${fromSeg}/diff/${encodeURIComponent(toReleaseName)}?${params.toString()}`,
      ),
    );
    return Array.isArray(delta.pages) ? delta.pages.length : 0;
  } catch {
    return null;
  }
}
