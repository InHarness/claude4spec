/**
 * `EntityListRow` now lives in the Host UI Kit (M34/L12) so host pages and
 * runtime plugins render the exact same row; this shim re-exports it to keep
 * existing app imports working.
 *
 * DEBT (2.1.19, Host UI Kit slice of `ui-view`): `CountBadge` fails locality
 * condition 2 — a row counter is common to every entity type. Its catalog
 * replacement is `Badge`. Recorded, not fixed here. ASSUMPTION:dev-1905 — the
 * ui-view list no longer uses it (kit `Badge` since 2.1.16); only the
 * design-system list row does.
 *
 * `CountBadge` stays app-side: the kit already covers list counts via the
 * `stable` `EntityListHeader.count`, so there is no need to promote this small
 * helper to the plugin-facing catalog.
 */
export * from '@c4s/plugin-runtime/ui';

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
