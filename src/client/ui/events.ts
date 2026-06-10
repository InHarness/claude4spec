import type {
  AcCreateInput,
  DtoCreateInput,
  EndpointCreateInput,
  EntityType,
  HttpMethod,
  TagCreateInput,
} from '../../shared/entities.js';

// ---------- Toasts ----------

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
}

export interface ToastRequest extends ToastOptions {
  kind: ToastKind;
  message: string;
}

const TOAST_EVENT = 'c4s:toast';

function fireToast(kind: ToastKind, message: string, options?: ToastOptions): void {
  const detail: ToastRequest = { kind, message, ...options };
  window.dispatchEvent(new CustomEvent<ToastRequest>(TOAST_EVENT, { detail }));
}

export const toast = {
  success: (message: string, options?: ToastOptions) => fireToast('success', message, options),
  error: (message: string, options?: ToastOptions) => fireToast('error', message, options),
  warning: (message: string, options?: ToastOptions) => fireToast('warning', message, options),
  info: (message: string, options?: ToastOptions) => fireToast('info', message, options),
};

// ---------- Confirm modal ----------

export interface ConfirmInput {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /**
   * Type-to-confirm: when set, the modal renders a text input and keeps the
   * confirm button disabled until the user types this string exactly.
   */
  requireText?: string;
}

export interface ConfirmRequest extends ConfirmInput {
  resolve: (confirmed: boolean) => void;
}

const CONFIRM_EVENT = 'c4s:confirm-open';

export function confirmDestructive(input: ConfirmInput): Promise<boolean> {
  return new Promise((resolve) => {
    const detail: ConfirmRequest = { ...input, resolve };
    window.dispatchEvent(new CustomEvent<ConfirmRequest>(CONFIRM_EVENT, { detail }));
  });
}

// ---------- Popovers ----------

export type PopoverPosition = { x: number; y: number };

export type ChipNodeType =
  | 'inline_mention'
  | 'single_element'
  | 'element_list'
  | 'tagged_list'
  | 'tagged_list_mixed';

export interface MentionResult {
  type: EntityType;
  slug: string;
}
export interface ElementResult {
  type: EntityType;
  slug: string;
}
export interface ListResult {
  type: EntityType;
  slugs: string[];
}
export interface TaggedResult {
  type: EntityType;
  tags: string[];
  filter: 'and' | 'or';
}
export interface TaggedMixedResult {
  tags: string[];
  filter: 'and' | 'or';
}
export interface NewPageResult {
  path: string;
}
export interface SectionResult {
  anchor: string;
}
export type EditChipAttrs = Record<string, unknown>;

export interface DiagramInitial {
  format: string;
  caption: string;
  source: string;
}
export type DiagramResult =
  | { format: string; caption: string; source: string }
  | { __action: 'remove' };

export type PopoverMap = {
  'new-page': { props: Record<string, never>; result: NewPageResult };
  'create-endpoint': { props: Record<string, never>; result: EndpointCreateInput };
  'create-dto': { props: Record<string, never>; result: DtoCreateInput };
  'create-ac': { props: { defaultTags?: string[] }; result: AcCreateInput };
  'create-tag': { props: { contextLabel?: string }; result: TagCreateInput };
  mention: { props: Record<string, never>; result: MentionResult };
  element: { props: Record<string, never>; result: ElementResult };
  list: { props: Record<string, never>; result: ListResult };
  tagged: { props: Record<string, never>; result: TaggedResult };
  'tagged-mixed': { props: Record<string, never>; result: TaggedMixedResult };
  section: {
    props: { initialAnchor?: string; onRemove?: () => void };
    result: SectionResult | { __action: 'remove' };
  };
  'edit-chip': {
    props: {
      nodeType: ChipNodeType;
      attrs: EditChipAttrs;
      onRemove: () => void;
    };
    result: EditChipAttrs;
  };
  diagram: {
    props: { mode: 'create' | 'edit'; initial?: DiagramInitial };
    result: DiagramResult;
  };
};

export type PopoverKind = keyof PopoverMap;
export type PopoverProps<K extends PopoverKind> = PopoverMap[K]['props'];
export type PopoverResult<K extends PopoverKind> = PopoverMap[K]['result'];

export interface PopoverRequest<K extends PopoverKind = PopoverKind> {
  kind: K;
  x: number;
  y: number;
  props: PopoverProps<K>;
  resolve: (result: PopoverResult<K> | null) => void;
}

const POPOVER_EVENT = 'c4s:popover-open';

export function openPopover<K extends PopoverKind>(
  kind: K,
  position: PopoverPosition,
  props: PopoverProps<K>,
): Promise<PopoverResult<K> | null> {
  return new Promise((resolve) => {
    const detail: PopoverRequest<K> = { kind, x: position.x, y: position.y, props, resolve };
    window.dispatchEvent(new CustomEvent<PopoverRequest<K>>(POPOVER_EVENT, { detail }));
  });
}

export const UI_EVENTS = {
  TOAST: TOAST_EVENT,
  CONFIRM: CONFIRM_EVENT,
  POPOVER: POPOVER_EVENT,
} as const;

export const ENTITY_TYPES: readonly EntityType[] = ['endpoint', 'dto', 'database-table'];
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
