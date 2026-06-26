/**
 * `EntityListRow` now lives in the Host UI Kit (M34/L12) so host pages and
 * runtime plugins render the exact same row; this shim re-exports it to keep
 * existing app imports working.
 *
 * `CountBadge` stays app-side: the kit already covers list counts via the
 * `stable` `EntityListHeader.count`, so there is no need to promote this small
 * helper to the plugin-facing catalog.
 */
export * from '../../host-ui-kit/list/EntityListRow.js';

export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
      style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
    >
      {children}
    </span>
  );
}
