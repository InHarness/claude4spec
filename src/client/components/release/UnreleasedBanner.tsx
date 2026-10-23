import { useUnreleasedCount } from '../../hooks/useReleases.js';

/**
 * 2.1.45 (M25 L2 49dzhz9l, L5 cqhywf9z) — the M25 unreleased-changes banner,
 * one component for both places it stands: over the `/releases` list (when at
 * least one release exists) and on the card of the newest release (the host,
 * `ReleaseDetail`, renders it only there — older releases are frozen and get
 * no banner). It shows only while N > 0; N is the shared unreleased counter
 * (`useUnreleasedCount`, M17 zbc9jdnr), never a source of its own. Without any
 * release the counter does not exist (no query), so the banner stays hidden. After a
 * successful "Pull in unreleased changes" the `release:updated` WS event
 * refetches the counter (`release-diff-invalidation.ts`) and the banner goes.
 *
 * No link to the Compare tab — the `/releases` Compare deep link is removed.
 */
export function UnreleasedBanner() {
  const { data: count = 0 } = useUnreleasedCount();
  if (count <= 0) return null;
  return (
    <div
      data-testid="unreleased-banner"
      className="mb-4 px-4 py-2.5 rounded-md text-[12.5px]"
      style={{
        background: 'var(--c-accent-soft)',
        border: '1px solid var(--c-accent)',
        color: 'var(--c-accent-ink)',
      }}
    >
      You have {count} unreleased {count === 1 ? 'change' : 'changes'} — they will NOT be included in this push. Pull
      them into this release or create a new one.
    </div>
  );
}
