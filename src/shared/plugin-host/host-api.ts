/**
 * M33 phase 3 — Host API versioning surface: the per-major changelog and the
 * migration descriptors a plugin author needs when their package was built
 * against an incompatible major.
 *
 * Versioning rule (mirrored in the manifest doc): additive same-major slots =
 * minor bump; a breaking slot-shape change = major bump WITH a descriptor here
 * and a deprecation window (a slot deprecated in major N may be removed only in
 * N+1). `incompatible` (major mismatch) is distinct from `skipped` (an `engines`
 * miss — an environment problem with no migration path).
 */

import { HOST_API_VERSION, parseMajor } from './manifest.js';

/** One versioned change to the Host API contract between two adjacent majors. */
export interface HostApiMigration {
  fromMajor: number;
  toMajor: number;
  /** The affected slot / surface, e.g. "onUnregister". */
  slot: string;
  kind: 'slot-required' | 'field-rename' | 'contributes-reshape';
  /** Human-readable migration instruction. */
  summary: string;
}

/** Migration path attached to an `incompatible` package record. */
export interface PluginMigrationInfo {
  /** The Host API version to target after migrating. */
  targetHostApiVersion: string;
  /** Versioned descriptors of the shape changes between the plugin's major and the host's. */
  migrations: HostApiMigration[];
  /** Whether a compat-shim exists for the deprecated slot(s). */
  shimAvailable: boolean;
}

/**
 * The Host API changelog, one entry per breaking change at a major boundary.
 * 2.0.0 made `onUnregister` required (hot-reload teardown) — a `slot-required`
 * change, which has no compat-shim (the author must implement the slot).
 */
const HOST_API_CHANGELOG: HostApiMigration[] = [
  {
    fromMajor: 1,
    toMajor: 2,
    slot: 'onUnregister',
    kind: 'slot-required',
    summary:
      'onUnregister is now a required manifest slot (idempotent, non-throwing) — the hot-reload pipeline calls it to tear the old version down before registering the new one.',
  },
];

/** First numeric component of a semver RANGE (e.g. "^1.4.0" → 1, ">=2.5.0" → 2). */
export function rangeMajor(range: string): number | null {
  const m = /(\d+)/.exec(range);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Changelog entries spanning the majors between (inclusive of the boundary crossings). */
export function migrationsBetween(fromMajor: number, toMajor: number): HostApiMigration[] {
  const [lo, hi] = fromMajor <= toMajor ? [fromMajor, toMajor] : [toMajor, fromMajor];
  return HOST_API_CHANGELOG.filter((m) => m.fromMajor >= lo && m.toMajor <= hi);
}

/**
 * Build the migration info for a plugin whose `hostApiVersion` RANGE targets a
 * different major than the running host. Returns `null` when the majors match
 * (no migration needed) or the range major is unparseable.
 */
export function buildMigrationInfo(pluginRange: string): PluginMigrationInfo | null {
  const pluginMajor = rangeMajor(pluginRange);
  const hostMajor = parseMajor(HOST_API_VERSION);
  if (pluginMajor == null || hostMajor == null || pluginMajor === hostMajor) return null;
  const migrations = migrationsBetween(pluginMajor, hostMajor);
  return {
    targetHostApiVersion: HOST_API_VERSION,
    migrations,
    // A slot becoming required cannot be shimmed — the author must implement it.
    shimAvailable: migrations.length > 0 && migrations.every((m) => m.kind !== 'slot-required'),
  };
}
