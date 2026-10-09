/**
 * The per-project half of M33 → M37: which project-local plugin code may run
 * (the `trustProjectPlugins` gate), and how plugin skill contributions reach
 * this project's SkillRegistry. Extracted from `buildProjectContext` so the two
 * decisions are testable without building a whole context.
 */

import path from 'node:path';
import {
  enumerateOverlayPackages,
  loadProjectOverlay,
  type PluginImporter,
  type ProjectOverlayResult,
} from '../core/plugin-host/overlay-loader.js';
import type { PluginLoadRecord } from '../core/plugin-host/loader.js';
import type { PluginRegistry, UnloadedSkillSlug } from '../core/plugin-host/types.js';
import type { PluginSkillContribution } from '../../shared/plugin-host/manifest.js';
import type { SkillRegistry } from '../services/skill-registry.js';

export interface OverlayLayer {
  localPluginsPresent: boolean;
  /** Set ONLY on the trusted path — untrusted/undecided ⇒ no project-local code ran. */
  overlayResult: ProjectOverlayResult | undefined;
  records: PluginLoadRecord[];
}

/**
 * M33 phase 2: project-local plugin overlay, behind the machine-local
 * `trustProjectPlugins` gate. Untrusted/undecided ⇒ no overlay is built and no
 * project-committed code runs; its packages are reported as `untrusted`.
 */
export async function loadOverlayLayer(
  cwd: string,
  trust: boolean | undefined,
  importer?: PluginImporter,
): Promise<OverlayLayer> {
  const localPackages = enumerateOverlayPackages(cwd);
  const localPluginsPresent = localPackages.length > 0;
  if (localPluginsPresent && trust === true) {
    const overlayResult = importer ? await loadProjectOverlay(cwd, importer) : await loadProjectOverlay(cwd);
    return { localPluginsPresent, overlayResult, records: overlayResult.records };
  }
  if (localPluginsPresent) {
    return {
      localPluginsPresent,
      overlayResult: undefined,
      records: localPackages.map((pkg) => ({
        package: pkg,
        status: 'skipped' as const,
        code: 'PLUGIN_PROJECT_UNTRUSTED' as const,
        reason: 'project plugins not trusted on this machine (trustProjectPlugins)',
        layer: 'overlay' as const,
        trust: 'untrusted' as const,
        origin: path.join('.claude4spec', 'plugins', pkg),
      })),
    };
  }
  return { localPluginsPresent, overlayResult: undefined, records: [] };
}

/**
 * M15 / M37: push plugin-contributed skills into this project's SkillRegistry as
 * `source: "plugin"` — base (workspace/npm) skills always, overlay skills only on
 * the trusted path (`overlay` is set only when trust === true), so an untrusted
 * plugin contributes no skill and no style.
 *
 * A slug claimed by two plugins is a WARNING plus first-wins by discovery order —
 * never an abort; the loser's package keeps loading. The warning is emitted here
 * because this is the layer that knows the discovery order.
 *
 * 2.1.9 (M33 → M37): then the slugs of envelopes that did not load (gate-skipped
 * after the manifest was read, or an entry rejected for `contextTypes`) — the
 * `plugin` source reports them "known, unresolved" with the reason "envelope not
 * loaded"; a slug some source still delivers stays resolved.
 */
export function fanPluginSkills(
  skillRegistry: SkillRegistry,
  base: Pick<PluginRegistry, 'listSkills' | 'listUnloadedSkills'>,
  overlay?: Pick<ProjectOverlayResult, 'skills' | 'unloadedSkills'>,
): void {
  const skills: PluginSkillContribution[] = [...base.listSkills(), ...(overlay?.skills ?? [])];
  for (const skill of skills) {
    if (skillRegistry.hasPluginSkill(skill.slug)) {
      console.warn(
        `[skill] plugin skill slug "${skill.slug}" is contributed more than once; keeping the first by discovery order and skipping this one`,
      );
      continue;
    }
    skillRegistry.addPluginSkill(skill);
  }
  const unloaded: UnloadedSkillSlug[] = [...base.listUnloadedSkills(), ...(overlay?.unloadedSkills ?? [])];
  for (const u of unloaded) skillRegistry.addUnloadedPluginSkill(u.slug, u.detail);
}
