/**
 * M33 — Host API versioning surface: the per-major changelog and the
 * migration descriptors a plugin author needs when their package was built
 * against an incompatible major.
 *
 * Versioning rule (mirrored in the manifest doc): additive same-major slots =
 * minor bump; a breaking slot-shape change = major bump WITH a descriptor here
 * and a deprecation window (a slot deprecated in major N may be removed only in
 * N+1). `incompatible` (major mismatch) is distinct from `skipped` (an `engines`
 * miss — an environment problem with no migration path).
 *
 * The surface now also covers the `stable` Host UI Kit components (M34/L12); a
 * breaking prop-shape change there is a major bump with a `ui-prop-reshape`
 * descriptor (see {@link VERSIONED_UI_KIT_COMPONENTS}).
 */

import { HOST_API_VERSION, parseMajor } from './manifest.js';
import { UI_KIT_STABLE_COMPONENTS } from './ui-kit-surface.js';

/**
 * The component prop contracts counted into the versioned `hostApiVersion`
 * surface from the Host UI Kit (M34/L12): the `stable` (Core) tier ONLY. A
 * breaking prop-shape change to one of these is a major bump carrying a
 * `ui-prop-reshape` descriptor below (AC3). `experimental` kit components are
 * exposed by `@c4s/plugin-runtime/ui` but excluded here — their props may change
 * without a major and they are NOT gated at plugin load (AC4). Promoting an
 * `experimental` component to `stable` adds it to {@link UI_KIT_STABLE_COMPONENTS}
 * and thereby to this surface (AC5).
 */
export const VERSIONED_UI_KIT_COMPONENTS = UI_KIT_STABLE_COMPONENTS;

/** One versioned change to the Host API contract between two adjacent majors. */
export interface HostApiMigration {
  fromMajor: number;
  toMajor: number;
  /** The affected slot / surface, e.g. "onUnregister" or a `stable` kit component. */
  slot: string;
  /**
   * `ui-prop-reshape` — a breaking prop-shape change to a `stable` Host UI Kit
   * component (M34/L12). The others cover the manifest/contributes/editor
   * surfaces.
   */
  kind: 'slot-required' | 'field-rename' | 'contributes-reshape' | 'ui-prop-reshape';
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
 * Empty at the `1.0.0` baseline — no major has been crossed yet. The first
 * breaking slot-shape change will add an entry here (and bump the major).
 */
const HOST_API_CHANGELOG: HostApiMigration[] = [];

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
    // No shim without descriptors, and a slot becoming required can never be
    // shimmed (the author must implement it). Empty changelog ⇒ false.
    shimAvailable: migrations.length > 0 && migrations.every((m) => m.kind !== 'slot-required'),
  };
}
