import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { clientPluginHost } from '../../../core/plugin-host/host.js';
import { ApiError, metaApi } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';

/**
 * M26 §6 — Entities section. Multi-select of registered entity plugins
 * (M13). `entities === undefined` in the config means "all active" — when the
 * user makes any explicit choice, we persist an explicit array (potentially
 * empty: zero plugins / markdown-only project).
 */
export function EntitiesSection() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  // The plugin host is populated at module load (via side-effect imports in
  // `core/plugin-host/registerAll`). `listAvailable()` returns a fresh array
  // each call, so we memoize once per mount to keep effect deps stable.
  const available = useMemo(() => clientPluginHost.listAvailable(), []);
  const availableTypes = useMemo(() => available.map((m) => m.type).join('|'), [available]);
  const [draft, setDraft] = useState<Set<string>>(() => initialSelection(config, available.map((m) => m.type)));
  // M26 §2 — slugs persisted in `config.json` that match no registered plugin are
  // reported by GET /api/_meta/entities under `unknown`. Surface them read-only so the
  // user can see (but not toggle) an unrecognised entity type after refetch.
  const { data: activation } = useQuery({ queryKey: ['meta-entities'], queryFn: () => metaApi.entities() });
  const unknownTypes = activation?.unknown ?? [];

  useEffect(() => {
    setDraft(initialSelection(config, availableTypes ? availableTypes.split('|') : []));
  }, [config, availableTypes]);

  function toggle(type: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function isDirty(): boolean {
    if (!config) return false;
    const baseline = initialSelection(config, available.map((m) => m.type));
    if (baseline.size !== draft.size) return true;
    for (const k of baseline) if (!draft.has(k)) return true;
    return false;
  }

  async function handleSave() {
    if (!isDirty()) return;
    try {
      await patch.mutateAsync({ entities: Array.from(draft) });
      toast.success('Active entities saved — restart to apply');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  return (
    <SettingsCard
      id="entities"
      title="Entities"
      description="Which entity plugins are active. Disabling a type hides it from the sidebar after a restart."
      badge="restart-required"
    >
      <div className="flex flex-col gap-2">
        {available.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
            No entity plugins are registered in this build.
          </p>
        ) : (
          available.map((m) => {
            const checked = draft.has(m.type);
            return (
              <label
                key={m.type}
                className="flex items-center gap-3 rounded-md px-3 py-2"
                style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)' }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(m.type)}
                  className="h-4 w-4"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
                    {m.labelPlural ?? m.label ?? m.type}
                  </span>
                  <span className="block text-[11px] font-mono" style={{ color: 'var(--c-subtle)' }}>
                    {m.type}
                  </span>
                </span>
              </label>
            );
          })
        )}

        {unknownTypes.map((type) => (
          <label
            key={type}
            className="flex items-center gap-3 rounded-md px-3 py-2 opacity-60"
            style={{ background: 'var(--c-bg)', border: '1px solid var(--c-hair)', cursor: 'not-allowed' }}
            title="Unknown entity type — present in config.json but no plugin is registered for it."
          >
            <input type="checkbox" checked disabled className="h-4 w-4" />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
                {type}
              </span>
              <span className="block text-[11px] font-mono" style={{ color: 'var(--c-subtle)' }}>
                {type}
              </span>
            </span>
            <span
              className="text-[10px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5"
              style={{ background: 'var(--c-hair)', color: 'var(--c-muted)' }}
            >
              unknown
            </span>
          </label>
        ))}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!isDirty() || patch.isPending}
            onClick={handleSave}
            className="rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--c-accent)', color: '#fff' }}
          >
            Save
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}

function initialSelection(
  config: ReturnType<typeof useConfig>['data'],
  availableTypes: string[],
): Set<string> {
  if (config?.entities === undefined) {
    // undefined === all active (backward compat with $schemaVersion: 1 projects).
    return new Set(availableTypes);
  }
  return new Set(config.entities);
}
