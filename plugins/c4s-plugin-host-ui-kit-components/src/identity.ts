/**
 * Every constant both halves of this envelope agree on.
 *
 * `.ts`, not `.tsx`, and free of React: the Node loader reaches this file from
 * `src/index.ts`, and the frontend imports the same names from the same place,
 * so the two halves cannot drift on a type name, a path prefix or the group
 * order (c4s-plugin-host-ui-kit-components `spf7qirh`, `8kvfhgsj`, `ctpko3bp`).
 */

/** The entity type name — one record per export of `@c4s/plugin-runtime/ui`. */
export const UI_KIT_COMPONENT_TYPE = 'ui-kit-component';

/**
 * The REST prefix, mounted under `/api` by the host — `/api/ui-kit-components`
 * (`spf7qirh`). Like every envelope, the declared prefix omits the `/api`
 * segment the host adds; it doubles as the client-side route prefix.
 */
export const UI_KIT_COMPONENT_PATH_PREFIX = '/ui-kit-components';

/** The manifest labels (2.1.30), English like every user-visible label of this host. */
export const UI_KIT_COMPONENT_LABEL = 'UI Kit Component';
export const UI_KIT_COMPONENT_LABEL_PLURAL = 'UI Kit Components';

/**
 * The ELEMENTS tab's `sidebarTab.order` (2.1.30): 110 — the type joined the
 * section as one of the last, after every existing tab (the highest,
 * `database-table`, is 100).
 */
export const UI_KIT_COMPONENT_SIDEBAR_ORDER = 110;

/**
 * The `group` enum, in order. The order is the order of the groups on the
 * type's own list screen (`8kvfhgsj`, `ctpko3bp`).
 */
export const UI_KIT_GROUPS = ['core', 'list', 'actions', 'form', 'overlay', 'detail', 'feedback', 'pickers'] as const;
export type UiKitGroup = (typeof UI_KIT_GROUPS)[number];

export const UI_KIT_STABILITIES = ['stable', 'experimental'] as const;
export type UiKitStability = (typeof UI_KIT_STABILITIES)[number];

export const UI_KIT_BINDINGS = ['presentational', 'connected'] as const;
export type UiKitBinding = (typeof UI_KIT_BINDINGS)[number];

/** `dataSources[].usage` — only `fetchedByComponent` names an L11 surface the component consumes. */
export const UI_KIT_DATA_SOURCE_USAGES = ['fetchedByComponent', 'feedsProps'] as const;
export type UiKitDataSourceUsage = (typeof UI_KIT_DATA_SOURCE_USAGES)[number];

/** `payloadVersion: 1` (2.1.30) — the initial shape, empty changelog, empty `payloadUpgrades` chain. */
export const UI_KIT_COMPONENT_PAYLOAD_VERSION = 1;

/** The MCP server and its one tool (`6o1rfh21`). */
export const UI_KIT_TOOLS_SERVER = 'ui-kit-component-tools';
export const UI_KIT_AUDIT_TOOL = 'audit_ui_kit_components';
