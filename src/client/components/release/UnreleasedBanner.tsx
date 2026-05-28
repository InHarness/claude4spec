import { useUnreleasedCount } from '../../hooks/useReleases.js';

/** "You have N unreleased changes" — self-hides when there is nothing unreleased. */
export function UnreleasedBanner() {
  const { data: count = 0 } = useUnreleasedCount();
  if (count <= 0) return null;
  return (
    <div
      className="mb-4 px-4 py-2.5 rounded-md text-[12.5px]"
      style={{
        background: 'var(--c-accent-soft)',
        border: '1px solid var(--c-accent)',
        color: 'var(--c-accent-ink)',
      }}
    >
      You have {count} unreleased {count === 1 ? 'change' : 'changes'} not in any release.
    </div>
  );
}
