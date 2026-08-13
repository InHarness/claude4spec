/**
 * M31: process-level plugin catalog. Replaces the mutable `pluginHost`
 * singleton — the registry is immutable after `registerAllPlugins(registry)`
 * runs at process start, and `consolidate(config.entities)` is a pure factory
 * producing one ProjectPluginHost per project context.
 *
 * M33: the base layer is no longer process-immutable — the hot-reload
 * pipeline mutates it via `registerPlugin` / `unregisterPlugin` and then
 * invalidates dependent `ProjectContext`s (axis B). The registry additionally
 * retains a per-plugin {@link RegisteredPluginRecord} so the host can surface
 * non-entity capabilities (settings/commands) and the reload pipeline can call
 * the old version's `onUnregister` before re-registering.
 */

import type {
  BackendModule,
  PluginRegistry,
  ProjectPluginHost,
  ProjectPluginOverlay,
  RegisteredPluginRecord,
} from './types.js';
import type {
  PluginCommandContribution,
  PluginManifest,
  PluginSettingsModule,
  PluginSkillContribution,
} from '../../../shared/plugin-host/manifest.js';
import { ProjectPluginHostImpl } from './project-host.js';
import {
  PluginManifestError,
  lowerEntityContribution,
  synthesizeMount,
  validateSkillContribution,
  validateWritingStyle,
  assertSerializationContribution,
} from './manifest-adapter.js';
import { attachComposition } from './composition-validation.js';

/** Internal record: the public one plus the skills + the registered module
 *  instances, so unregister can drop skills and delete ONLY the modules this
 *  plugin still owns (identity check). */
interface InternalPluginRecord extends RegisteredPluginRecord {
  skills: PluginSkillContribution[];
  entityModules: BackendModule[];
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
    // 0.2.9 — the L9 contract check runs HERE, not only in `validateAndLower`,
    // for the same reason `synthesizeMount` and `attachComposition` do: an
    // in-repo entity builds its `BackendModule` directly and would otherwise
    // never be checked. A stale 1.x view slot or a `payloadVersion` that
    // disagrees with the manifest has to fail identically whichever door the
    // module came through.
    assertSerializationContribution(
      module.type,
      (module.serializer ?? {}) as Record<string, unknown>,
      module.payloadVersion,
    );
    this.modules.set(module.type, attachComposition(synthesizeMount(module), this.modules.values()));
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
  private validateAndLower(manifest: PluginManifest): LoweredPlugin {
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
    const batch: BackendModule[] = [];
    const entityModules = (manifest.contributes.entities ?? [])
      .map(lowerEntityContribution)
      .map(synthesizeMount)
      .map((m) => {
        const validated = attachComposition(m, [...this.modules.values(), ...batch]);
        batch.push(validated);
        return validated;
      });
    // 0.2.19 — both skill slots land in one list, validated identically: the
    // primary `skills` first, then `writingStyles` lowered to `scope:
    // 'writing-style'`. Order matters only for the first-wins slug rule applied
    // downstream, and the primary slot reasonably wins its own manifest.
    const skills: PluginSkillContribution[] = [
      ...(manifest.contributes.skills ?? []).map(validateSkillContribution),
      ...(manifest.contributes.writingStyles ?? []).map(validateWritingStyle),
    ];

    // `onUnregister` is a required slot from the HOST_API 1.0.0 baseline. A
    // runtime manifest missing it is not crashed over — warn (parity with L8
    // slot validation) and substitute a no-op so the reload pipeline still works.
    let onUnregister: () => void;
    if (typeof manifest.onUnregister === 'function') {
      onUnregister = () => manifest.onUnregister();
    } else {
      console.warn(
        `[plugin-registry] plugin "${manifest.name}" — required slot onUnregister is missing; using a no-op teardown`,
      );
      onUnregister = () => {};
    }

    const settings: PluginSettingsModule = manifest.contributes.settings ?? [];
    const commands: PluginCommandContribution[] = manifest.contributes.commands ?? [];
    return {
      record: {
        name: manifest.name,
        version: manifest.version,
        contributedTypes: entityModules.map((m) => m.type),
        settings,
        commands,
        skills,
        entityModules,
        onUnregister,
      },
    };
  }

  validatePlugin(manifest: PluginManifest): void {
    this.validateAndLower(manifest);
  }

  registerPlugin(manifest: PluginManifest): void {
    const { record } = this.validateAndLower(manifest);
    // 0.2.19 — the fan-out is FIVE branches over four real capability kinds, and
    // none of them reaches the M19 reference registry: entities →
    // registerEntityModule (here), skills → SkillRegistry (M37), writingStyles →
    // the same SkillRegistry via the sugar lowering above, settings → the
    // settings registry, and commands → registerEditorExtension (the last four
    // read off the record by their own consumers).
    for (const module of record.entityModules) {
      this.registerEntityModule(module);
    }
    // Re-registration (hot-reload) overwrites the prior record; Map keeps the
    // first-seen insertion order, which is what we want for stable section order.
    this.plugins.set(record.name, record);
  }

  unregisterPlugin(name: string): void {
    const record = this.plugins.get(name);
    if (!record) return;
    try {
      record.onUnregister();
    } catch (err) {
      // Idempotent + non-throwing by contract — a throw is a warning, never a block.
      console.warn(`[plugin-registry] onUnregister of "${name}" threw: ${(err as Error).message}`);
    }
    for (const module of record.entityModules) {
      // Only drop the module if it is STILL the one this plugin contributed — a
      // later same-typed registration (another base plugin contributing the same
      // type) would have overwritten the slot, and must not be clobbered here.
      if (this.modules.get(module.type) === module) {
        this.modules.delete(module.type);
      }
    }
    this.plugins.delete(name);
  }

  listPluginRecords(): RegisteredPluginRecord[] {
    return Array.from(this.plugins.values()).map((r) => ({
      name: r.name,
      version: r.version,
      contributedTypes: [...r.contributedTypes],
      settings: r.settings,
      commands: r.commands,
      onUnregister: r.onUnregister,
    }));
  }

  listSkills(): PluginSkillContribution[] {
    return Array.from(this.plugins.values()).flatMap((r) => r.skills);
  }

  listAvailable(): BackendModule[] {
    return Array.from(this.modules.values()).sort(
      (a, b) => a.displayOrder - b.displayOrder
    );
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
