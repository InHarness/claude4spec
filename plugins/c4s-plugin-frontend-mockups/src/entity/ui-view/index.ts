import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import {
  DESIGN_SYSTEM_TYPE,
  UI_VIEW_DISPLAY_ORDER,
  UI_VIEW_LABEL,
  UI_VIEW_LABEL_PLURAL,
  UI_VIEW_PATH_PREFIX,
  UI_VIEW_TYPE,
} from '../../identity.js';
import { uiViewSerialization } from './serializer.js';
import { uiViewSystemPrompt } from './system-prompt.js';
import { uiViewData, uiViewSlugPattern } from './schema.js';
import { uiViewMockupRouter } from './backend/routes.js';
import type { MockupMountContext } from '../../host-kit/host-types.js';

/**
 * The `ui-view` contribution — the generated `/api/ui-views` router still serves
 * every CRUD verb from `data` below; `backend.routes` adds the one path that is
 * NOT CRUD in disguise.
 *
 * 0.2.28: this type contributed no routes at all until the mockup document
 * (`GET /:slug/mockup`) arrived. The router carries no prefix of its own — it
 * inherits `pathPrefix` — so the transport address is
 * `/api/projects/:id/ui-views/:slug/mockup`. See `backend/routes.ts` for why a
 * declared route rather than a host-derived one, and for the isolation header
 * that makes serving agent-authored HTML from our own origin defensible.
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
  // 1 — initial; 2 — `name` gives way to the reserved `title`; 3 — `mockupHtml`
  // arrives as a content-bearing field; 4 — `states[]` arrives, empty.
  payloadVersion: 4,
  label: UI_VIEW_LABEL,
  labelPlural: UI_VIEW_LABEL_PLURAL,
  displayOrder: UI_VIEW_DISPLAY_ORDER,
  pathPrefix: UI_VIEW_PATH_PREFIX,
  dependsOn: [DESIGN_SYSTEM_TYPE],
  ...uiViewSerialization,
  systemPrompt: uiViewSystemPrompt,
  backend: {
    // `_service` is this TYPE's service, and `ui-view` has none. The design
    // system's generator is fetched from the host per request instead — see
    // `uiViewMockupRouter`.
    routes: {
      router: (_service: unknown, ctx: MountContext) =>
        uiViewMockupRouter(ctx as unknown as MockupMountContext),
    },
  },
} as EntityContribution;
