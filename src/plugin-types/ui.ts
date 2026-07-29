/**
 * `@inharness-ai/claude4spec/plugin-runtime/ui` — PUBLISHED Host UI Kit type
 * surface (M34 / L12), the sibling subpath of `./plugin-runtime`.
 *
 * Mirrors the host UI-kit barrel (`src/client/host-ui-kit/index.ts`): the four
 * `stable` Core components whose prop contracts are part of the versioned
 * `hostApiVersion` surface, plus the `experimental` components (reachable, but
 * OUTSIDE the version guarantee — their props may change without a major).
 *
 * Components are declared as `ComponentType<Props>` rather than re-exported from
 * the live client modules: the real components drag the whole internal kit tree
 * into emit, which would leak internal types (AC2). Prop shapes are the real
 * contracts. `lucide-react` (0.1.121) is a declared, externalized M33 peer (same
 * mechanism as React/Tiptap), so icon props are typed as the real `LucideIcon`
 * — a type-only import here doesn't pull runtime code into emit, and plugins
 * already share the host's one `lucide-react` instance via the import map.
 * `published-surface.test.ts` asserts the real `stable` prop interfaces stay
 * assignable to these published shapes (drift guard).
 *
 * `Tag` and `Stability` are dep-free and RE-EXPORTED from their canonical host
 * modules (single source of truth).
 */

import type { ComponentType, ReactNode, CSSProperties, FormEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

export type { Tag } from '../shared/entities.js';
export type { Stability } from '../shared/plugin-host/ui-kit-surface.js';

// ── Core (stable) — part of the versioned `hostApiVersion` surface ──
export interface DetailBreadcrumb {
  label: ReactNode;
  onClick?: () => void;
}
export interface DetailPanelShellProps {
  breadcrumb: DetailBreadcrumb[];
  actions?: ReactNode;
  children: ReactNode;
}
export declare const DetailPanelShell: ComponentType<DetailPanelShellProps>;

export interface FieldGridProps {
  children: ReactNode;
  maxWidth?: number;
}
export declare const FieldGrid: ComponentType<FieldGridProps>;

export interface FieldRowProps {
  label: ReactNode;
  children: ReactNode;
  align?: 'center' | 'start';
}
export declare const FieldRow: ComponentType<FieldRowProps>;

export interface EntityListHeaderProps {
  /** Leading icon — the same `LucideIcon` type as `EntityListRow.icon`. */
  icon?: LucideIcon;
  title: string;
  count?: number;
  search?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
}
export declare const EntityListHeader: ComponentType<EntityListHeaderProps>;

// ── List (experimental) — OUTSIDE the version guarantee ──
import type { Tag } from '../shared/entities.js';

export interface EntityListLayoutProps {
  header?: ReactNode;
  children: ReactNode;
}
export declare const EntityListLayout: ComponentType<EntityListLayoutProps>;

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}
export declare const Pagination: ComponentType<PaginationProps>;

export interface EmptyStateProps {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}
export declare const EmptyState: ComponentType<EmptyStateProps>;

export interface EntityListRowProps {
  /** General-purpose leading slot; use `icon` instead for the common plain-icon case. */
  leading?: ReactNode;
  /** Leading icon — the same `LucideIcon` type as `EntityListHeader.icon`. */
  icon?: LucideIcon;
  /** Makes the whole row a click target. Omit for rows that are editing surfaces, not links. */
  onClick?: () => void;
  /** Tag slugs to render as chips; resolved through `tagLookup`. */
  tags?: string[];
  tagLookup: Map<string, Tag>;
  trailing?: ReactNode;
  align?: 'center' | 'start';
  style?: CSSProperties;
  children: ReactNode;
}
export declare const EntityListRow: ComponentType<EntityListRowProps>;

export interface TagBarProps {
  tags: Tag[];
  tagFilter: string[];
  onTagToggle: (slug: string) => void;
  tagMode: 'and' | 'or';
  onToggleMode: () => void;
  onClear: () => void;
}
export declare const TagFilterBar: ComponentType<TagBarProps>;

// ── Actions & states (experimental) ──
export type ActionButtonVariant = 'primary' | 'secondary' | 'ghost';
export interface ActionButtonProps {
  label: ReactNode;
  /** Omit when `type="submit"` and the enclosing form's `onSubmit` already handles the action — avoids double-firing on click. */
  onClick?: () => void;
  icon?: ReactNode;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  /** Native tooltip — useful to explain a disabled state. */
  title?: string;
  /** Native button type. Defaults to `button`; set `submit` to make this the form's default action (e.g. Enter-to-submit) inside a `FormShell`. */
  type?: 'button' | 'submit';
}
export declare const ActionButton: ComponentType<ActionButtonProps>;

export type ActionBarVariant = ActionButtonVariant;
export interface ActionBarAction {
  /** Stable React key; defaults to the label. */
  key?: string;
  label: string;
  icon?: ReactNode;
  onClick(): void;
  variant?: ActionBarVariant;
  disabled?: boolean;
  /** Native tooltip — useful to explain a disabled state. */
  title?: string;
}
export interface ActionBarProps {
  /** Optional left-aligned status text. */
  status?: ReactNode;
  /** Right-aligned action buttons. */
  actions: ActionBarAction[];
}
export declare const ActionBar: ComponentType<ActionBarProps>;

export interface BadgeProps {
  label: ReactNode;
  color?: string;
  active?: boolean;
  small?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  /** Explicit text color; overrides the default active/inactive ink color. */
  foreground?: string;
  mono?: boolean;
  dot?: boolean;
  minWidth?: number;
  /** `'broken'` marks a dangling reference (red ink, ⚠ prefix). */
  variant?: 'default' | 'broken';
}
export declare const Badge: ComponentType<BadgeProps>;

export interface LoadingStateProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  lines?: number;
  className?: string;
  style?: CSSProperties;
}
export declare const LoadingState: ComponentType<LoadingStateProps>;

// ── Form (experimental) ──
export interface FormFieldProps {
  label: ReactNode;
  error?: string | null;
  children: ReactNode;
}
export declare const FormField: ComponentType<FormFieldProps>;

export interface InlineEditFieldProps {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}
export declare const InlineEditField: ComponentType<InlineEditFieldProps>;

// ── Overlay/Create (experimental) ──
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Exact panel width in px, overriding `size`. */
  width?: number;
  /**
   * Defaults to `true`. With `false` the scrim click, `Escape` and the header ✕
   * are gone — for decision gates that must not be left unresolved; the
   * consumer calls `onClose()` after an explicit action.
   */
  dismissible?: boolean;
  /** Accessible name when there is no `title` to derive one from. */
  ariaLabel?: string;
  /** Scrim stacking order; defaults to 1200. Raise it for a blocking gate. */
  zIndex?: number;
}
export declare const Dialog: ComponentType<DialogProps>;

export interface FormShellProps {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
  error?: ReactNode;
}
export declare const FormShell: ComponentType<FormShellProps>;

// ── Panel detalu (experimental, M34/L11) ──
export interface SegmentedControlTabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange(id: string): void;
}
export declare const SegmentedControlTabs: ComponentType<SegmentedControlTabsProps>;

export interface VersionHistoryItem {
  id: string;
  label: string;
  createdAt: string;
  author?: string;
  /** M13/M34: shown per-row in the `timeline` variant (kit doesn't fetch releases — author supplies it). */
  releaseLabel?: string;
  /** M13/M34: who made the change — a colour-coded badge in `timeline`, so agent edits read differently from user edits. */
  changedBy?: 'user' | 'agent' | 'filesystem';
  /** M13/M34: one-line description of what the change did. */
  summary?: string;
}
export interface VersionHistoryProps {
  versions: VersionHistoryItem[];
  activeVersion?: string;
  onSelect?(id: string): void;
  onRestore?(id: string): void;
  /** M13/M34: `'flat'` (default) keeps the existing list; `'timeline'` adds the two-column/dots layout + "Compare to". */
  variant?: 'flat' | 'timeline';
  /** M13/M34: the version currently selected as the `timeline` "Compare to" target. */
  compareVersion?: string;
  /** M13/M34: fired when a `timeline` row's "Compare to" action is used. */
  onCompare?(id: string): void;
}
export declare const VersionHistory: ComponentType<VersionHistoryProps>;

/**
 * The PUBLIC diff-line vocabulary. Deliberately NOT the host-internal
 * `LineDiffLite` shape (`{ op: 'keep'|'added'|'removed'; content }`, M17/L5) —
 * L11 speaks L12's dictionary. `lineDiffHunks()` (`@c4s/plugin-runtime`) maps
 * version snapshots into this shape.
 */
export interface DiffViewLine {
  op: 'add' | 'del' | 'ctx';
  line: string;
}
export interface DiffViewProps {
  /** Precomputed line hunks. Wins over `before`/`after` if both are given. */
  hunks?: DiffViewLine[];
  /** Pre-stringified "before" text — DiffView never serializes values itself. Only used when `hunks` is absent; requires `after` too. */
  before?: string;
  /** Pre-stringified "after" text — see `before`. */
  after?: string;
  title?: string;
  /** `'inline'` (default): one unified column. `'split'`: two columns. Only affects `hunks` rendering. */
  mode?: 'inline' | 'split';
}
export declare const DiffView: ComponentType<DiffViewProps>;

export interface EntityDetailToolbarProps {
  title: string;
  onBack?(): void;
  onDelete?(): void;
  brokenRefs?: { type: string; slug: string }[];
  busy?: boolean;
}
export declare const EntityDetailToolbar: ComponentType<EntityDetailToolbarProps>;

export type RichTextFieldToolbarItem = 'bold' | 'italic' | 'heading' | 'list' | 'table' | 'code';
export interface RichTextFieldProps {
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
  placeholder?: string;
  toolbar?: RichTextFieldToolbarItem[];
}
export declare const RichTextField: ComponentType<RichTextFieldProps>;

export interface TagPickerProps {
  allTags: { slug: string; name: string; color?: string | null }[];
  selected: string[];
  onToggle(slug: string): void;
  onCreate?(name: string): void;
  variant?: 'flat' | 'collapsed';
}
export declare const TagPicker: ComponentType<TagPickerProps>;

export interface ReferencesListItem {
  pagePath: string;
  label: string;
  anchor?: string;
}
export interface ReferencesListProps {
  references: ReferencesListItem[];
  onOpen?(ref: ReferencesListItem): void;
  loading?: boolean;
}
export declare const ReferencesList: ComponentType<ReferencesListProps>;

export interface DocumentBodyProps {
  title?: { value: string; onChange?(v: string): void; placeholder?: string };
  children: ReactNode;
  maxWidth?: number;
}
export declare const DocumentBody: ComponentType<DocumentBodyProps>;

export interface DocEditorProps {
  value: string;
  onChange(md: string): void;
  readOnly?: boolean;
  placeholder?: string;
}
export declare const DocEditor: ComponentType<DocEditorProps>;

/**
 * The catalog's first `binding: 'connected'` block: give it `type` + `slug` and
 * it fetches versions, snapshots and release labels itself, then composes
 * `EntityDetailToolbar` / `VersionHistory` / `SegmentedControlTabs` / `DiffView`.
 * It renders but does not compute — restore goes down the host's existing
 * `versionService` path, never a mutation of its own.
 */
export interface EntityVersionHistoryViewProps {
  type: string;
  slug: string;
  /** Show the restore action per row. Default `true`. */
  allowRestore?: boolean;
  /** Show the "Compare to" selection and the diff panel. Default `true`. */
  allowCompare?: boolean;
  /** Show the release-name pill (`(unreleased)` when the version has no release). Default `true`. */
  showReleasePill?: boolean;
  /** Rendered instead of the default empty state when the entity has no versions. */
  emptyState?: ReactNode;
  /** Replaces the default diff panel. */
  renderDiff?: (hunks: DiffViewLine[]) => ReactNode;
  /** Fired after a successful restore. */
  onRestored?: (versionId: string) => void;
}
export declare const EntityVersionHistoryView: ComponentType<EntityVersionHistoryViewProps>;

// ── Overlay/feedback (experimental, M34/L12) ──
export interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** Anchor element to position against. Supply this or `at`. */
  anchorRef?: { current: HTMLElement | null };
  /** Fixed viewport coordinates. Wins over `anchorRef` if both are given. */
  at?: { x: number; y: number };
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  /** 320 = create, 280 = edit, 360 = multi-step. Omitted, sizes to content. */
  width?: number;
  title?: string;
  icon?: ReactNode;
  maxHeight?: number;
  footer?: ReactNode;
}
export declare const Popover: ComponentType<PopoverProps>;

export type ToastKind = 'success' | 'error' | 'warning' | 'info';
export interface ToastViewportItem {
  id: number | string;
  kind: ToastKind;
  message: ReactNode;
  action?: ToastAction;
}
export interface ToastViewportProps {
  /** Caller-owned stack. Omitted, the viewport manages its own from `useToast()`. */
  toasts?: ToastViewportItem[];
  onDismiss?(id: number | string): void;
  onPause?(id: number | string): void;
  onResume?(id: number | string): void;
}
export declare const ToastViewport: ComponentType<ToastViewportProps>;
export interface ToastAction {
  label: string;
  onClick(): void;
}
export declare function useToast(): {
  success(message: string, action?: ToastAction): void;
  error(message: string, action?: ToastAction): void;
  warning(message: string, action?: ToastAction): void;
};

// ── Pickers (experimental, M34/L12) ──
export interface EnumBadgePickerProps {
  options: { value: string; label: string; color?: string }[];
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
}
export declare const EnumBadgePicker: ComponentType<EnumBadgePickerProps>;

export interface GroupedRelationPickerProps {
  groups: { key: string; label: string; items: { id: string; label: string; badge?: ReactNode }[] }[];
  selected: Record<string, string[]>;
  onAdd(groupKey: string, id: string): void;
  onRemove(groupKey: string, id: string): void;
  /** Query plus the group it was typed in; the widget-level search omits the key. */
  onSearch?(q: string, groupKey?: string): void;
  /** A group's link popover opened — lets the consumer load that group's candidates lazily. */
  onGroupOpen?(groupKey: string): void;
  maxHeight?: number;
}
export declare const GroupedRelationPicker: ComponentType<GroupedRelationPickerProps>;

// ── Token bridge ──
export type HostTokenName =
  | '--c-bg'
  | '--c-panel'
  | '--c-card'
  | '--c-ink'
  | '--c-muted'
  | '--c-subtle'
  | '--c-hair'
  | '--c-hair-strong'
  | '--c-accent'
  | '--c-accent-soft'
  | '--c-accent-ink'
  | '--c-yellow'
  | '--c-yellow-ink'
  | '--c-green'
  | '--c-green-soft'
  | '--c-blue'
  | '--c-blue-soft'
  | '--c-purple'
  | '--c-purple-soft'
  | '--c-red'
  | '--c-red-soft'
  | '--font-heading'
  | '--font-body'
  | '--font-mono'
  | '--text-h1'
  | '--text-h2'
  | '--text-h3'
  | '--text-body'
  | '--text-lede'
  | '--text-code'
  | '--weight-heading'
  | '--weight-body'
  | '--weight-lede'
  | '--z-popover'
  | '--z-toast';
export declare const HOST_TOKEN_NAMES: readonly HostTokenName[];
export declare function readHostTokens(): Record<HostTokenName, string>;
export declare function useHostTokens(): Record<HostTokenName, string>;

// ── Stability + binding metadata ──
export type WithStability<C> = C & {
  stability: import('../shared/plugin-host/ui-kit-surface.js').Stability;
  binding: import('../shared/plugin-host/ui-kit-surface.js').Binding;
  l11Surfaces?: readonly string[];
};
export type UiKitGroup = 'core' | 'list' | 'actions' | 'form' | 'overlay' | 'detail' | 'feedback' | 'pickers';
export interface UiKitComponentEntry {
  name: string;
  group: UiKitGroup;
  stability: import('../shared/plugin-host/ui-kit-surface.js').Stability;
  binding: import('../shared/plugin-host/ui-kit-surface.js').Binding;
  /** Which L11 surface a `connected` component consumes; absent for `presentational` ones. */
  l11Surfaces?: readonly string[];
}
export declare const UI_KIT_CATALOG: readonly UiKitComponentEntry[];
export declare const STABLE_UI_KIT_COMPONENTS: readonly string[];
