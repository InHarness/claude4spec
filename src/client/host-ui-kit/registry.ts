/**
 * M34 / L12 — the Host UI Kit catalog registry.
 *
 * Enumerates every catalog component with its `stability` tier, derived from the
 * static `stability` constant each component carries (so the registry can't
 * drift from the components). This is the single source the L11/M33 version
 * surface reads to know which prop contracts are versioned: ONLY `stable`
 * components enter `hostApiVersion` (see `shared/plugin-host/host-api.ts`).
 */

import type { Stability } from './stability.js';
import { EntityListHeader } from './core/EntityListHeader.js';
import { DetailPanelShell } from './core/DetailPanelShell.js';
import { FieldRow } from './core/FieldRow.js';
import { FieldGrid } from './core/FieldGrid.js';
import { EntityListLayout } from './list/EntityListLayout.js';
import { Pagination } from './list/Pagination.js';
import { EmptyState } from './list/EmptyState.js';
import { TagFilterBar } from './list/TagFilterBar.js';
import { EntityListRow } from './list/EntityListRow.js';
import { ActionButton } from './actions/ActionButton.js';
import { Badge } from './actions/Badge.js';
import { LoadingState } from './actions/LoadingState.js';
import { FormField } from './form/FormField.js';
import { InlineEditField } from './form/InlineEditField.js';
import { Dialog } from './overlay/Dialog.js';
import { FormShell } from './overlay/FormShell.js';
import { SegmentedControlTabs } from './detail/SegmentedControlTabs.js';
import { VersionHistory } from './detail/VersionHistory.js';
import { EntityDetailToolbar } from './detail/EntityDetailToolbar.js';
import { RichTextField } from './detail/RichTextField.js';
import { TagPicker } from './detail/TagPicker.js';
import { ReferencesList } from './detail/ReferencesList.js';
import { DocumentBody } from './detail/DocumentBody.js';
import { DocEditor } from './detail/DocEditor.js';
import { Popover } from './overlay-feedback/Popover.js';
import { ToastViewport } from './overlay-feedback/ToastViewport.js';
import { EnumBadgePicker } from './pickers/EnumBadgePicker.js';
import { GroupedRelationPicker } from './pickers/GroupedRelationPicker.js';

export type UiKitGroup =
  | 'core'
  | 'list'
  | 'actions'
  | 'form'
  | 'overlay'
  | 'detail'
  | 'feedback'
  | 'pickers';

export interface UiKitComponentEntry {
  name: string;
  group: UiKitGroup;
  stability: Stability;
}

/** Every catalog component, grouped, with its tier read off the component. */
export const UI_KIT_CATALOG: UiKitComponentEntry[] = [
  { name: 'EntityListHeader', group: 'core', stability: EntityListHeader.stability },
  { name: 'DetailPanelShell', group: 'core', stability: DetailPanelShell.stability },
  { name: 'FieldRow', group: 'core', stability: FieldRow.stability },
  { name: 'FieldGrid', group: 'core', stability: FieldGrid.stability },
  { name: 'EntityListLayout', group: 'list', stability: EntityListLayout.stability },
  { name: 'Pagination', group: 'list', stability: Pagination.stability },
  { name: 'EmptyState', group: 'list', stability: EmptyState.stability },
  { name: 'TagFilterBar', group: 'list', stability: TagFilterBar.stability },
  { name: 'EntityListRow', group: 'list', stability: EntityListRow.stability },
  { name: 'ActionButton', group: 'actions', stability: ActionButton.stability },
  { name: 'Badge', group: 'actions', stability: Badge.stability },
  { name: 'LoadingState', group: 'actions', stability: LoadingState.stability },
  { name: 'FormField', group: 'form', stability: FormField.stability },
  { name: 'InlineEditField', group: 'form', stability: InlineEditField.stability },
  { name: 'Dialog', group: 'overlay', stability: Dialog.stability },
  { name: 'FormShell', group: 'overlay', stability: FormShell.stability },
  { name: 'SegmentedControlTabs', group: 'detail', stability: SegmentedControlTabs.stability },
  { name: 'VersionHistory', group: 'detail', stability: VersionHistory.stability },
  { name: 'EntityDetailToolbar', group: 'detail', stability: EntityDetailToolbar.stability },
  { name: 'RichTextField', group: 'detail', stability: RichTextField.stability },
  { name: 'TagPicker', group: 'detail', stability: TagPicker.stability },
  { name: 'ReferencesList', group: 'detail', stability: ReferencesList.stability },
  { name: 'DocumentBody', group: 'detail', stability: DocumentBody.stability },
  { name: 'DocEditor', group: 'detail', stability: DocEditor.stability },
  { name: 'Popover', group: 'feedback', stability: Popover.stability },
  { name: 'ToastViewport', group: 'feedback', stability: ToastViewport.stability },
  { name: 'EnumBadgePicker', group: 'pickers', stability: EnumBadgePicker.stability },
  { name: 'GroupedRelationPicker', group: 'pickers', stability: GroupedRelationPicker.stability },
];

/**
 * Names of the components whose prop contracts are part of the versioned
 * `hostApiVersion` surface — the `stable` tier only. A breaking prop-shape
 * change to any of these requires a major `hostApiVersion` bump + a
 * `migrations[]` descriptor (see `host-api.ts`). `experimental` components are
 * deliberately excluded.
 */
export const STABLE_UI_KIT_COMPONENTS: string[] = UI_KIT_CATALOG.filter(
  (c) => c.stability === 'stable',
).map((c) => c.name);
