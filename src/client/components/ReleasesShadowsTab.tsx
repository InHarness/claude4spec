import { useState, type ReactNode } from 'react';
import { AlertTriangle, GitMerge } from 'lucide-react';
import type { ShadowDiffResponse } from '../../shared/entities.js';
import { useGitShadows } from '../hooks/useGitShadows.js';
import { useShadowDiff } from '../hooks/useReleases.js';
import { ApiError } from '../lib/api-core.js';
import { EmptyState } from '../host-ui-kit/list/EmptyState.js';
import { DeltaSection } from './release/DeltaSection.js';

/** The states of the Shadows tab (ui-view `releases-list` → `states`). */
const SHADOW_NONE_MESSAGE = 'No shadows to compare.';
const SHADOW_GONE_MESSAGE = 'This shadow no longer exists or has been accepted.';
const SHADOW_NO_CHANGES_MESSAGE = 'Accepting this shadow would change nothing in the specification.';
const SHADOW_CONFLICTS_HEADING = 'Conflicts with master — showing what the shadow changed';

const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * 2.1.46 (M17 `releases-list` → Shadows) — what accepting a shadow (someone
 * else's not-yet-accepted version of the specification) would change in the
 * master's specification. Read-only.
 *
 * - The picker „Compare shadow:” is fed by `GET /api/git/shadows` and preset
 *   from the screen's `ref` param (`requestedRef`).
 * - The header names the shadow, `base @ <sha> → shadow @ <sha>` and, with
 *   `masterAhead > 0`, „master +N commits since base”; next to it the flag
 *   banners (`outsideSpecFiles`, `touchesReleases`, `mergePreview: false`).
 * - `merge` mode renders the delta as Compare does (`DeltaSection`);
 *   `shadow-only` puts the conflicting files above it.
 * - The cards are in their shadow form (m17ui002): `added` has no link and
 *   reads `shadow only`, `modified` / `deleted` link to the master's version,
 *   a deleted entity renders the response's `before`.
 * - States: `shadow-none` (empty list), `shadow-gone` (`404 SHADOW_NOT_FOUND`
 *   for the chosen ref), `shadow-no-changes`, `shadow-error` (the delta's or
 *   the list's failure). They hold also when they arise under an open tab
 *   (`git:status-changed` invalidates both reads): an emptied list shows
 *   `shadow-none`, an accepted / deleted chosen shadow `shadow-gone`, a failed
 *   refetch `shadow-error` — never next to the previous, stale delta.
 */
export function ReleasesShadowsTab({ requestedRef, visit }: { requestedRef?: string; visit?: string }) {
  const { data: list, isLoading: listLoading, error: listError } = useGitShadows();
  const shadows = list?.shadows ?? [];

  // The user's own pick; every new visit (the header's Shadows section, even
  // with the same `ref`) replaces it.
  const [picked, setPicked] = useState<string | null>(null);
  const [seen, setSeen] = useState({ ref: requestedRef, visit });
  if (seen.ref !== requestedRef || seen.visit !== visit) {
    setSeen({ ref: requestedRef, visit });
    setPicked(null);
  }
  // ASSUMPTION:dev-4602 — without a `ref` the first listed shadow is preselected, as Compare presets the latest release.
  const activeRef = picked ?? requestedRef ?? shadows[0]?.id ?? null;

  const { data: diff, isLoading: diffLoading, error } = useShadowDiff(activeRef);

  // The tab's data changes under it: `git:status-changed` refetches the list
  // and the delta while the tab is open. A failed refetch keeps React Query's
  // previous `data` next to the new `error`; the tab never shows that stale
  // data — a failure of either read is the tab's state, alone.
  if (listError) {
    return (
      <Frame>
        <ShadowDiffFailure error={listError} />
      </Frame>
    );
  }

  if (!listLoading && activeRef === null) {
    return (
      <Frame>
        <EmptyState title={SHADOW_NONE_MESSAGE} />
      </Frame>
    );
  }

  // A shadow named by the URL but no longer listed stays selectable, so the
  // picker shows what the tab is about.
  const listed = shadows.map((s) => s.id);
  const options = activeRef && !listed.includes(activeRef) ? [activeRef, ...listed] : listed;

  return (
    <Frame>
      <div className="flex items-center gap-2 mb-4 text-[12.5px]" style={{ color: 'var(--c-muted)' }}>
        <GitMerge size={14} style={{ color: 'var(--c-accent)' }} />
        <span>Compare shadow:</span>
        <select
          value={activeRef ?? ''}
          onChange={(e) => setPicked(e.target.value || null)}
          className="rounded-md px-2 py-1 text-[12.5px] font-mono"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)', color: 'var(--c-ink)' }}
          data-shadow-picker
        >
          {options.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      {diffLoading && (
        <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
          Loading…
        </div>
      )}

      {error && <ShadowDiffFailure error={error} />}

      {!diffLoading && !error && diff && <ShadowDiffView diff={diff} />}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 920, padding: '24px 32px 48px' }}>
        {children}
      </div>
    </div>
  );
}

/** `shadow-gone` for a refused ref, `shadow-error` for anything else. */
function ShadowDiffFailure({ error }: { error: Error }) {
  if (error instanceof ApiError && error.code === 'SHADOW_NOT_FOUND') {
    return (
      <div data-shadow-state="gone">
        <EmptyState title={SHADOW_GONE_MESSAGE} />
      </div>
    );
  }
  return (
    <div
      className="rounded-md px-3 py-2 text-[12.5px]"
      style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626' }}
      role="alert"
      data-shadow-state="error"
    >
      The shadow comparison failed: {error.message}
    </div>
  );
}

function ShadowDiffView({ diff }: { diff: ShadowDiffResponse }) {
  const outside = diff.outsideSpecFiles.length;
  return (
    <div className="space-y-4">
      <div className="space-y-1" data-shadow-header>
        <div className="text-[14px] font-mono font-semibold" style={{ color: 'var(--c-ink)' }}>
          {diff.shadow.id}
        </div>
        <div className="flex flex-wrap items-baseline gap-3 text-[12px] font-mono" style={{ color: 'var(--c-muted)' }}>
          <span>
            base @ {shortSha(diff.base.sha)} → shadow @ {shortSha(diff.shadow.tipSha)}
          </span>
          {diff.masterAhead > 0 && (
            <span data-master-ahead>
              master +{diff.masterAhead} {diff.masterAhead === 1 ? 'commit' : 'commits'} since base
            </span>
          )}
        </div>
      </div>

      {outside > 0 && (
        <Banner testId="outside-spec" title={diff.outsideSpecFiles.join('\n')}>
          This shadow also changes {outside} {outside === 1 ? 'file' : 'files'} outside the specification.
        </Banner>
      )}
      {diff.touchesReleases && <Banner testId="touches-releases">This shadow changes release files.</Banner>}
      {!diff.mergePreview && <Banner testId="no-merge-preview">Merge preview requires git 2.38 or newer</Banner>}

      {diff.mode === 'shadow-only' && diff.conflicts.length > 0 && (
        <section
          className="rounded-md px-3 py-2"
          style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
          data-shadow-conflicts
        >
          <h3 className="text-[12.5px] font-semibold mb-1" style={{ color: 'var(--c-ink)' }}>
            {SHADOW_CONFLICTS_HEADING}
          </h3>
          <ul className="space-y-0.5 text-[12px] font-mono" style={{ color: 'var(--c-muted)' }}>
            {diff.conflicts.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </section>
      )}

      <div data-shadow-delta>
        <DeltaSection
          entityChanges={diff.entities}
          pageChanges={diff.pages}
          emptyMessage={SHADOW_NO_CHANGES_MESSAGE}
          shadow={{ before: diff.before }}
        />
      </div>
    </div>
  );
}

function Banner({ testId, title, children }: { testId: string; title?: string; children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-2 text-[12.5px]"
      style={{ background: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.35)', color: '#a87033' }}
      role="status"
      title={title}
      data-shadow-banner={testId}
    >
      <AlertTriangle size={13} aria-hidden />
      <span>{children}</span>
    </div>
  );
}
