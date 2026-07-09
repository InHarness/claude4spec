/**
 * M34 / L12 — Host UI Kit catalog barrel.
 *
 * The presentational component catalog the host exposes to runtime plugins. It
 * is re-exported as `@c4s/plugin-runtime/ui` (a subpath distinct from the live
 * singletons of `@c4s/plugin-runtime`) via `runtime/plugin-runtime-ui.ts`, and
 * delivered to plugins through the M33 import-map shim — so the subpath resolves
 * to ONE host UI bundle, not a per-plugin copy.
 *
 * Every component is pure-presentational — props-in, no live host services
 * (no `useQueryClient()`, no fetch, no EditorBridge singleton) — and carries a
 * mandatory `stability` constant. A local, self-contained editor instance
 * (e.g. `RichTextField`'s Tiptap usage) is still pure-presentational in this
 * sense: it touches no host service, only `value`/`onChange` props. `DocEditor`
 * is the one documented exception (see its own docblock). Only `stable`
 * components are part of the versioned `hostApiVersion` surface.
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

// Panel detalu (experimental)
export {
  SegmentedControlTabs,
  type SegmentedControlTabsProps,
} from './detail/SegmentedControlTabs.js';
export { VersionHistory, type VersionHistoryProps, type VersionHistoryItem } from './detail/VersionHistory.js';
export { DiffView, type DiffViewProps } from './detail/DiffView.js';
export { EntityDetailToolbar, type EntityDetailToolbarProps } from './detail/EntityDetailToolbar.js';
export {
  RichTextField,
  type RichTextFieldProps,
  type RichTextFieldToolbarItem,
} from './detail/RichTextField.js';
export { TagPicker, type TagPickerProps } from './detail/TagPicker.js';
export {
  ReferencesList,
  type ReferencesListProps,
  type ReferencesListItem,
} from './detail/ReferencesList.js';
export { DocumentBody, type DocumentBodyProps } from './detail/DocumentBody.js';
export { DocEditor, type DocEditorProps } from './detail/DocEditor.js';

// Overlay/feedback (experimental)
export { Popover, type PopoverProps } from './overlay-feedback/Popover.js';
export { ToastViewport } from './overlay-feedback/ToastViewport.js';
export { useToast } from './overlay-feedback/useToast.js';

// Pickers (experimental)
export { EnumBadgePicker, type EnumBadgePickerProps } from './pickers/EnumBadgePicker.js';
export {
  GroupedRelationPicker,
  type GroupedRelationPickerProps,
} from './pickers/GroupedRelationPicker.js';

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
