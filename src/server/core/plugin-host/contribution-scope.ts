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
 *   - A skill that omits `contextTypes` enters unchanged; the declared set is
 *     carried beside it (`ScopedPluginSkill`) and the plugin skill source reads
 *     it as its scope. There
 *     is no "omitted = a fixed list of types" rule anywhere else.
 */
import semver from 'semver';
import type { PluginSkillContribution, PluginSubagentContribution } from '../../../shared/plugin-host/manifest.js';
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
 * A skill contribution the loader admitted, CARRIED with the declared Host API
 * version's set it is scoped by (rev-0001). The set travels explicitly from
 * admission (`registry.ts` / `overlay-loader.ts`) to the fan-out into the
 * SkillRegistry (`fanPluginSkills`), so no copy of the entry between the two can
 * lose it and silently widen it to the running version's set. The entry itself
 * enters unchanged (M33 `emco4ju2`): the set is beside it, not written into it.
 */
export interface ScopedPluginSkill {
  skill: PluginSkillContribution;
  /** The `ContextType` set of the plugin's declared Host API version. */
  declaredContextTypes: readonly string[];
}

/** Pair every admitted entry of one manifest with that manifest's declared set. */
export function scopeSkills(
  skills: readonly PluginSkillContribution[],
  declaredContextTypes: readonly string[],
): ScopedPluginSkill[] {
  return skills.map((skill) => ({ skill, declaredContextTypes }));
}

/**
 * Why a subagent contribution's explicit `contextTypes` is outside the declared
 * Host API version's set, or `null` when it is inside it (or omitted, or not an
 * array — the per-turn resolver in `services/plugin-subagents.ts` owns those:
 * omission is `['chat']`, a non-array is rejected there).
 */
export function subagentContextTypesReason(
  c: PluginSubagentContribution,
  set: HostApiContextTypeSet,
): string | null {
  if (!c || typeof c !== 'object' || !Array.isArray(c.contextTypes)) return null;
  const bad = (c.contextTypes as unknown[]).filter((t) => !set.contextTypes.includes(t as string));
  if (bad.length === 0) return null;
  const shown = bad.map((b) => JSON.stringify(b) ?? String(b)).join(', ');
  const allowed = set.contextTypes.map((t) => `'${t}'`).join(' | ');
  return `contextTypes contains ${shown}, outside the context types of the declared Host API ${set.version} (${allowed})`;
}

/**
 * 2.1.88 (rev-0002, M13 `irsmg4jn`, M33 `9734yj2e`) — a subagent's contribution
 * scope counts against the declared Host API version's set too. An entry naming a
 * value outside that set is dropped with a warning; the rest of the package
 * still loads. Everything else about a subagent stays raw for the per-turn
 * resolver.
 */
export function admitSubagentContextTypes(
  pluginName: string,
  list: readonly PluginSubagentContribution[],
  set: HostApiContextTypeSet,
): PluginSubagentContribution[] {
  return list.filter((c) => {
    const reason = subagentContextTypesReason(c, set);
    if (reason === null) return true;
    const label = typeof c.name === 'string' && c.name.length > 0 ? c.name : '(no name)';
    console.warn(
      `[plugin] ${pluginName}: subagent "${label}" — ${reason}; skipping this contribution (the rest of the package still loads)`,
    );
    return false;
  });
}
