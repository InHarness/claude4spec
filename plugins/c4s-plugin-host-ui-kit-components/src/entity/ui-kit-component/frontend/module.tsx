import type { FrontendModule } from '@c4s/plugin-runtime';
import {
  UI_KIT_COMPONENT_LABEL,
  UI_KIT_COMPONENT_PAYLOAD_VERSION,
  UI_KIT_COMPONENT_LABEL_PLURAL,
  UI_KIT_COMPONENT_PATH_PREFIX,
  UI_KIT_COMPONENT_SIDEBAR_ORDER,
  UI_KIT_COMPONENT_TYPE,
} from '../../../identity.js';
import { uiKitComponentData, uiKitComponentSlugPattern } from '../schema.js';
import { uiKitComponentsApi } from './api.js';
import { useGetBySlug } from './hooks.js';
import { UiKitComponentCard, UiKitComponentChip, UiKitComponentIcon, UiKitComponentRow } from './render.js';
import { UiKitComponentDetail } from './detail-panel.js';
import { uiKitComponentRoutes } from './routes.js';

/**
 * The VISIBLE type's frontend module (c4s-plugin-host-ui-kit-components
 * `ctpko3bp`): `renderChip`, `renderCard`, `renderRow`, `routes` +
 * `detailPanel`, and an ELEMENTS `sidebarTab` with the UI-block icon (the host
 * draws the record counter next to it). No `editorExtensions` — the package
 * contributes no slash command (`rmv46zlc`).
 */
export const uiKitComponentFrontendModule: FrontendModule = {
  type: UI_KIT_COMPONENT_TYPE,
  data: uiKitComponentData,
  slugPattern: uiKitComponentSlugPattern,
  // The same constant the backend contribution declares; the frontend must not import the backend graph.
  payloadVersion: UI_KIT_COMPONENT_PAYLOAD_VERSION,
  label: UI_KIT_COMPONENT_LABEL,
  labelPlural: UI_KIT_COMPONENT_LABEL_PLURAL,
  pathPrefix: UI_KIT_COMPONENT_PATH_PREFIX,
  renderChip: UiKitComponentChip as FrontendModule['renderChip'],
  renderCard: UiKitComponentCard as FrontendModule['renderCard'],
  renderRow: UiKitComponentRow as FrontendModule['renderRow'],
  detailPanel: UiKitComponentDetail,
  useGetBySlug: ((slug: string | null) => useGetBySlug(slug)) as unknown as FrontendModule['useGetBySlug'],
  listByTags: ({ tags, filter }) => uiKitComponentsApi.list({ tags, tagFilter: filter }),
  routes: uiKitComponentRoutes,
  sidebarTab: {
    icon: UiKitComponentIcon,
    label: UI_KIT_COMPONENT_LABEL_PLURAL,
    order: UI_KIT_COMPONENT_SIDEBAR_ORDER,
  },
};
