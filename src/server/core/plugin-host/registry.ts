/**
 * M31: process-level plugin catalog. Replaces the mutable `pluginHost`
 * singleton — the registry is immutable after the loader fills it at process
 * start (built-in envelopes, then packages), and `consolidate(config.entities)` is a pure factory
 * producing one ProjectPluginHost per project context.
 *
 * M33: the base layer is no longer process-immutable — the hot-reload
 * pipeline mutates it via `registerPlugin` / `unregisterPlugin` and then
 * invalidates dependent `ProjectContext`s (axis B). The registry additionally
 * retains a per-plugin {@link RegisteredPluginRecord} so the host can surface
 * non-entity capabilities (commands/subagents) and so `unregisterPlugin` can
 * unwire the whole envelope by dropping one record.
 */

import type {
  BackendModule,
  PluginRegistry,
  ProjectPluginHost,
  ProjectPluginOverlay,
  RegisteredPluginRecord,
  UnloadedSkillSlug,
} from './types.js';
import type {
  PluginCommandContribution,
  PluginSubagentContribution,
  PluginManifest,
  PluginSkillContribution,
} from '../../../shared/plugin-host/manifest.js';
import { ProjectPluginHostImpl } from './project-host.js';
import {
  PluginManifestError,
  PluginTypeConflictError,
  lowerEntityContribution,
  synthesizeMount,
  admitSkillContextTypes,
  validateSkillContribution,
  validateWritingStyle,
  assertSerializationContribution,
  applyReservedTitleDefault,
} from './manifest-adapter.js';
import { attachComposition } from './composition-validation.js';

/** Internal record: the public one plus the skills + the registered module
 *  instances, so unregister can drop skills and delete ONLY the modules this
 *  plugin still owns (identity check). */
interface InternalPluginRecord extends RegisteredPluginRecord {
  skills: PluginSkillContribution[];
  /** Slugs of `contributes.skills` entries the `contextTypes` check rejected (2.1.9). */
  rejectedSkills: string[];
  entityModules: BackendModule[];
}

/** " (by plugin "x")" / " (direct registration)" — who holds a type, for a conflict message. */
function ownerSuffix(owner: string | null): string {
  return owner ? ` (by plugin "${owner}")` : ' (direct registration)';
}

/** Outcome of validating + lowering a manifest, ready to commit to the registry. */
interface LoweredPlugin {
  record: InternalPluginRecord;
}

export class PluginRegistryImpl implements PluginRegistry {
  private modules = new Map<string, BackendModule>();
  // M33: base-layer plugins by name, in registration order. The source
  // of truth for `listSkills` / `listPluginRecords` so a hot-reload that
  // calls `unregisterPlugin` cleanly drops the old version's skills too.
  private plugins = new Map<string, InternalPluginRecord>();
  // 2.1.9: skill slugs of base packages the loader's gate skipped, by plugin name.
  private gateSkippedSkills = new Map<string, UnloadedSkillSlug[]>();

  registerEntityModule(module: BackendModule): void {
    if (!module.type) {
      throw new Error('plugin-registry: module.type is required');
    }
    // M13: lower declarative backend slots (service/crud/routes/mcpServer) into
    // an equivalent `mount` for every module — in-repo entities build a
    // `BackendModule` directly (never touching `EntityContribution`), so this
    // is the one place both origins are guaranteed to pass through.
    // 0.2.4: the composition descriptor is validated and cached here too, not
    // only in `validateAndLower` — same reason as `synthesizeMount` above. A
    // descriptor naming a baseline table or another type's table must reject
    // the manifest, and a direct caller (a built-in's `onRegister`) has to hit
    // the identical bar as one routed through `registerPlugin`.
    // 0.2.9 — the M13 contract check runs HERE, not only in `validateAndLower`,
    // for the same reason `synthesizeMount` and `attachComposition` do: an
    // in-repo entity builds its `BackendModule` directly and would otherwise
    // never be checked. A stale 1.x view slot or a `payloadVersion` that
    // disagrees with the manifest has to fail identically whichever door the
    // module came through.
    assertSerializationContribution(
      module.type,
      module as unknown as Record<string, unknown>,
      module.payloadVersion,
    );
    // 2.1.63 (M13 `m13pool0`) — a type already in the base is a hard
    // `PLUGIN_TYPE_CONFLICT`, not a silent last-wins over the module that holds
    // it. `registerPlugin` checks the same rule up front (atomically, before any
    // of its modules is committed); this is the choke point a direct caller hits.
    const existing = this.modules.get(module.type);
    if (existing) {
      throw new PluginTypeConflictError(
        `type "${module.type}" is already registered in the base${ownerSuffix(this.ownerOf(existing))}`,
        module.type,
      );
    }
    // 0.2.51 — resolve the host's default `title` bound before anything reads
    // the declaration, so a type that widened it, a type that narrowed it and a
    // type that said nothing are all one shape from here on.
    const resolved = applyReservedTitleDefault(module);
    this.modules.set(resolved.type, attachComposition(synthesizeMount(resolved), this.modules.values()));
    // 0.2.15 — nothing is forwarded to the M19 reference registry from here any
    // more. An entity module no longer owns an XML tag; it is embedded through
    // the generic tags, dispatched on `type=`.
  }

  /**
   * Validate a manifest's shape and lower every contribution WITHOUT mutating
   * the registry. Throws `PluginManifestError` on any structural problem (the
   * loader/reload pipeline catches it). The hot-reload pipeline calls this
   * BEFORE tearing the old version down, so a structurally-broken new version
   * never leaves the pool missing a type ("old stays").
   */
  private validateAndLower(manifest: PluginManifest, replacing = false): LoweredPlugin {
    if (!manifest || typeof manifest !== 'object') {
      throw new PluginManifestError('plugin manifest must be an object');
    }
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new PluginManifestError('plugin manifest requires string name + version');
    }
    if (manifest.contributes == null || typeof manifest.contributes !== 'object') {
      throw new PluginManifestError(`plugin "${manifest.name}" — contributes must be an object`);
    }
    // Two-pass for atomicity: lower (validate) every contribution first, so a
    // throw on a later entity/style never leaves earlier ones registered.
    // M13: also run synthesizeMount here (not just in registerEntityModule) —
    // its crud-without-service / mcpServer-without-service checks must
    // surface at VALIDATION time. The hot-reload pipeline calls validatePlugin
    // before tearing down the old version specifically so a structurally
    // broken new version never leaves the pool missing a type; skipping this
    // check here would let it pass validation, tear down the old version, and
    // only then fail at registerPlugin — the exact "old stays" gap this
    // two-pass validate-before-teardown design exists to prevent. Idempotent:
    // registerEntityModule reapplies it at commit time, a no-op once mount is set.
    // 0.2.4: validate each composition descriptor against the already-registered
    // modules AND against the ones earlier in this same batch — two entities of
    // one manifest claiming the same table must be rejected as surely as a
    // cross-plugin collision, and neither is committed yet at this point.
    // 2.1.63 (M13 `m13pool0`): the same goes for the TYPE itself — a type the
    // base already holds, or one this manifest declares twice, is a
    // `PLUGIN_TYPE_CONFLICT` raised here, before anything is committed. Only a
    // replacement (`validatePlugin`, the reload pipeline validating a new version
    // before tearing the old one down) may reuse the types its own name holds.
    const own = replacing ? this.plugins.get(manifest.name) : undefined;
    const batch: BackendModule[] = [];
    const entityModules = (manifest.contributes.entities ?? [])
      .map(lowerEntityContribution)
      .map(applyReservedTitleDefault)
      .map(synthesizeMount)
      .map((m) => {
        if (batch.some((b) => b.type === m.type)) {
          throw new PluginTypeConflictError(`plugin "${manifest.name}" contributes type "${m.type}" twice`, m.type);
        }
        const existing = this.modules.get(m.type);
        if (existing && !own?.entityModules.includes(existing)) {
          throw new PluginTypeConflictError(
            `plugin "${manifest.name}" contributes type "${m.type}", already registered in the base${ownerSuffix(this.ownerOf(existing))}`,
            m.type,
          );
        }
        const validated = attachComposition(m, [...this.modules.values(), ...batch]);
        batch.push(validated);
        return validated;
      });
    // 0.2.19 — both skill slots land in one list, validated identically: the
    // primary `skills` first, then `writingStyles` lowered to `scope:
    // 'writing-style'`. Order matters only for the first-wins slug rule applied
    // downstream, and the primary slot reasonably wins its own manifest.
    //
    // 0.2.66 — `admitSkillContextTypes` runs FIRST on the primary slot, and it
    // warns-and-skips where the validators throw. A `contextTypes` naming a turn
    // that does not exist is the one skill defect that must not abort its
    // envelope: it is a selector over turns, not part of the skill's identity.
    const rejectedSkills: string[] = [];
    const skills: PluginSkillContribution[] = [
      ...admitSkillContextTypes(manifest.name, manifest.contributes.skills ?? [], rejectedSkills).map(
        validateSkillContribution,
      ),
      ...(manifest.contributes.writingStyles ?? []).map(validateWritingStyle),
    ];

    // 0.2.29 — `onUnregister` is an OPTIONAL slot, and its absence is the NORMAL
    // case: a purely declarative package holds no resource of its own to release.
    // So no warning and no substituted no-op — the record simply carries
    // `undefined`, and the reload pipeline's `?.()` skips the step. What used to
    // justify the warning (a reload leaving duplicated slots) is now the host's
    // job in `unregisterPlugin` + the ProjectContext rebuild, which run whether
    // or not the plugin declared anything.
    const onUnregister: (() => void) | undefined =
      typeof manifest.onUnregister === 'function' ? () => manifest.onUnregister!() : undefined;

    const commands: PluginCommandContribution[] = manifest.contributes.commands ?? [];
    // Carried RAW. Validation, dedupe and sanitizing belong to the per-turn
    // resolver (services/plugin-subagents.ts) rather than here, because the
    // reserved-name and first-wins rules span BOTH layers (base pool + overlay)
    // and this class only ever sees the base one.
    const subagents: PluginSubagentContribution[] = manifest.contributes.subagents ?? [];
    return {
      record: {
        name: manifest.name,
        version: manifest.version,
        contributedTypes: entityModules.map((m) => m.type),
        commands,
        subagents,
        skills,
        rejectedSkills,
        entityModules,
        onUnregister,
      },
    };
  }

  validatePlugin(manifest: PluginManifest): void {
    this.validateAndLower(manifest, true);
  }

  /** Name of the base plugin whose record holds `module`; `null` for a direct registration. */
  private ownerOf(module: BackendModule): string | null {
    for (const record of this.plugins.values()) {
      if (record.entityModules.includes(module)) return record.name;
    }
    return null;
  }

  registerPlugin(manifest: PluginManifest): void {
    const { record } = this.validateAndLower(manifest);
    // 2.1.21 — the fan-out is FIVE slots, and none of them reaches the M19
    // reference registry nor any settings registry: entities →
    // registerEntityModule (here), skills → SkillRegistry (M37), writingStyles →
    // the same SkillRegistry via the sugar lowering above, commands →
    // registerEditorExtension, and subagents → subagentsFor() at turn build (the
    // last four read off the record by their own consumers). The envelope has
    // no `settings` slot any more (M13 `m13plenv`); a stale key on an old
    // manifest is not read by anything.
    for (const module of record.entityModules) {
      this.registerEntityModule(module);
    }
    // A re-registration under the same name (hot reload) comes after
    // `unregisterPlugin`, so its types are free again; Map keeps the first-seen
    // insertion order, which is what we want for stable section order.
    this.plugins.set(record.name, record);
    this.gateSkippedSkills.delete(record.name);
  }

  noteUnloadedSkills(pluginName: string, slugs: string[], detail: string): void {
    this.gateSkippedSkills.set(
      pluginName,
      slugs.map((slug) => ({ slug, plugin: pluginName, detail })),
    );
  }

  listUnloadedSkills(): UnloadedSkillSlug[] {
    const rejected = Array.from(this.plugins.values()).flatMap((r) =>
      r.rejectedSkills.map((slug) => ({
        slug,
        plugin: r.name,
        detail: `entry "${slug}" of package "${r.name}" was rejected by the loader (contextTypes outside the enum)`,
      })),
    );
    return [...Array.from(this.gateSkippedSkills.values()).flat(), ...rejected];
  }

  /**
   * 0.2.29 — the mirror of `registerPlugin`, and the HOST's half of teardown.
   * Deliberately does NOT call `record.onUnregister()`: that hook is the
   * plugin's own-resources teardown and the reload pipeline calls it first, on
   * the OLD instance, so that even a throwing hook cannot hold up this step.
   *
   * The fan-out backwards over `contributedTypes[]` is the two statements below:
   * the entity modules are deleted by type, and deleting the record takes the
   * skills, the commands and the subagent contributions with it (every one of those is pull-read off the record,
   * never pushed anywhere). That is why the subagent capability needs no
   * teardown step of its own: `subagentsFor()` reads the registry by pull when
   * a turn is built and keeps no copy, and `subagents` is a per-turn mutable
   * field — so dropping the source is enough and the contribution is gone from
   * the NEXT turn, with no session restart and no ProjectContext invalidation.
   * Nothing is handed back to a settings registry: plugins contribute no
   * settings (2.1.21).
   *
   * Mounted things — Express routes, MCP factories, DI services — are NOT
   * removed here; they come down on the `ProjectContext` rebuild.
   */
  unregisterPlugin(name: string): void {
    const record = this.plugins.get(name);
    // Idempotency lives here: an unknown name is a no-op, not an error.
    if (!record) return;
    // 2.1.63 — the slot of each type is this plugin's own: a second base plugin
    // contributing the same type is rejected (`PLUGIN_TYPE_CONFLICT`), never
    // written over it, so there is no later owner to protect here.
    for (const module of record.entityModules) this.modules.delete(module.type);
    this.plugins.delete(name);
  }

  listPluginRecords(): RegisteredPluginRecord[] {
    return Array.from(this.plugins.values()).map((r) => ({
      name: r.name,
      version: r.version,
      contributedTypes: [...r.contributedTypes],
      commands: r.commands,
      subagents: r.subagents,
      onUnregister: r.onUnregister,
    }));
  }

  listSkills(): PluginSkillContribution[] {
    return Array.from(this.plugins.values()).flatMap((r) => r.skills);
  }

  listAvailable(): BackendModule[] {
    // 2.1.26 — no ordering field on the identity: the pool is listed by `type`
    // (deterministic). The sidebar's default order is the frontend's
    // `sidebarTab.order` (the team's `elementsMenu` layout goes over it).
    return Array.from(this.modules.values()).sort((a, b) => a.type.localeCompare(b.type));
  }

  getAvailable(type: string): BackendModule | null {
    return this.modules.get(type) ?? null;
  }

  consolidate(
    config: { entities?: string[] } | null | undefined,
    overlay?: ProjectPluginOverlay,
  ): ProjectPluginHost {
    return new ProjectPluginHostImpl(this, config?.entities, overlay);
  }
}
