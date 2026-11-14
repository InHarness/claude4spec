/// <reference path="../../types/semver.d.ts" />
/**
 * 2.1.88 (M13 `irsmg4jn`, M33 `emco4ju2` / `9734yj2e`) — the contribution scope
 * of a plugin's skills and subagents, counted against the `ContextType` set the
 * plugin's DECLARED Host API version announces.
 *
 * Three rules live here:
 *
 *   - The set is the one of the declared version (the lowest version the
 *     manifest's `hostApiVersion` range admits — the version its author wrote
 *     against), FROZEN there: a value a later Host API release adds is not in it,
 *     so a plugin never gets a value its author did not know.
 *   - The loader checks a skill's `contextTypes` against that set only. Whether
 *     the PROJECT has a context-type registry row for a value is not the loader's
 *     question — the M37 resolver narrows to the turns that exist.
 *   - A skill that omits `contextTypes` enters unchanged; it is the set this
 *     module records for it that the plugin skill source reads as its scope. There
 *     is no "omitted = a fixed list of types" rule anywhere else.
 */
import semver from 'semver';
import type { PluginSkillContribution } from '../../../shared/plugin-host/manifest.js';
import { HOST_API_RELEASES, type HostApiRelease } from '../../../shared/plugin-host/host-api.js';

/** The context-type set of one Host API version, with the version that announced it. */
export interface HostApiContextTypeSet {
  /** The release whose set applies (the latest release at or below the declared version). */
  version: string;
  contextTypes: readonly string[];
}

/**
 * The `ContextType` set of the Host API version a plugin declared.
 *
 * ASSUMPTION:contribution-scope-declared-version — the declared version is
 * `semver.minVersion(range)`. The set is that of the
 * latest release at or below it; a range below the oldest recorded release (or
 * one semver cannot read — the loader's gate refuses those before this runs) gets
 * the oldest release's set, the narrowest the registry knows.
 */
export function hostApiContextTypesFor(
  declaredRange: string,
  releases: readonly Pick<HostApiRelease, 'version' | 'contextTypes'>[] = HOST_API_RELEASES,
): HostApiContextTypeSet {
  const sorted = [...releases].sort((a, b) => semver.compare(a.version, b.version));
  const oldest = sorted[0];
  if (!oldest) throw new Error('the Host API release registry is empty');
  let declared: string | null = null;
  try {
    declared = semver.minVersion(declaredRange)?.version ?? null;
  } catch {
    declared = null;
  }
  let applies = oldest;
  if (declared) {
    for (const r of sorted) if (semver.lte(r.version, declared)) applies = r;
  }
  return { version: applies.version, contextTypes: applies.contextTypes };
}

/**
 * The set a loaded skill contribution is scoped by, recorded by the loader (base
 * and overlay layers) when it admits the entry. Kept beside the contribution, not
 * written into it: the entry itself enters unchanged (M33 `emco4ju2`).
 */
const declaredSets = new WeakMap<PluginSkillContribution, readonly string[]>();

/** Record the declared Host API version's set for an admitted skill contribution. */
export function recordDeclaredContextTypes(skill: PluginSkillContribution, set: HostApiContextTypeSet): void {
  declaredSets.set(skill, set.contextTypes);
}

/**
 * The declared set recorded for `skill`, or `undefined` for a contribution no
 * loader admitted (a direct push in a test) — the plugin skill source then holds
 * it to the running Host API version's set.
 */
export function declaredContextTypesOf(skill: PluginSkillContribution): readonly string[] | undefined {
  return declaredSets.get(skill);
}
