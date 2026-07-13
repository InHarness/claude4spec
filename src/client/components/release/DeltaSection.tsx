import { useMemo } from 'react';
import type { RawDeltaEntityChange, RawDeltaPageChange, SpecSnapshot } from '../../../shared/entities.js';
import { clientPluginHost } from '../../core/plugin-host/host.js';
import { EntityDiffCard } from './EntityDiffCard.js';
import { PageDiffCard } from './PageDiffCard.js';

/**
 * Sections per entity type, in REGISTRY registration order (spec m17uidet01).
 * Pages stay first; the entity sections that follow are no longer a hardcoded
 * `Endpoints → DTOs → Database Tables → UI Views` list — they are derived from
 * `clientPluginHost` (core types in `displayOrder`, then a section per active
 * plugin, e.g. Database Tables from the preinstalled plugin). Labels come from
 * each module's `label` / `labelPlural`.
 */
export function registrySectionOrder(): Array<{
  type: string;
  label: string;
  singular: string;
  plural: string;
}> {
  return clientPluginHost.listAvailable().map((m) => ({
    type: m.type,
    label: m.labelPlural,
    singular: m.label,
    plural: m.labelPlural,
  }));
}

/**
 * Colorized render of a `RawDelta` — shared between the release-detail
 * "compare to" view and the `/releases` Compare tab (0.1.122). `emptyMessage`
 * lets each caller phrase the zero-changes state for its own direction
 * ("between these two releases" vs "since `<release>`").
 */
export function DeltaSection({
  entityChanges,
  pageChanges,
  fromSnapshot,
  emptyMessage = 'No changes between these two releases.',
}: {
  entityChanges: RawDeltaEntityChange[];
  pageChanges: RawDeltaPageChange[];
  fromSnapshot?: SpecSnapshot;
  emptyMessage?: string;
}) {
  const visiblePages = pageChanges.filter((c) => c.op !== 'noop');
  const entitiesByType = useMemo(() => groupByType(entityChanges), [entityChanges]);
  const sectionOrder = registrySectionOrder();

  const counter = useMemo(
    () => buildGlobalCounter(visiblePages.length, entitiesByType, sectionOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visiblePages.length, entitiesByType],
  );

  if (counter.total === 0) {
    return (
      <div
        className="text-center py-12 rounded-lg text-[12.5px]"
        style={{
          background: 'var(--c-card)',
          border: '1px dashed var(--c-hair-strong)',
          color: 'var(--c-subtle)',
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Globalny licznik zmian (m17uidet01) */}
      <div
        className="text-[13px]"
        style={{ color: 'var(--c-ink)' }}
      >
        <strong>{counter.total} {counter.total === 1 ? 'change' : 'changes'}:</strong>{' '}
        <span style={{ color: 'var(--c-muted)' }}>{counter.parts.join(', ')}</span>
      </div>

      {/* Pages first (m17uidet01 kolejność) */}
      {visiblePages.length > 0 && (
        <section>
          <SectionHeading label={`Pages (${visiblePages.length})`} />
          <div className="space-y-2">
            {visiblePages.map((c) => (
              <PageDiffCard key={c.path} change={c} />
            ))}
          </div>
        </section>
      )}

      {/* Entities in registry registration order (core types, then active plugins).
          Sections with 0 changes — HIDDEN. */}
      {sectionOrder.map(({ type, label }) => {
        const items = entitiesByType.get(type) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={type}>
            <SectionHeading label={`${label} (${items.length})`} />
            <div className="space-y-2">
              {items.map((c) => (
                <EntityDiffCard
                  key={`${c.type}-${c.slug}`}
                  change={c}
                  fromSnapshot={fromSnapshot ?? undefined}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Entity types not in the registry (e.g. a historical type) — fallback at the end. */}
      {Array.from(entitiesByType.keys())
        .filter((t) => !sectionOrder.some((s) => s.type === t))
        .map((type) => {
          const items = entitiesByType.get(type)!;
          if (items.length === 0) return null;
          return (
            <section key={type}>
              <SectionHeading label={`${type} (${items.length})`} />
              <div className="space-y-2">
                {items.map((c) => (
                  <EntityDiffCard
                    key={`${c.type}-${c.slug}`}
                    change={c}
                    fromSnapshot={fromSnapshot ?? undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}

function groupByType(changes: RawDeltaEntityChange[]): Map<string, RawDeltaEntityChange[]> {
  const out = new Map<string, RawDeltaEntityChange[]>();
  for (const c of changes) {
    if (c.op === 'noop') continue;
    const arr = out.get(c.type) ?? [];
    arr.push(c);
    out.set(c.type, arr);
  }
  return out;
}

function buildGlobalCounter(
  pagesCount: number,
  entitiesByType: Map<string, RawDeltaEntityChange[]>,
  sectionOrder: Array<{ type: string; singular: string; plural: string }>,
): { total: number; parts: string[] } {
  const parts: string[] = [];
  if (pagesCount > 0) parts.push(`${pagesCount} ${pagesCount === 1 ? 'page' : 'pages'}`);
  let total = pagesCount;
  for (const { type, singular, plural } of sectionOrder) {
    const n = entitiesByType.get(type)?.length ?? 0;
    if (n === 0) continue;
    total += n;
    parts.push(`${n} ${n === 1 ? singular : plural}`);
  }
  for (const [type, items] of entitiesByType) {
    if (sectionOrder.some((s) => s.type === type)) continue;
    if (items.length === 0) continue;
    total += items.length;
    parts.push(`${items.length} ${type}`);
  }
  return { total, parts };
}

function SectionHeading({ label }: { label: string }) {
  return (
    <h3
      className="text-[11px] uppercase tracking-wider font-mono font-semibold mb-2"
      style={{ color: 'var(--c-subtle)' }}
    >
      {label}
    </h3>
  );
}
