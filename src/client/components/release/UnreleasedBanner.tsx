import { Link } from '@tanstack/react-router';
import { useUnreleasedCount } from '../../hooks/useReleases.js';

/**
 * "You have N unreleased changes" — self-hides when there is nothing
 * unreleased. The trailing "View changes" link goes to the `/releases`
 * Compare tab (0.1.122), presetting `latest → current` (the tab's own
 * default). A plain `<div>` (not itself a link — see the code-review
 * follow-up), since nesting an `<a>` inside another `<a>` isn't valid HTML;
 * the explicit link makes the navigation affordance visible.
 */
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
      You have {count} unreleased {count === 1 ? 'change' : 'changes'} not in any release.{' '}
      <Link to="/releases" search={{ tab: 'compare' }} className="underline font-medium">
        View changes
      </Link>
    </div>
  );
}
