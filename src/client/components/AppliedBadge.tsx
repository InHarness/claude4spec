import { TitledBadge } from './TitledBadge.js';

/**
 * 0.2.14 — the shared badge for the `applied` flag, which plan and patch now
 * both carry with identical semantics ("is this already applied to the
 * specification"). One component rather than two near-copies, so the two pages
 * cannot drift into saying the same thing differently.
 *
 * 2.1.40: a value marker, so the catalog `Badge` — the state's colour is the
 * ink (`foreground`), never a fill.
 *
 * Brief keeps its own `ImplementedBadge` (BriefsList.tsx): `implemented` is a
 * claim about CODE, not about the spec, so it stays a separate vocabulary.
 */
export function AppliedBadge({ applied, small }: { applied: boolean; small?: boolean }) {
  return applied ? (
    <TitledBadge
      label="applied ✅"
      mono
      small={small}
      foreground="var(--c-green)"
      title="Applied — the specification reflects this."
    />
  ) : (
    <TitledBadge
      label="pending ⏳"
      mono
      small={small}
      foreground="var(--c-yellow-ink)"
      title="Not applied yet."
    />
  );
}
