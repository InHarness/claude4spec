import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, GitMerge, Loader2 } from 'lucide-react';
import type { CreateReleaseResponse, ShadowAcceptRequest, ShadowDiffResponse } from '../../shared/entities.js';
import type { GitErrorRecovery } from '../../shared/git.js';
import { useGitShadows } from '../hooks/useGitShadows.js';
import { useAcceptShadow, useShadowDiff } from '../hooks/useReleases.js';
import { ApiError } from '../lib/api-core.js';
import { shadowDiffKey } from '../lib/release-diff-invalidation.js';
import { openModal, showGitErrorModal, surfaceGitSync, toast } from '../ui/events.js';
import { EmptyState } from '../host-ui-kit/list/EmptyState.js';
import { DeltaSection } from './release/DeltaSection.js';

/** The states of the Shadows tab (ui-view `releases-list` → `states`). */
const SHADOW_NONE_MESSAGE = 'No shadows to compare.';
const SHADOW_GONE_MESSAGE = 'This shadow no longer exists or has been accepted.';
const SHADOW_NO_CHANGES_MESSAGE = 'Accepting this shadow would change nothing in the specification.';
const SHADOW_CONFLICTS_HEADING = 'Conflicts with master — showing what the shadow changed';
const SHADOW_ACCEPTING_MESSAGE = 'Accepting the shadow…';

/**
 * 2.1.47 (M17 L5 m17ui001 „Toasty przyjęcia”) — the refusals answered with a
 * `warning` toast carrying the reason: every `ACCEPT_*` code except
 * `ACCEPT_FAILED` (an `error`) and `ACCEPT_ABORT_FAILED` (the repair window),
 * `SHADOW_NOT_FOUND`, `GIT_UNAVAILABLE` and the validation of the release name
 * and description (the release-mutation taxonomy).
 */
const ACCEPT_WARNING_CODES: ReadonlySet<string> = new Set([
  'SHADOW_NOT_FOUND',
  'GIT_UNAVAILABLE',
  'VALIDATION',
  'RELEASE_NAME_CONFLICT',
  'RELEASE_SLUG_CONFLICT',
  'RELEASE_NAME_RESERVED',
  'RELEASE_DESCRIPTION_REQUIRED',
  'RELEASE_DESCRIPTION_TOO_LONG',
]);
const isAcceptWarning = (code: string) =>
  ACCEPT_WARNING_CODES.has(code) || (code.startsWith('ACCEPT_') && code !== 'ACCEPT_FAILED' && code !== 'ACCEPT_ABORT_FAILED');

function recoveryOf(error: ApiError): GitErrorRecovery | null {
  const recovery = error.details?.recovery;
  return recovery && typeof recovery === 'object' ? (recovery as GitErrorRecovery) : null;
}

/**
 * Why Accept is inactive, or `null` when it is active: it needs no
 * `conflicts`, no `outsideSpecFiles` and `touchesReleases: false`. A conflict
 * names its files.
 */
export function acceptBlockedReason(diff: ShadowDiffResponse): string | null {
  const reasons: string[] = [];
  if (diff.conflicts.length > 0) {
    reasons.push(`Conflicts with master in ${diff.conflicts.length} ${diff.conflicts.length === 1 ? 'file' : 'files'}:\n${diff.conflicts.join('\n')}`);
  }
  if (diff.outsideSpecFiles.length > 0) reasons.push('The shadow changes files outside the specification.');
  if (diff.touchesReleases) reasons.push('The shadow changes release files.');
  return reasons.length > 0 ? reasons.join('\n') : null;
}

const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * 2.1.46 (M17 `releases-list` → Shadows) — what accepting a shadow (someone
 * else's not-yet-accepted version of the specification) would change in the
 * master's specification.
 *
 * 2.1.47 — and its acceptance: the only action of the tab. Accept in the
 * header is active only without `conflicts`, without `outsideSpecFiles` and
 * with `touchesReleases: false` (otherwise inactive, the reason — and the
 * conflicting files — in its hint); it opens the `shadow-accept` window and
 * sends `POST /api/shadow-accept`. While the request runs the tab is
 * `shadow-accepting`: a spinner, the picker locked (the screen locks the tab
 * switcher).
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
export function ReleasesShadowsTab({
  requestedRef,
  visit,
  onAccepted,
}: {
  requestedRef?: string;
  visit?: string;
  /** 2.1.47: a successful acceptance moves the screen to the List tab. */
  onAccepted?: () => void;
}) {
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

  // 2.1.47 — the acceptance. A success: the toast „Shadow accepted as release
  // {name}” (or, with `gitSync.status === 'error'`, the repair window instead)
  // and the List tab. A refusal: a `warning` with the reason (`ACCEPT_STALE`
  // also refetches the preview), `ACCEPT_FAILED` an `error` noting that nothing
  // was changed, `ACCEPT_ABORT_FAILED` the repair window with its `recovery`.
  const qc = useQueryClient();
  const accept = useAcceptShadow({
    onSuccess: (release: CreateReleaseResponse) => {
      surfaceGitSync(release.gitSync);
      if (release.gitSync?.status !== 'error') toast.success(`Shadow accepted as release ${release.name}`);
      onAccepted?.();
    },
    onError: (err: Error, input: ShadowAcceptRequest) => {
      if (err instanceof ApiError) {
        const recovery = err.code === 'ACCEPT_ABORT_FAILED' ? recoveryOf(err) : null;
        if (recovery) {
          showGitErrorModal(recovery);
          return;
        }
        if (err.code === 'ACCEPT_FAILED') {
          toast.error(`${err.message} — Nothing was changed`);
          return;
        }
        if (isAcceptWarning(err.code)) {
          toast.warning(err.message);
          if (err.code === 'ACCEPT_STALE') void qc.invalidateQueries({ queryKey: shadowDiffKey(input.ref) });
          return;
        }
      }
      toast.error(err.message);
    },
  });
  const accepting = accept.isPending;

  /** Accept → the `shadow-accept` window over the CURRENT preview answer → the request. */
  async function onAccept(current: ShadowDiffResponse) {
    const fields = await openModal('shadow-accept', {
      shadowId: current.shadow.id,
      tipSha: current.shadow.tipSha,
      headSha: current.head.sha,
      commits: current.commits,
    });
    if (!fields) return;
    accept.mutate({
      ref: current.shadow.id,
      name: fields.name,
      description: fields.description,
      expectedTipSha: current.shadow.tipSha,
      expectedHeadSha: current.head.sha,
    });
  }

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
          disabled={accepting}
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

      {accepting && (
        <div
          className="flex items-center justify-center gap-2 text-[13px] py-10"
          style={{ color: 'var(--c-muted)' }}
          role="status"
          data-shadow-state="accepting"
        >
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {SHADOW_ACCEPTING_MESSAGE}
        </div>
      )}

      {!accepting && diffLoading && (
        <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
          Loading…
        </div>
      )}

      {!accepting && error && <ShadowDiffFailure error={error} />}

      {!accepting && !diffLoading && !error && diff && <ShadowDiffView diff={diff} onAccept={() => void onAccept(diff)} />}
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

function ShadowDiffView({ diff, onAccept }: { diff: ShadowDiffResponse; onAccept: () => void }) {
  const outside = diff.outsideSpecFiles.length;
  const blocked = acceptBlockedReason(diff);
  return (
    <div className="space-y-4">
      <div className="space-y-1" data-shadow-header>
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0 truncate text-[14px] font-mono font-semibold" style={{ color: 'var(--c-ink)' }}>
            {diff.shadow.id}
          </div>
          {/* The reason sits on the wrapper: a disabled button gets no hover in every browser. */}
          <span title={blocked ?? undefined} data-shadow-accept-reason={blocked ?? undefined}>
            <button
              type="button"
              onClick={onAccept}
              disabled={blocked !== null}
              className="rounded-md flex items-center gap-1.5 px-2.5 py-1 text-[12.5px]"
              style={{
                background: 'var(--c-accent)',
                color: '#fff',
                opacity: blocked !== null ? 0.5 : 1,
                cursor: blocked !== null ? 'not-allowed' : 'pointer',
              }}
              data-shadow-accept
            >
              <Check size={13} aria-hidden />
              Accept
            </button>
          </span>
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
