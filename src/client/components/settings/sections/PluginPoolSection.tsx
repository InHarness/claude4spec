import { useQuery } from '@tanstack/react-query';
import { metaApi, type PluginPackageRecord } from '../../../lib/api.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M26 §6 — Entities section, axis B (pool composition). READ-ONLY in v1: the
 * composition of the effective entity pool (`base ∪ overlay`) is diagnostics
 * only — editing the pool from the UI is Phase 3. Surfaces, per package: load
 * status, layer (base/overlay), trust state, contributed types, and any
 * cross-layer `shadowed` types with both origins.
 *
 * Workspace/npm `plugins[]` changes need a process restart (v1); a committed
 * project-local plugin becomes available after a ProjectContext rebuild behind
 * the `trustProjectPlugins` gate. Neither is editable here.
 */
export function PluginPoolSection() {
  const { data, isLoading } = useQuery({ queryKey: ['plugins-meta'], queryFn: () => metaApi.plugins() });

  return (
    <SettingsCard
      id="plugin-pool"
      title="Plugin pool"
      description="What entity types and plugins are available to this project (base ∪ overlay). Read-only — composition isn't edited from the UI in this version."
    >
      {isLoading || !data ? (
        <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
          Loading plugin diagnostics…
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {data.packages.map((p) => (
              <PackageRow key={`${p.layer ?? 'base'}:${p.package}`} record={p} />
            ))}
          </div>

          {data.shadowed.length > 0 ? (
            <div
              className="rounded-md px-3 py-2 text-[11.5px]"
              style={{ background: 'rgba(168, 112, 51, 0.12)', border: '1px solid var(--c-hair)' }}
            >
              <div className="font-medium mb-1" style={{ color: '#a87033' }}>
                Shadowed types (project-local overrides base)
              </div>
              {data.shadowed.map((s) => (
                <div key={s.type} className="font-mono" style={{ color: 'var(--c-muted)' }}>
                  {s.type}: {s.overlayOrigin} ▸ shadows {s.baseOrigin}
                </div>
              ))}
            </div>
          ) : null}

          <p className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
            Host API {data.hostApiVersion}
            {data.localPluginsPresent
              ? data.trust === true
                ? ' · project plugins trusted'
                : data.trust === false
                  ? ' · project plugins not trusted'
                  : ' · project plugins awaiting trust decision'
              : ''}
          </p>
        </div>
      )}
    </SettingsCard>
  );
}

const STATUS_STYLE: Record<PluginPackageRecord['status'], { bg: string; fg: string }> = {
  loaded: { bg: 'var(--c-accent-soft)', fg: 'var(--c-accent)' },
  skipped: { bg: 'rgba(168, 112, 51, 0.18)', fg: '#a87033' },
  failed: { bg: 'rgba(196, 90, 59, 0.18)', fg: 'var(--c-red, #c45a3b)' },
};

function PackageRow({ record }: { record: PluginPackageRecord }) {
  const layer = record.layer ?? 'base';
  const status = STATUS_STYLE[record.status];
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
          {record.package}
        </span>
        <Pill label={layer} bg="var(--c-hair)" fg="var(--c-muted)" />
        {layer === 'overlay' && record.trust ? (
          <Pill
            label={record.trust}
            bg={record.trust === 'trusted' ? 'var(--c-accent-soft)' : 'rgba(168, 112, 51, 0.18)'}
            fg={record.trust === 'trusted' ? 'var(--c-accent)' : '#a87033'}
          />
        ) : null}
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
