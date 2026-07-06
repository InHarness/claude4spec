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
 * the live client modules: the real components drag `lucide-react` and the whole
 * internal kit tree into emit, which would leak internal types (AC2). Prop
 * shapes are the real contracts; the only deliberate loosening is icon props
 * (`ComponentType<{ size? }>` instead of `LucideIcon`) so plugins need not
 * depend on `lucide-react`. `published-surface.test.ts` asserts the real `stable`
 * prop interfaces stay assignable to these published shapes (drift guard).
 *
 * `Tag` and `Stability` are dep-free and RE-EXPORTED from their canonical host
 * modules (single source of truth).
 */

import type { ComponentType, ReactNode, CSSProperties, FormEvent } from 'react';

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
  /** Lucide-style icon component; loosely typed to avoid a `lucide-react` dep. */
  icon?: ComponentType<{ size?: number | string }>;
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
  leading: ReactNode;
  onClick: () => void;
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
  onClick: () => void;
  icon?: ReactNode;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  title?: string;
}
export declare const ActionButton: ComponentType<ActionButtonProps>;

export interface BadgeProps {
  label: ReactNode;
  color?: string;
  active?: boolean;
  small?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
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
}
export interface VersionHistoryProps {
  versions: VersionHistoryItem[];
  activeVersion?: string;
  onSelect?(id: string): void;
  onRestore?(id: string): void;
}
export declare const VersionHistory: ComponentType<VersionHistoryProps>;

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

// ── Overlay/feedback (experimental, M34/L12) ──
export interface PopoverProps {
  open: boolean;
  onClose(): void;
  anchorRef: { current: HTMLElement | null };
  placement?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}
export declare const Popover: ComponentType<PopoverProps>;
export declare const ToastViewport: ComponentType<Record<string, never>>;
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
  onSearch?(q: string): void;
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

// ── Stability metadata ──
export type WithStability<C> = C & { stability: import('../shared/plugin-host/ui-kit-surface.js').Stability };
export type UiKitGroup = 'core' | 'list' | 'actions' | 'form' | 'overlay' | 'detail' | 'feedback' | 'pickers';
export interface UiKitComponentEntry {
  name: string;
  group: UiKitGroup;
  stability: import('../shared/plugin-host/ui-kit-surface.js').Stability;
}
export declare const UI_KIT_CATALOG: readonly UiKitComponentEntry[];
export declare const STABLE_UI_KIT_COMPONENTS: readonly string[];
