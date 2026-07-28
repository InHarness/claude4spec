/**
 * M34 / L12 — the Host UI Kit catalog registry.
 *
 * Enumerates every catalog component with its `stability` tier and `binding`
 * class, both derived from the static constants each component carries (so the
 * registry can't drift from the components). This is the single source the L11/M33 version
 * surface reads to know which prop contracts are versioned: ONLY `stable`
 * components enter `hostApiVersion` (see `shared/plugin-host/host-api.ts`).
 */

import type { Binding, Stability } from './stability.js';
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
import { DiffView } from './detail/DiffView.js';
import { EntityDetailToolbar } from './detail/EntityDetailToolbar.js';
import { RichTextField } from './detail/RichTextField.js';
import { TagPicker } from './detail/TagPicker.js';
import { ReferencesList } from './detail/ReferencesList.js';
import { DocumentBody } from './detail/DocumentBody.js';
import { DocEditor } from './detail/DocEditor.js';
import { EntityVersionHistoryView } from './detail/EntityVersionHistoryView.js';
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
  binding: Binding;
  /**
   * The L11 surface a `connected` component consumes (services / hooks /
   * singletons). Mandatory in practice for `connected` entries — a `connected`
   * component that names nothing is undeclared host access. Absent for
   * `presentational` ones, which reach nothing.
   */
  l11Surfaces?: readonly string[];
}

/** Catalog metadata as each component declares it (see `withStability`). */
type CatalogConstants = Pick<UiKitComponentEntry, 'stability' | 'binding' | 'l11Surfaces'>;

/** Build one entry, reading the constants OFF the component so they can't drift. */
const entry = (name: string, group: UiKitGroup, c: CatalogConstants): UiKitComponentEntry => ({
  name,
  group,
  stability: c.stability,
  binding: c.binding,
  ...(c.l11Surfaces ? { l11Surfaces: c.l11Surfaces } : {}),
});

/** Every catalog component, grouped, with its constants read off the component. */
export const UI_KIT_CATALOG: UiKitComponentEntry[] = [
  entry('EntityListHeader', 'core', EntityListHeader),
  entry('DetailPanelShell', 'core', DetailPanelShell),
  entry('FieldRow', 'core', FieldRow),
  entry('FieldGrid', 'core', FieldGrid),
  entry('EntityListLayout', 'list', EntityListLayout),
  entry('Pagination', 'list', Pagination),
  entry('EmptyState', 'list', EmptyState),
  entry('TagFilterBar', 'list', TagFilterBar),
  entry('EntityListRow', 'list', EntityListRow),
  entry('ActionButton', 'actions', ActionButton),
  entry('Badge', 'actions', Badge),
  entry('LoadingState', 'actions', LoadingState),
  entry('FormField', 'form', FormField),
  entry('InlineEditField', 'form', InlineEditField),
  entry('Dialog', 'overlay', Dialog),
  entry('FormShell', 'overlay', FormShell),
  entry('SegmentedControlTabs', 'detail', SegmentedControlTabs),
  entry('VersionHistory', 'detail', VersionHistory),
  entry('DiffView', 'detail', DiffView),
  entry('EntityDetailToolbar', 'detail', EntityDetailToolbar),
  entry('RichTextField', 'detail', RichTextField),
  entry('TagPicker', 'detail', TagPicker),
  entry('ReferencesList', 'detail', ReferencesList),
  entry('DocumentBody', 'detail', DocumentBody),
  entry('DocEditor', 'detail', DocEditor),
  entry('EntityVersionHistoryView', 'detail', EntityVersionHistoryView),
  entry('Popover', 'feedback', Popover),
  entry('ToastViewport', 'feedback', ToastViewport),
  entry('EnumBadgePicker', 'pickers', EnumBadgePicker),
  entry('GroupedRelationPicker', 'pickers', GroupedRelationPicker),
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
