import type { PluginManifest } from '@c4s/plugin-runtime';
import { dtoEntity } from './entity/dto/index.js';
import { endpointEntity } from './entity/endpoint/index.js';

/**
 * `c4s-plugin-api-contracts` — the pilot builtin envelope.
 *
 * It contributes TWO entity types because they are structurally coupled: the
 * `endpoint_dto` junction carries a foreign key to each, and the reads that
 * populate `linked_dtos` join across both tables. Shipping them separately
 * would leave the join with nowhere to live but the host, which is precisely
 * the arrangement this release removes.
 *
 * `dto` is listed first so the declaration order matches the dependency order
 * (`endpoint` declares `dependsOn: ['dto']`). Nothing depends on that — the
 * host topologically sorts — but a reader should not have to check.
 *
 * The package is trusted by virtue of living in the host repo: it is discovered
 * from `plugins/*`, outside the `trustProjectPlugins` gate that covers only the
 * project-local overlay.
 */
export const manifest: PluginManifest = {
  name: 'c4s-plugin-api-contracts',
  version: '0.2.2',
  hostApiVersion: '^1.0.0',
  engines: { node: '>=20' },
  contributes: {
    entities: [dtoEntity, endpointEntity],
  },
  /**
   * Nothing to tear down. The two services hold no timers, watchers or open
   * handles — every resource they touch belongs to the `ProjectContext` the
   * host disposes itself. Declared explicitly rather than omitted so a future
   * subscription has an obvious home.
   */
  onUnregister: () => {},
};
