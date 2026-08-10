/**
 * 0.2.14 — the shared badge for the `applied` flag, which plan and patch now
 * both carry with identical semantics ("is this already applied to the
 * specification"). One component rather than two near-copies, so the two pages
 * cannot drift into saying the same thing differently.
 *
 * Brief keeps its own `ImplementedBadge` (BriefsList.tsx): `implemented` is a
 * claim about CODE, not about the spec, so it stays a separate vocabulary.
 */
export function AppliedBadge({ applied }: { applied: boolean }) {
  return applied ? (
    <span
      className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
      style={{ background: 'var(--c-green-soft)', color: 'var(--c-green)' }}
      title="Applied — the specification reflects this."
    >
      applied ✅
    </span>
  ) : (
    <span
      className="font-mono text-[10.5px] px-1.5 py-0.5 rounded inline-flex items-center"
      style={{ background: 'var(--c-yellow)', color: 'var(--c-yellow-ink)' }}
      title="Not applied yet."
    >
      pending ⏳
    </span>
  );
}
