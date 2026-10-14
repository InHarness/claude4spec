import { useEffect, useState } from 'react';
import type { Root } from '../../../shared/types.js';
import { PAGES_KIND, registryList, type RegistryRoot } from '../../../shared/root-kinds.js';
import { apiFetch, handle } from '../../lib/api-core.js';

/**
 * 0.1.96 brief scope. Whole-release covers every page root (no `roots`
 * frontmatter / slug segment). A scoped brief carries an explicit list of page
 * root ids (2.1.8: every `kind: pages` root is selectable).
 */
export type BriefScope =
  | { kind: 'whole-release' }
  | { kind: 'roots'; roots: string[] };

type Count = number | null | 'loading';

/**
 * 2.1.8 (M21 `6e16sj44` / `m21m17ax`) — the scope positions of the modal: every
 * root of kind `pages` in the root registry, the same set in mode (a) and (b).
 * Asked of the registry BY KIND — no per-root flag, no id literal; a system root
 * (`plans`, `briefs`, …) is never a scope target.
 */
export function briefScopeTargets(userRoots: readonly Root[]): RegistryRoot[] {
  return registryList(userRoots).filter((r) => r.kind === PAGES_KIND);
}

interface FieldsProps {
  /** `null` = initial brief (no predecessor). Only used to probe changed-page counts. */
  fromReleaseName: string | null;
  toReleaseName: string;
  /** `config.roots` — the user roots; the scope targets are the registry's `pages` roots ({@link briefScopeTargets}). */
  roots: Root[];
  /** Reports the current scope up on every mode/selection change. */
  onChange: (scope: BriefScope) => void;
  /** Mode shown first — default `whole-release` (mode a). */
  initialMode?: 'whole-release' | 'roots';
  /**
   * Override the per-root changed-page count probe. Defaults to a
   * `release_diff({ summaryOnly: true, roots: [id] })` REST call.
   */
  fetchChangedCount?: (rootId: string) => Promise<number | null>;
}

/**
 * 0.1.96 brief-scope picker fields (M21 modal-scope, L13). Two modes:
 *   - whole-release (default): the brief covers every page root.
 *   - selected roots: the author checks specific page roots; each shows its
 *     changed-page count for the `from → to` diff, and the entity changes —
 *     root-agnostic — show once, as one shared count.
 *
 * Presentational + probe logic only (no dialog chrome / confirm button) so it can
 * be embedded directly inside the "Generate brief" modal (CreateBriefDialog). The
 * standalone `BriefScopeModal` dialog that also wrapped these fields is gone
 * (2.1.20): it was never mounted, and its own scrim and panel were an undeclared
 * twin of the catalog's `Dialog` (M34 gate (a)). The chosen `BriefScope` flows through
 * to `createBrief({ roots })` — `kind: 'whole-release'` ⇒ omit `roots`,
 * `kind: 'roots'` ⇒ pass the array.
 */
export function BriefScopeFields({
  fromReleaseName,
  toReleaseName,
  roots,
  onChange,
  fetchChangedCount,
  initialMode = 'whole-release',
}: FieldsProps) {
  // 2.1.8: every root of kind `pages` is a scope target, with its own count.
  const targets = briefScopeTargets(roots);

  const [mode, setMode] = useState<'whole-release' | 'roots'>(initialMode);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [counts, setCounts] = useState<Record<string, Count>>({});
  // Entity changes are root-agnostic: every probe answers the same number, so it
  // is shown once. Only the default probe can report it.
  const [entityCount, setEntityCount] = useState<Count>(fetchChangedCount ? null : 'loading');

  useEffect(() => {
    let cancelled = false;
    // Reset per probe round: a stale count from the previous endpoints must not
    // show, and a round where no probe reports entities (every one failed, or
    // there are no roots) settles on "—" instead of spinning forever.
    let entitiesReported = false;
    if (!fetchChangedCount) setEntityCount('loading');
    const probe =
      fetchChangedCount ??
      ((rootId: string) =>
        probeChangedCount(fromReleaseName, toReleaseName, rootId, (n) => {
          entitiesReported = true;
          if (!cancelled) setEntityCount(n);
        }));
    setCounts(Object.fromEntries(targets.map((r) => [r.id, 'loading' as Count])));
    const rounds = targets.map((root) =>
      probe(root.id)
        .then((n) => {
          if (!cancelled) setCounts((prev) => ({ ...prev, [root.id]: n }));
        })
        .catch(() => {
          if (!cancelled) setCounts((prev) => ({ ...prev, [root.id]: null }));
        }),
    );
    if (!fetchChangedCount) {
      void Promise.allSettled(rounds).then(() => {
        if (!cancelled && !entitiesReported) setEntityCount(null);
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
            Cover every page root.
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
              No page roots configured.
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
          {!fetchChangedCount && (
            <div
              className="flex items-center justify-between gap-2 px-1 pt-1.5 text-[11px]"
              style={{ borderTop: '1px solid var(--c-hair)', color: 'var(--c-muted)' }}
              data-testid="brief-scope-entity-count"
            >
              <span>Entities (shared by every root)</span>
              <span className="font-mono">
                {entityCount === 'loading' ? '…' : entityCount == null ? '—' : `${entityCount} changed`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Default probe — `release_diff({ summaryOnly: true, include: ['pages', 'entities'], roots: [rootId] })`
 * via REST `view=operation` (2.1.11: the raw diff projection takes no filters).
 * `roots` narrows only the pages dimension, so `total.entities` is the same for
 * every root.
 * Returns the changed-page count for `rootId` between `from → to`, or `null` when
 * the diff cannot be computed. The entity changes (root-agnostic) are reported
 * through `onEntities` — the same number for every root.
 */
export async function probeChangedCount(
  fromReleaseName: string | null,
  toReleaseName: string,
  rootId: string,
  onEntities?: (n: number) => void,
): Promise<number | null> {
  const fromSeg = fromReleaseName === null ? 'initial' : encodeURIComponent(fromReleaseName);
  // `include` is a list parameter — the key repeated, one value each.
  const params = new URLSearchParams([
    ['view', 'operation'],
    ['summaryOnly', 'true'],
    ['include', 'pages'],
    ['include', 'entities'],
    ['roots', rootId],
  ]);
  try {
    const { data } = await handle<{ data: { total?: { pages?: number; entities?: number } } }>(
      await apiFetch(
        `/api/releases/${fromSeg}/diff/${encodeURIComponent(toReleaseName)}?${params.toString()}`,
      ),
    );
    if (typeof data.total?.entities === 'number') onEntities?.(data.total.entities);
    return data.total?.pages ?? 0;
  } catch {
    return null;
  }
}
