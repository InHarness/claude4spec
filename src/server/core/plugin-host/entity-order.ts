/**
 * 0.2.2 — declared entity ordering (brief item 9).
 *
 * Restore (`ReleaseService.restoreSpec`) and index rebuild
 * (`EntityIndexerService.indexAll`) both need "dependencies before dependents".
 * Until now each carried its OWN hardcoded array, and the two had silently
 * drifted apart: the restore list named four types and omitted `ac`,
 * `design-system` and `diagram` entirely, while the indexer's named all seven in
 * a different order. Two hand-maintained lists of type literals is precisely the
 * host knowledge 0.2.2 removes.
 *
 * The order is now DERIVED from `module.dependsOn`, declared by the module that
 * actually knows the constraint (`endpoint` → `['dto']`, `ui-view` →
 * `['design-system']`). "DTO before Endpoint" is the RESULT of that declaration,
 * not its source — which is what lets a plugin-contributed type express an
 * ordering constraint the host has never heard of.
 */

import type { EntityModuleManifest } from '../../../shared/plugin-host/types.js';

type OrderableModule = Pick<EntityModuleManifest, 'type' | 'displayOrder' | 'dependsOn'>;

/**
 * Topologically sort modules so every module follows the ones it `dependsOn`.
 *
 * - Ties break on `displayOrder`, then `type`, so the result is STABLE: an
 *   unchanged set of modules always yields the same order, which matters because
 *   restore order is observable in `entity_version`.
 * - Dependencies on types absent from `modules` (unknown, or deactivated in this
 *   project) are ignored. `dependsOn` is a soft ordering hint, not referential
 *   integrity — deactivating `design-system` must not strand `ui-view`.
 * - A dependency CYCLE is reported through `onCycle` and the remaining modules
 *   are appended in tiebreak order rather than dropped. A misdeclared plugin must
 *   degrade to "possibly wrong order", never to "these entities vanish".
 */
export function topoSortModules<T extends OrderableModule>(
  modules: T[],
  onCycle?: (remaining: string[]) => void,
): T[] {
  const byType = new Map(modules.map((m) => [m.type, m]));
  const tiebreak = (a: T, b: T) =>
    a.displayOrder - b.displayOrder || a.type.localeCompare(b.type);

  const pending = [...modules].sort(tiebreak);
  const emitted = new Set<string>();
  const out: T[] = [];

  while (pending.length > 0) {
    // Emit every module whose (known, active) dependencies are already out.
    const ready = pending.filter((m) =>
      (m.dependsOn ?? []).every((dep) => !byType.has(dep) || emitted.has(dep)),
    );
    if (ready.length === 0) {
      onCycle?.(pending.map((m) => m.type));
      out.push(...pending);
      break;
    }
    for (const m of ready) {
      out.push(m);
      emitted.add(m.type);
    }
    for (const m of ready) pending.splice(pending.indexOf(m), 1);
  }
  return out;
}

/** Convenience: just the type strings, in dependency order. */
export function topoSortTypes(modules: OrderableModule[]): string[] {
  return topoSortModules(modules, (remaining) =>
    console.warn(
      `[entity-order] dependsOn cycle among [${remaining.join(', ')}] — ` +
        `falling back to displayOrder for those types`,
    ),
  ).map((m) => m.type);
}
