import { useQuery } from '@tanstack/react-query';
import { metaApi, type PluginPackageRecord } from '../../lib/api.js';

/** The query of the base diagnostics — process-level, no project in the key. */
export const BASE_PLUGINS_QUERY_KEY = ['plugins-base-meta'] as const;

/**
 * M33 `jz4lgiy7` (2.1.58) — the Plugin pool card of the WORKSPACE settings page:
 * a read of the BASE, the workspace's plugin pool (axis B), from the
 * process-level diagnostics `GET /api/_meta/plugins` — independent of any
 * project. One row per base package with its state (`loaded` / `skipped` …)
 * and reason; an `incompatible` one points at `c4s plugins doctor`. The card is
 * not on a project page, so it shows no project overlay (the per-project
 * `/_meta/plugins` reports that). Nothing is edited here: the package list is
 * the workspace description's, packages are installed by the user.
 */
export function PluginPoolElement() {
  const { data, isLoading } = useQuery({ queryKey: BASE_PLUGINS_QUERY_KEY, queryFn: () => metaApi.basePlugins() });

  return (
    <>
      {isLoading || !data ? (
        <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading plugin diagnostics…
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {data.packages.map((p) => (
              <PackageRow key={p.package} record={p} />
            ))}
          </div>

          <p className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
            Host API {data.hostApiVersion}
          </p>
        </div>
      )}
    </>
  );
}

const STATUS_STYLE: Record<PluginPackageRecord['status'], { bg: string; fg: string }> = {
  loaded: { bg: 'var(--c-accent-soft)', fg: 'var(--c-accent)' },
  skipped: { bg: 'rgba(168, 112, 51, 0.18)', fg: '#a87033' },
  failed: { bg: 'rgba(196, 90, 59, 0.18)', fg: 'var(--c-red, #c45a3b)' },
  incompatible: { bg: 'rgba(168, 112, 51, 0.18)', fg: '#a87033' },
};

function PackageRow({ record }: { record: PluginPackageRecord }) {
  const status = STATUS_STYLE[record.status];
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
      data-testid="plugin-pool-package"
      data-package={record.package}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
          {record.package}
        </span>
        <Pill label={record.status} bg={status.bg} fg={status.fg} />
      </div>
      {record.contributedTypes && record.contributedTypes.length > 0 ? (
        <div className="mt-1 text-[11px] font-mono" style={{ color: 'var(--c-subtle)' }}>
          {record.contributedTypes.join(', ')}
        </div>
      ) : null}
      {record.reason ? (
        <div className="mt-1 text-[11px]" style={{ color: 'var(--c-muted)' }}>
          {record.reason}
        </div>
      ) : null}
      {record.migration ? (
        // 0.2.106: the badge only points at the fix — `c4s plugins doctor` is
        // the repair path and carries the step-by-step migration descriptors.
        <div className="mt-1 text-[11px]" style={{ color: '#a87033' }}>
          Requires migration to Host API {record.migration.targetHostApiVersion}
          {record.migration.shimAvailable ? ' (compat shim available)' : ''} — run{' '}
          <span className="font-mono">c4s plugins doctor</span>
        </div>
      ) : null}
    </div>
  );
}

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      className="shrink-0 text-[10px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}
