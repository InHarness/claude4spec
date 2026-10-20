/**
 * 2.1.41 (M13) — the two registration WARNINGS a `ref` flag can earn.
 *
 * Both are "warning only", the first such entries beside the hard rejections of
 * load-time validation (no `data.schema`, no collection kind, depth limit,
 * integrity outside the dictionary, `kind: 'sql-identifier'`). The type
 * registers either way:
 *
 *   - a `ref` in a forbidden place (`collectRefFields` → `misplaced`) — the
 *     field is not a reference for anybody: no write validation, no rename
 *     propagation, no `refLookup` entry;
 *   - a `ref` naming a type no registered package contributes. Activation is per
 *     project, so at registration the host cannot know whether the type will be
 *     there; the value is kept on write and renders as broken (`unknown`).
 *
 * Computed over the WHOLE pool rather than inside `attachComposition`, because
 * "no package contributes it" is only decidable once every package of the layer
 * has registered — a plugin may load before the built-in envelope it points at.
 * The same lines go to the server log (once per bootstrap) and to
 * `/_meta/plugins` → `c4s plugins doctor`.
 */

import { collectRefFields, REF_PLACEMENT_REASONS } from '../../../shared/plugin-host/ref-fields.js';
import type { BackendModule } from './types.js';
import type { PluginLoadRecord } from './loader.js';

export interface RefRegistrationWarning {
  /** The type whose `data.schema` carries the flag. */
  type: string;
  message: string;
}

type SchemaCarrier = Pick<BackendModule, 'type' | 'data'>;

/**
 * Every placement and unknown-target warning of `modules`. `knownTypes`
 * defaults to the types of `modules` themselves — pass the whole pool when only
 * part of it is being reported on.
 */
export function refRegistrationWarnings(
  modules: Iterable<SchemaCarrier>,
  knownTypes?: ReadonlySet<string>,
): RefRegistrationWarning[] {
  const list = [...modules];
  const known = knownTypes ?? new Set(list.map((m) => m.type));
  const out: RefRegistrationWarning[] = [];
  for (const module of list) {
    const walk = collectRefFields(module.data?.schema);
    for (const site of walk.misplaced) {
      out.push({
        type: module.type,
        message:
          `${module.type}: data.schema field "${site.path}" declares ref: '${site.target}' in ` +
          `${REF_PLACEMENT_REASONS[site.issue]} — the type registers, but this field is not ` +
          `treated as a reference (no ref validation, rename propagation or refLookup entry)`,
      });
    }
    for (const site of walk.refs) {
      if (known.has(site.target)) continue;
      out.push({
        type: module.type,
        message:
          `${module.type}: data.schema field "${site.path}" declares ref: '${site.target}', ` +
          `which no registered package contributes — the type registers; values are kept on ` +
          `write and render as broken (unknown type)`,
      });
    }
  }
  return out;
}

/**
 * The overlay layer's warnings: only the overlay's own types are reported (the
 * base pool's were reported at bootstrap), judged against base ∪ overlay.
 */
export function overlayRefWarnings(
  pool: readonly SchemaCarrier[],
  overlayRecords: readonly PluginLoadRecord[],
): RefRegistrationWarning[] {
  if (!overlayRecords.length) return [];
  const overlayTypes = new Set(overlayRecords.flatMap((r) => r.contributedTypes ?? []));
  return refRegistrationWarnings(
    pool.filter((m) => overlayTypes.has(m.type)),
    new Set(pool.map((m) => m.type)),
  );
}

/** Attach each record's warnings, by the types it contributed. Records with none are returned as is. */
export function withRefWarnings(
  records: PluginLoadRecord[],
  warnings: readonly RefRegistrationWarning[],
): PluginLoadRecord[] {
  if (!warnings.length) return records;
  return records.map((r) => {
    const own = warnings.filter((w) => r.contributedTypes?.includes(w.type)).map((w) => w.message);
    return own.length ? { ...r, warnings: [...(r.warnings ?? []), ...own] } : r;
  });
}

/** Server-log channel — one line per warning, prefixed like the loader's own lines. */
export function logRefRegistrationWarnings(warnings: readonly RefRegistrationWarning[]): void {
  for (const w of warnings) console.warn(`[plugin-host] REF_WARNING ${w.message}`);
}
