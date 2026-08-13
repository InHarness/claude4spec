/**
 * The enforced payload-migration chain (brief item 12).
 *
 * What it replaces: `EntitySerializer.version`, a semver string the registry
 * never read. It was a "social contract" — a number an author bumped to signal
 * a shape change, with nothing anywhere that acted on it, so a file written
 * under the old shape and read under the new one simply came out wrong.
 *
 * The mechanism now is boring and therefore trustworthy. Every entity file
 * carries the `payloadVersion` it was written under. When that is lower than
 * the type's current version, the payload goes through `payloadUpgrades`
 * composed in order (`payloadUpgrades[i]` takes payload `i+1` to `i+2`), and the
 * file is rewritten ONCE. Registration already refuses a chain whose length
 * disagrees with the declared version (`manifest-adapter.ts`), so a gap here is
 * a legacy file, never a mis-declared type.
 *
 * THREE PROPERTIES THIS FILE EXISTS TO HOLD, each of which is a bug if lost:
 *
 *   1. An upgrade is NOT a domain mutation. It must not stamp `updatedAt` and
 *      must not write an `entity_version` row — otherwise bumping one type's
 *      version rewrites the audit history of every entity of that type, and a
 *      release diff spanning the bump reports thousands of edits nobody made.
 *      This module is what makes that structural rather than careful: it is a
 *      pure transform on data, run BEFORE the write path, so it has no way to
 *      stamp or capture anything. The flags that suppress both already exist on
 *      the paths that call it.
 *
 *   2. The rewrite happens once per file, not once per read. Guaranteed by the
 *      marker itself: after the rewrite the file's version equals the type's, so
 *      the next read short-circuits. No bookkeeping table, nothing to get out of
 *      sync.
 *
 *   3. A payload the chain cannot honestly produce is SKIPPED, loudly, not
 *      guessed at. See {@link classifyGap}.
 */

import type { FieldNode } from '../../shared/plugin-host/data-schema.js';
import { evaluateComputedDefault } from '../../shared/plugin-host/slug-pattern.js';
import type { SnapshotData } from './types.js';
import { stripSystemFields } from './system-fields.js';

/**
 * The envelope key carrying the shape version of an entity file.
 *
 * A top-level slot beside `createdAt`/`updatedAt`, per the specification. NOT
 * inside a captured snapshot: `entity_version` already has a `serializer_version`
 * COLUMN for the same fact, and a second copy inside `data` would (a) be free to
 * disagree with the column, and (b) show up in `defaultDeepDiff`, turning every
 * release diff that spans a bump into a spurious `modified` on every entity.
 */
export const PAYLOAD_VERSION_KEY = 'payloadVersion';

/**
 * The version a payload was written under.
 *
 * An absent marker is version 1, and that is exactly true rather than a
 * convention: the marker is introduced in this release, every type shipped at
 * version 1 before it, so "no marker" and "written at 1" are the same corpus.
 * A non-integer or non-positive marker is treated as absent — a corrupt marker
 * should degrade to "try the whole chain", which either succeeds or fails
 * loudly, rather than skipping migrations on the strength of a bad number.
 */
export function readPayloadVersion(data: unknown): number {
  if (data === null || typeof data !== 'object') return 1;
  const raw = (data as Record<string, unknown>)[PAYLOAD_VERSION_KEY];
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 1;
}

/** Stamp a payload with the version it is being written under. */
export function attachPayloadVersion(data: SnapshotData, version: number | undefined): SnapshotData {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  if (typeof version !== 'number') return data;
  return { ...(data as Record<string, unknown>), [PAYLOAD_VERSION_KEY]: version };
}

/** Remove the marker before the payload reaches anything that reads declared fields. */
export function stripPayloadVersion(data: SnapshotData): SnapshotData {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!(PAYLOAD_VERSION_KEY in (data as Record<string, unknown>))) return data;
  const { [PAYLOAD_VERSION_KEY]: _drop, ...rest } = data as Record<string, unknown>;
  return rest;
}

/** A payload that cannot be brought to the current shape. The entity is skipped, not guessed. */
export class PayloadUpgradeError extends Error {
  constructor(
    readonly type: string,
    readonly from: number,
    readonly to: number,
    reason: string,
  ) {
    super(`${type}: payload v${from} → v${to} cannot be upgraded — ${reason}`);
    this.name = 'PayloadUpgradeError';
  }
}

/** The manifest surface the chain needs. Structural, so a fixture is one object literal. */
export interface UpgradableModule {
  type: string;
  payloadVersion?: number;
  data?: { schema: Readonly<Record<string, FieldNode>> };
  serializer?: { payloadUpgrades?: Array<(payload: SnapshotData) => SnapshotData> };
}

export interface UpgradeResult {
  data: SnapshotData;
  /** True when the payload actually moved, i.e. the file is now stale and worth rewriting. */
  upgraded: boolean;
  warnings: string[];
}

/**
 * Is the remaining distance an UNAMBIGUOUS gap or a CONTRADICTORY one?
 *
 * The distinction the brief draws, made concrete. After the chain has run
 * whatever steps it has, some declared field may still be missing:
 *
 *   - UNAMBIGUOUS — the declaration itself says what the value should be
 *     (`default` or `computedDefault`). There is exactly one answer, so filling
 *     it in is a derivation, not a guess. Warn and continue.
 *   - CONTRADICTORY — a required field is missing with nothing to derive it
 *     from, or a present value is outside a declared `enum`. Any value we chose
 *     would be invented, and an invented value written back to the entity FILE
 *     is indistinguishable from something the user wrote. Refuse.
 *
 * Only top-level fields are classified. Going deeper would mean deciding what a
 * missing nested optional means, and the six types in this repo disagree about
 * that (`dto.fields[]` omits unset optionals; `design-system` tokens spell them
 * `null`) — a disagreement a rebuild must not silently resolve.
 */
export function classifyGap(
  schema: Readonly<Record<string, FieldNode>>,
  payload: Record<string, unknown>,
): { filled: Record<string, unknown>; warnings: string[]; contradiction: string | null } {
  const filled: Record<string, unknown> = { ...payload };
  const warnings: string[] = [];

  for (const [name, node] of Object.entries(schema)) {
    if (node.systemManaged || node.transientInput || node.localSurrogate) continue;

    const value = filled[name];
    if (value !== undefined && value !== null) {
      if (node.kind === 'enum' && !node.values.includes(value as string)) {
        return {
          filled,
          warnings,
          contradiction: `'${name}' holds '${String(value)}', which is not one of ${node.values.join(', ')}`,
        };
      }
      continue;
    }

    if (!node.required) continue;
    if (node.default !== undefined) {
      filled[name] = node.default;
      warnings.push(`filled required '${name}' from its declared default`);
      continue;
    }
    if (node.computedDefault === 'now') {
      filled[name] = new Date().toISOString();
      warnings.push(`filled required '${name}' from computedDefault 'now'`);
      continue;
    }
    if (node.computedDefault) {
      /**
       * 0.2.22 — a DERIVED default fills the gap too, from fields the payload
       * already carries. Without this branch a type adding a derived `title`
       * would report a contradiction on every pre-existing file, even though its
       * own declaration says exactly where the value comes from.
       *
       * An empty result still falls through to the contradiction below: the
       * source fields were absent as well, and inventing a label out of nothing
       * is the guess this whole function exists to refuse.
       */
      const derived = evaluateComputedDefault(node.computedDefault, filled);
      if (derived) {
        filled[name] = derived;
        warnings.push(`filled required '${name}' from its declared computedDefault`);
        continue;
      }
    }
    return {
      filled,
      warnings,
      contradiction: `required field '${name}' is absent and the declaration offers no default`,
    };
  }

  return { filled, warnings, contradiction: null };
}

/**
 * Bring a payload to the type's current shape.
 *
 * A payload already at the current version is returned untouched and reports
 * `upgraded: false`, which is what keeps the rewrite one-time. A payload from
 * the FUTURE is always a hard error: there is no way to express a downgrade, and
 * running a newer file through an older host's write path would silently drop
 * whatever the newer shape added.
 */
export function upgradePayload(
  module: UpgradableModule,
  data: SnapshotData,
  from: number,
): UpgradeResult {
  const target = module.payloadVersion ?? 1;
  if (from === target) return { data, upgraded: false, warnings: [] };
  if (from > target) {
    /**
     * A payload from the FUTURE is read as-is, loudly, and the file is NOT
     * rewritten.
     *
     * This threw until a review pointed out what the throw actually did: the
     * indexer degrades an upgrade failure to "skip this entity", so one file
     * written by a newer build made every entity of that type VANISH — from the
     * list, from search, from every page that mentions one — behind a console
     * warning. Two people on different builds sharing a git spec repo is a
     * normal Tuesday, not an exotic corruption.
     *
     * Reading it is safe in the direction that matters: `restoreFromSchema`
     * copies only DECLARED fields, so whatever the newer shape added is ignored
     * rather than misread. `upgraded: false` is the load-bearing half — it stops
     * the indexer rewriting the file, which would silently downgrade it and
     * destroy the newer data for the teammate who wrote it.
     */
    return {
      data,
      upgraded: false,
      warnings: [
        `payload v${from} was written by a NEWER version of this type (this build is at ` +
          `v${target}) — reading the fields this build understands and leaving the file ` +
          `untouched. Upgrade to avoid losing what the newer version added.`,
      ],
    };
  }

  const chain = module.serializer?.payloadUpgrades ?? [];
  let payload = data;
  const warnings: string[] = [];

  // `payloadUpgrades[i]` takes payload i+1 to i+2, so the step out of version v
  // is at index v-1.
  for (let v = from; v < target; v += 1) {
    const step = chain[v - 1];
    if (!step) {
      warnings.push(`no upgrade declared for v${v} → v${v + 1}; relying on the declaration`);
      continue;
    }
    try {
      payload = step(payload);
    } catch (err) {
      throw new PayloadUpgradeError(module.type, from, target, `step v${v} threw: ${(err as Error).message}`);
    }
  }

  const schema = module.data?.schema;
  if (schema && payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const { filled, warnings: gapWarnings, contradiction } = classifyGap(
      schema,
      payload as Record<string, unknown>,
    );
    if (contradiction) throw new PayloadUpgradeError(module.type, from, target, contradiction);
    payload = filled;
    warnings.push(...gapWarnings);
  }

  return { data: payload, upgraded: true, warnings };
}


/**
 * Bring a CAPTURED payload (an `entity_version` / bundle row) to the type's
 * current shape.
 *
 * ONE implementation for every reader of that column, because there are four of
 * them and a review found the fourth had been missed: `ReleaseService` grew this
 * twice (restore and diff) and `VersionService` once, while the per-entity
 * version-diff route in `entities-router` kept feeding raw captures to
 * `host.diff`. The result was a diff view reporting a `summary` edit nobody made
 * on every endpoint spanning the 1 → 2 bump, with the "schema bump" badge
 * deliberately suppressed so nothing explained it.
 *
 * `ok: false` is a REPORTED failure, not a silent degrade. The caller decides —
 * a read-side consumer (a diff) can fall back to the raw payload and still be
 * useful, but a WRITE-side consumer must not: restoring an un-upgraded payload
 * writes today's collections back as if they were the release's, which reports
 * success while restoring nothing. See `ReleaseService.restoreEntity`.
 */
export function upgradeCapture(
  module: UpgradableModule | null | undefined,
  data: SnapshotData,
  from: number,
): { data: SnapshotData; ok: boolean; warnings: string[] } {
  if (!module) return { data, ok: true, warnings: [] };
  try {
    const result = upgradePayload(module, data, from);
    return { data: result.data, ok: true, warnings: result.warnings };
  } catch (err) {
    return { data, ok: false, warnings: [(err as Error).message] };
  }
}


/**
 * Everything an entity file carries that is ENVELOPE rather than content:
 * `createdAt`/`updatedAt` and the payload marker.
 *
 * One definition, because two callers have to agree on it and a review found
 * they did not. `ReleaseService.dropStampOnlyEntityChanges` — the filter that
 * keeps the git-anchored diff from reporting the boot backfill as thousands of
 * edits — stripped only the timestamps, so once `persist` began writing
 * `payloadVersion` the marker read as a CONTENT change. The git-anchored path
 * then called an entity `modified` while the SQL path (which diffs marker-free
 * captures) called it `noop`: two diff paths for one release, disagreeing, which
 * is the exact regression that filter exists to prevent.
 */
export function stripFileEnvelope(value: unknown): unknown {
  return stripPayloadVersion(stripSystemFields(value) as SnapshotData);
}
