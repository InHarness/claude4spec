import { useNavigate } from '@tanstack/react-router';
import { staleRows, useIndexStatus } from '../hooks/useIndexStatus.js';

/**
 * 0.2.77 — the PERSISTENT staleness indicator, in the sidebar header's
 * conventional status slot beside the git badge.
 *
 * Deliberately NOT dismissible. A toast says "this just happened" and is right to
 * disappear; this says "this is still true", and a control that let the user
 * clear it would let them hide a condition under which their writes are being
 * refused. It goes away when the projection goes fresh, and by no other means.
 *
 * Returns `null` when nothing is stale — reserving no height, as `GitStatusBadge`
 * does, so the sidebar does not carry a permanent empty strip.
 */
export function IndexStatusBadge() {
  const navigate = useNavigate();
  const { data } = useIndexStatus();
  const stale = staleRows(data?.projections);
  if (stale.length === 0) return null;

  const label = stale.length === 1 ? stale[0]!.label : `${stale.length} projections`;
  return (
    <button
      type="button"
      data-testid="index-status-badge"
      onClick={() => navigate({ to: '/settings', hash: 'index-status' })}
      title={`Stale: ${stale.map((r) => r.label).join(', ')}. Click to open Index status.`}
      className="flex items-center gap-1.5 px-3.5 py-1 text-[11.5px] w-full text-left"
      style={{ color: 'var(--c-red, #c45a3b)' }}
    >
      <span aria-hidden>▲</span>
      <span className="truncate">Index out of date — {label}</span>
    </button>
  );
}
