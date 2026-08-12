import type { EntityContribution } from '@c4s/plugin-runtime';
import {
  DESIGN_SYSTEM_TYPE,
  UI_VIEW_DISPLAY_ORDER,
  UI_VIEW_LABEL,
  UI_VIEW_LABEL_PLURAL,
  UI_VIEW_PATH_PREFIX,
  UI_VIEW_TYPE,
} from '../../identity.js';
import { uiViewSerializer } from './views.js';
import { uiViewSystemPrompt } from './system-prompt.js';
import { uiViewData, uiViewSlugPattern } from './schema.js';

/**
 * The `ui-view` contribution — no `backend` block; the generated `/api/ui-views`
 * router serves every CRUD verb from `data` below.
 *
 * `dependsOn: ['design-system']` is the runtime half of the coupling that puts
 * both types in ONE envelope: `data.schema.designSystemSlug` carries
 * `ref: 'design-system'`, with `onMissing: 'warn'` and
 * `onDelete: 'leave-dangling'`, so the ref's target must be registered first.
 * The host topologically sorts `contributes.entities` by `dependsOn`, and the
 * manifest also lists `design-system` first — belt and braces, because a split
 * across two envelopes would cut the declaration no matter the order.
 */
export const uiViewEntity: EntityContribution = {
  type: UI_VIEW_TYPE,
  data: uiViewData,
  slugPattern: uiViewSlugPattern,
  payloadVersion: 1,
  label: UI_VIEW_LABEL,
  labelPlural: UI_VIEW_LABEL_PLURAL,
  displayOrder: UI_VIEW_DISPLAY_ORDER,
  pathPrefix: UI_VIEW_PATH_PREFIX,
  dependsOn: [DESIGN_SYSTEM_TYPE],
  serializer: uiViewSerializer,
  systemPrompt: uiViewSystemPrompt,
} as EntityContribution;
