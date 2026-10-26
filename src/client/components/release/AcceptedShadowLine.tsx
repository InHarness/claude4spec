import type { AcceptedShadow } from '../../../shared/entities.js';

/**
 * 2.1.47 / 2.1.49 (M17 `releases-list`, `release-detail`) — the one line naming
 * the shadow a release accepted: "Accepted shadow {id} @ {sha7}", `sha7` being
 * the first seven characters of `tipSha`. The release list card and the release
 * detail header render it in the same format; a release that did not accept a
 * shadow (`null` / absent) has no line.
 */
export function AcceptedShadowLine({ acceptedShadow, className }: { acceptedShadow: AcceptedShadow | null | undefined; className: string }) {
  if (!acceptedShadow) return null;
  return (
    <div className={`text-[11.5px] font-mono ${className}`} style={{ color: 'var(--c-subtle)' }} data-accepted-shadow>
      Accepted shadow {acceptedShadow.id} @ {acceptedShadow.tipSha.slice(0, 7)}
    </div>
  );
}
