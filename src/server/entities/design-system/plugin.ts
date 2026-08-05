import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { SerializationContribution } from '../../serialization/types.js';
import { designSystemSlug } from '../../services/slug.js';
import { designSystemSerializer } from './serializer.js';
import { designSystemSystemPrompt } from './system-prompt.js';
import { designSystemData, designSystemSlugPattern } from '../../../shared/entities/design-system/schema.js';

export const designSystemBackendModule: BackendModule = {
  type: 'design-system',
  data: designSystemData,
  slugPattern: designSystemSlugPattern,
  /**
   * 2 since 0.2.9: v1 files carry a `description: null` on every token that the
   * hand-written snapshot synthesised and its restore stripped again. See
   * `./upgrades.ts`.
   */
  payloadVersion: 2,
  label: 'Design System',
  labelPlural: 'Design Systems',
  // After ui-view (40) and ac (50) — design systems sit at the end of ELEMENTS.
  displayOrder: 60,
  pathPrefix: '/design-systems',
  serializer: designSystemSerializer as SerializationContribution<unknown>,
  systemPrompt: designSystemSystemPrompt,
  /**
   * 2.0.0 tier K (item 60) — NO `backend` block at all.
   *
   * The last thing this type contributed on the server was `resolve(groups,
   * modes, activeMode?)`, and that was never the service's: `service.ts` merely
   * re-exported it from `shared/design-system.ts`, where the client reads it
   * from too. The serializer imports it from there directly now, so there is
   * nothing left for a `service` slot to carry — CRUD, routes and the search
   * scope all come from `data` above.
   */
};

export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(designSystemBackendModule);
}
