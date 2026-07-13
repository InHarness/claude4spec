import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfig, usePatchConfig } from '../../../hooks/useConfig.js';
import { clientPluginHost } from '../../../core/plugin-host/host.js';
import { ApiError, metaApi } from '../../../lib/api.js';
import { toast } from '../../../ui/events.js';
import { SettingsCard } from '../SettingsCard.js';
import { SettingsCheckboxRow } from '../SettingsCheckboxRow.js';

/**
 * M26 §6 — Entities section, axis A (activation per project). Multi-select of the
 * effective entity pool `base ∪ overlay` (M33 phase 2), sourced from
 * GET /api/_meta/entities so project-local overlay types appear here even before
 * a client frontend module exists for them. `entities === undefined` in config
 * means "all active" — any explicit choice persists an explicit array (possibly
 * empty: zero plugins / markdown-only project). PATCH rebuilds the context with
 * no restart and no banner; this axis edits activation only, never the pool.
 */
export function EntitiesSection() {
  const { data: config } = useConfig();
  const patch = usePatchConfig();
  const qc = useQueryClient();
  // Activation partition from the server is the authoritative effective pool:
  // active ∪ inactive = every registered type (base + trusted overlay); unknown
  // = slugs in config.json with no registered plugin (surfaced read-only).
  const { data: activation } = useQuery({ queryKey: ['meta-entities'], queryFn: () => metaApi.entities() });
  const poolTypes = useMemo(() => {
    if (!activation) return [];
    const all = [...activation.active, ...activation.inactive];
    // Stable display order: client-known displayOrder first, then by type.
    return all.sort((a, b) => {
      const oa = clientPluginHost.getAvailable(a)?.displayOrder ?? 9999;
      const ob = clientPluginHost.getAvailable(b)?.displayOrder ?? 9999;
      return oa - ob || a.localeCompare(b);
    });
  }, [activation]);
  const poolKey = poolTypes.join('|');

  const [draft, setDraft] = useState<Set<string>>(() => initialSelection(config, poolTypes));

  useEffect(() => {
    setDraft(initialSelection(config, poolKey ? poolKey.split('|') : []));
  }, [config, poolKey]);

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
    const baseline = initialSelection(config, poolTypes);
    if (baseline.size !== draft.size) return true;
    for (const k of baseline) if (!draft.has(k)) return true;
    return false;
  }

  async function handleSave() {
    if (!isDirty()) return;
    try {
      await patch.mutateAsync({ entities: Array.from(draft) });
      // M31: the server rebuilds the project context on the next request — no
      // restart. Re-fetch the activation partition and re-apply it live; if the
      // live re-apply leaves stale UI, a full reload is the safe fallback.
      try {
        const next = await metaApi.entities();
        clientPluginHost.applyActivation(next);
        qc.invalidateQueries();
      } catch {
        window.location.reload();
        return;
      }
      toast.success('Active entities saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  function labelFor(type: string): string {
    const m = clientPluginHost.getAvailable(type);
    return m?.labelPlural ?? m?.label ?? type;
  }

  return (
    <SettingsCard
      id="entities"
      title="Entities"
      description="Which entity types are active in this project. Disabling a type hides it from the sidebar immediately. This edits activation only — see Plugin pool below for what's available."
    >
      <div className="flex flex-col gap-2">
        {poolTypes.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--c-subtle)' }}>
            No entity types are available in this project.
          </p>
        ) : (
          poolTypes.map((type) => {
            const checked = draft.has(type);
            const isOverlayOnly = clientPluginHost.getAvailable(type) == null;
            return (
              <SettingsCheckboxRow
                key={type}
                checked={checked}
                onChange={() => toggle(type)}
                trailing={
                  isOverlayOnly ? (
                    <span
                      className="text-[10px] font-mono uppercase tracking-wide rounded px-1.5 py-0.5"
                      style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}
                      title="Contributed by a project-local plugin (no bundled frontend module)."
                    >
                      overlay
                    </span>
                  ) : null
                }
              >
                <span className="block text-[13px] font-medium" style={{ color: 'var(--c-ink)' }}>
                  {labelFor(type)}
                </span>
                <span className="block text-[11px] font-mono" style={{ color: 'var(--c-subtle)' }}>
                  {type}
                </span>
              </SettingsCheckboxRow>
            );
          })
        )}

        {/* M33 phase 3: unknown-slug rendering removed (ac-patch-api-config-entities-z-2
            withdrawn). M01 still logs "unknown entity in config" and GET
            /api/_meta/entities still reports `unknown` — only this UI render is gone. */}

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
  poolTypes: string[],
): Set<string> {
  if (config?.entities === undefined) {
    // undefined === all active (backward compat with $schemaVersion: 1 projects).
    return new Set(poolTypes);
  }
  return new Set(config.entities);
}
