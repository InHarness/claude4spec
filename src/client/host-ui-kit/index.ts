/**
 * M34 / L12 — Host UI Kit catalog barrel.
 *
 * The presentational component catalog the host exposes to runtime plugins. It
 * is re-exported as `@c4s/plugin-runtime/ui` (a subpath distinct from the live
 * singletons of `@c4s/plugin-runtime`) via `runtime/plugin-runtime-ui.ts`, and
 * delivered to plugins through the M33 import-map shim — so the subpath resolves
 * to ONE host UI bundle, not a per-plugin copy.
 *
 * Every component is pure-presentational (props-in, no `useEditor()`/`useQuery()`
 * /fetch) and carries a mandatory `stability` constant. Only `stable` components
 * are part of the versioned `hostApiVersion` surface.
 */

// Core (stable)
export { EntityListHeader, type EntityListHeaderProps } from './core/EntityListHeader.js';
export {
  DetailPanelShell,
  type DetailPanelShellProps,
  type DetailBreadcrumb,
} from './core/DetailPanelShell.js';
export { FieldRow, type FieldRowProps } from './core/FieldRow.js';
export { FieldGrid, type FieldGridProps } from './core/FieldGrid.js';

// List (experimental)
export { EntityListLayout, type EntityListLayoutProps } from './list/EntityListLayout.js';
export { Pagination, type PaginationProps } from './list/Pagination.js';
export { EmptyState, type EmptyStateProps } from './list/EmptyState.js';
export { TagFilterBar, type TagBarProps } from './list/TagFilterBar.js';
export { EntityListRow, type EntityListRowProps } from './list/EntityListRow.js';

// Actions & states (experimental)
export { ActionButton, type ActionButtonProps, type ActionButtonVariant } from './actions/ActionButton.js';
export { Badge, type BadgeProps } from './actions/Badge.js';
export { LoadingState, type LoadingStateProps } from './actions/LoadingState.js';

// Form (experimental)
export { FormField, type FormFieldProps } from './form/FormField.js';
export { InlineEditField, type InlineEditFieldProps } from './form/InlineEditField.js';

// Overlay/Create (experimental)
export { Dialog, type DialogProps } from './overlay/Dialog.js';
export { FormShell, type FormShellProps } from './overlay/FormShell.js';

// Token bridge
export { useHostTokens } from './useHostTokens.js';
export { HOST_TOKEN_NAMES, readHostTokens, type HostTokenName } from './tokens.js';

// Stability metadata
export { type Stability, type WithStability } from './stability.js';
export {
  UI_KIT_CATALOG,
  STABLE_UI_KIT_COMPONENTS,
  type UiKitGroup,
  type UiKitComponentEntry,
} from './registry.js';
