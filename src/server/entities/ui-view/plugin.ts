import type { BackendModule, PluginRegistry } from '../../core/plugin-host/types.js';
import type { SerializationContribution } from '../../serialization/types.js';
import { uiViewSlug } from '../../services/slug.js';
import { uiViewSerializer } from './serializer.js';
import { uiViewSystemPrompt } from './system-prompt.js';
import { uiViewData, uiViewSlugPattern } from '../../../shared/entities/ui-view/schema.js';

export const uiViewBackendModule: BackendModule = {
  type: 'ui-view',
  data: uiViewData,
  slugPattern: uiViewSlugPattern,
  payloadVersion: 1,
  label: 'UI View',
  labelPlural: 'UI Views',
  displayOrder: 40,
  pathPrefix: '/ui-views',
  /**
   * 0.2.2 — a ui-view's `designSystemSlug` points at a design-system, so that
   * type is indexed first. A dangling reference is only a warning (never an
   * error), but the order is DECLARED rather than left to chance so the warning
   * fires only when the design-system is genuinely absent.
   */
  dependsOn: ['design-system'],
  serializer: uiViewSerializer as SerializationContribution<unknown>,
  systemPrompt: uiViewSystemPrompt,
  /**
   * 2.0.0 tier K (item 59) — NO `backend` block at all.
   *
   * The service was CRUD and nothing else; the one piece of judgement it held,
   * the `url` ↔ `params` linter, moved to `shared/entities/ui-view/lint.ts` in
   * K2 and now runs where its output is read (the detail panel) rather than
   * only on write. Repointing `designSystemSlug` after a rename is
   * `ref: 'design-system'` on the field.
   */
};

/** M31: self-registration side effect replaced by an explicit hook — called once per process by registerAllPlugins(registry). */
export function onRegister(registry: PluginRegistry): void {
  registry.registerEntityModule(uiViewBackendModule);
}
