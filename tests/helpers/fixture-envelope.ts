/**
 * 2.1.65 (M13 `tvqcehf5`, `b2ahrh1b`, `mzjftvzp`) — a test type enters the
 * registry the only way any type does: as the envelope of a package, through
 * `registry.registerPlugin(manifest)`.
 *
 * `registerEntityModule` is no longer on the `PluginRegistry` interface — there
 * is no direct registration of a type bypassing the envelope — so a fixture
 * module is wrapped into a one-package manifest here and goes down the same
 * validate → lower → fan-out path as a built-in or an external package.
 */

import type { BackendModule, PluginRegistry } from '../../src/server/core/plugin-host/types.js';
import type { EntityContribution, PluginManifest } from '../../src/shared/plugin-host/manifest.js';
import { HOST_API_VERSION } from '../../src/shared/plugin-host/manifest.js';

/** The envelope a fixture's modules travel in; the name defaults to one derived from its types. */
export function fixtureEnvelope(modules: BackendModule | BackendModule[], name?: string): PluginManifest {
  const list = Array.isArray(modules) ? modules : [modules];
  return {
    name: name ?? `@fixture/envelope-${list.map((m) => m.type).join('+')}`,
    version: '0.0.0-test',
    hostApiVersion: `^${HOST_API_VERSION}`,
    // A fixture module is the lowered shape of a contribution; the registry
    // lowers it again (an identity for an authoring-valid module).
    contributes: { entities: list as unknown as EntityContribution[] },
  };
}

/** Register `modules` as one fixture envelope through `registerPlugin`. */
export function registerFixtureEnvelope(
  registry: Pick<PluginRegistry, 'registerPlugin'>,
  modules: BackendModule | BackendModule[],
  name?: string,
): void {
  registry.registerPlugin(fixtureEnvelope(modules, name));
}
