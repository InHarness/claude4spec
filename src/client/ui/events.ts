import type {
  DtoCreateInput,
  EndpointCreateInput,
  EntityType,
  HttpMethod,
  TagCreateInput,
} from '../../shared/entities.js';
import type { GitErrorRecovery } from '../../shared/git.js';
import type { PageRefSyntax } from '../tiptap/extensions/PageRefNode.js';

// ---------- Toasts ----------

/**
 * 0.2.110 M50: the toast's severity is its `variant` (a toast has no `kind` —
 * `kind` names a window in the registry). `info` stays renderable for the host's
 * own `toast.info()`.
 */
export type ToastVariant = 'success' | 'error' | 'warning' | 'info';
/** @deprecated 0.2.110 — renamed to `ToastVariant`. */
export type ToastKind = ToastVariant;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
}

export interface ToastRequest extends ToastOptions {
  variant: ToastVariant;
  message: string;
}

const TOAST_EVENT = 'c4s:toast';

function fireToast(variant: ToastVariant, message: string, options?: ToastOptions): void {
  const detail: ToastRequest = { variant, message, ...options };
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
  /**
   * 0.2.113: runs on [Confirm] while the dialog stays open. Resolving `false`
   * keeps it open (the action was refused — e.g. `409 PROJECT_BUSY`, reported by
   * the callback itself); `true` closes it and settles the confirm as confirmed.
   */
  action?: () => Promise<boolean>;
}

/**
 * 0.2.110 M50 — every destructive confirm is a named window. Host kinds are
 * listed; a plugin passes its own `<type>-delete` / `dto-example-delete` etc.
 */
export type ConfirmKind =
  | 'thread-delete'
  | 'page-overwrite'
  | 'brief-reload'
  | 'release-restore'
  | 'entity-delete'
  | 'remote-project-disconnect'
  | 'project-detach'
  | 'project-purge'
  | 'account-logout'
  | 'agent-credential-remove'
  | (string & {});

export interface ConfirmRequest extends ConfirmInput {
  kind: ConfirmKind;
  danger: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const CONFIRM_EVENT = 'c4s:confirm-open';

export function confirmDestructive(kind: ConfirmKind, input: ConfirmInput): Promise<boolean> {
  return new Promise((resolve) => {
    const detail: ConfirmRequest = {
      ...input,
      kind,
      danger: input.danger ?? true,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    };
    window.dispatchEvent(new CustomEvent<ConfirmRequest>(CONFIRM_EVENT, { detail }));
  });
}

// ---------- Git error recovery ----------

/**
 * 0.1.124: a `gitSync.status === 'error'` result opens a persistent recovery
 * window with a "Fix it with Agent" action instead of a fire-and-forget toast.
 * 0.2.110: that window is the `git-sync-recover` modal kind.
 */
export function showGitErrorModal(recovery: GitErrorRecovery): void {
  void openModal('git-sync-recover', { recovery });
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

/**
 * `title` and `caption` are two different facts, not one field spelled twice.
 *
 * `title` belongs to the ENTITY — it is the label every chip and row shows, and
 * it seeds the slug. `caption` belongs to THIS EMBEDDING and is written as an
 * attribute of the reference tag, so one diagram referenced on two pages may be
 * captioned differently on each. Until 0.2.22 `caption` did both jobs, which is
 * how the diagram type ended up as the only one with no name of its own.
 */
export interface DiagramInitial {
  format: string;
  title: string;
  caption: string;
  source: string;
}
export type DiagramResult =
  | { format: string; title: string; caption: string; source: string }
  | { __action: 'remove' };

/** A window with no props of its own (the position is not a prop). */
export type NoProps = Record<never, never>;

export type PopoverMap = {
  'new-page': { props: NoProps; result: NewPageResult };
  'create-tag': { props: { contextLabel?: string }; result: TagCreateInput };
  mention: { props: NoProps; result: MentionResult };
  element: { props: NoProps; result: ElementResult };
  list: { props: NoProps; result: ListResult };
  tagged: { props: NoProps; result: TaggedResult };
  'tagged-mixed': { props: NoProps; result: TaggedMixedResult };
  'page-ref': {
    props: { syntax: PageRefSyntax; path: string; anchor?: string; label?: string; onRemove: () => void };
    result: { syntax: PageRefSyntax; path: string; anchor: string; label: string };
  };
  'page-ref-broken': {
    props: { rootId: string; candidatePath: string | null };
    result: { action: 'fix' } | { action: 'created'; path: string };
  };
  'todo-create': { props: NoProps; result: { comment: string } };
  'todo-edit': { props: { initialComment: string; onRemove: () => void }; result: { comment: string } };
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
    /**
     * `captionEditable` is false where the card has no reference node behind it
     * — a chat tool result, say. The caption lives on the reference, so with
     * nowhere to write it the field would take input and drop it; hiding it is
     * the honest surface. Defaults to true (the editor's own cards).
     */
    props: { mode: 'create' | 'edit'; initial?: DiagramInitial; captionEditable?: boolean };
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
  onSubmit: (result: PopoverResult<K>) => void;
  onCancel: () => void;
}

const POPOVER_EVENT = 'c4s:popover-open';

/** 0.2.110 M50: `openPopover(kind, { x, y, ...props })` — position and props in one object. */
export function openPopover<K extends PopoverKind>(
  kind: K,
  input: PopoverPosition & PopoverProps<K>,
): Promise<PopoverResult<K> | null> {
  return new Promise((resolve) => {
    const { x, y, ...props } = input;
    const detail: PopoverRequest<K> = {
      kind,
      x,
      y,
      props: props as unknown as PopoverProps<K>,
      onSubmit: (result) => resolve(result),
      onCancel: () => resolve(null),
    };
    window.dispatchEvent(new CustomEvent<PopoverRequest<K>>(POPOVER_EVENT, { detail }));
  });
}

// ---------- Modals ----------

/** One tool call in the `tool-json-view` window (a batch shows several). */
export interface ToolJsonItem {
  toolName: string;
  input: unknown;
  result: unknown;
  isError: boolean;
}

/**
 * 0.2.110 M50 — the non-destructive `Dialog` window. Each `kind` names one
 * window; its props and result are declared here. `<ModalHost/>` renders the
 * host kinds from `ui/modals/registry.tsx`; a `<type>-expand` kind resolves to
 * that entity type's own `renderOverlay` slot, so the host names no type.
 */
export type ModalMap = {
  'tool-json-view': { props: { title: string; items: ToolJsonItem[] }; result: void };
  'git-sync-recover': { props: { recovery: GitErrorRecovery }; result: void };
  'project-create': { props: NoProps; result: { id: string } };
  'page-resolve': {
    props: { rootId: string; path: string; currentHash?: string; currentContent?: string };
    result: 'reload' | 'keep';
  };
  'page-reload': { props: { rootId: string; path: string }; result: 'reload' | 'keep' };
  'onboarding-skip': { props: NoProps; result: true };
  'release-push': { props: { releaseId: number; projectName: string }; result: true };
  /** M33 — opened with `dismissible: false`: only its two buttons close it. */
  'project-plugins-trust': {
    props: { packages: Array<{ package: string; origin?: string; layer?: string }> };
    result: true;
  };
  /** `<type>-expand` for hidden entity types (diagram, spreadsheet, code-snippet…). */
  [expand: `${string}-expand`]: {
    /** Extra props (e.g. an `entity` the opener already holds) pass through to the overlay. */
    props: { slug: string; caption?: string; [extra: string]: unknown };
    result: void;
  };
};

export type ModalKind = keyof ModalMap & string;
export type ModalProps<K extends ModalKind> = ModalMap[K]['props'];
export type ModalResult<K extends ModalKind> = ModalMap[K]['result'];

export interface ModalRequest<K extends ModalKind = ModalKind> {
  kind: K;
  props: ModalProps<K>;
  /** `false` = trust-gate style: Esc / click-outside / ✕ do not close it. */
  dismissible?: boolean;
  onSubmit: (result: ModalResult<K>) => void;
  onCancel: () => void;
}

const MODAL_EVENT = 'c4s:modal-open';

export function openModal<K extends ModalKind>(
  kind: K,
  props: ModalProps<K>,
  options?: { dismissible?: boolean },
): Promise<ModalResult<K> | null> {
  return new Promise((resolve) => {
    const detail: ModalRequest<K> = {
      kind,
      props,
      ...(options?.dismissible === false ? { dismissible: false } : {}),
      onSubmit: (result) => resolve(result),
      onCancel: () => resolve(null),
    };
    window.dispatchEvent(new CustomEvent<ModalRequest<K>>(MODAL_EVENT, { detail }));
  });
}

// ---------- Entity expand (hidden types) ----------

/**
 * The click target of a hidden entity's chip or card.
 *
 * A hidden type (`diagram`, `spreadsheet`, `code-snippet` — types declaring
 * neither `routes` nor `detailPanel`) has no detail route, so
 * `editorBridge.openEntity` has nowhere to send the user. It opens the
 * `<type>-expand` modal instead: read-only, rendered by the type's own
 * `renderOverlay` slot, resolved through the client plugin host.
 *
 * 0.2.110: a modal kind rather than the old `c4s:entity-overlay-open` event —
 * these chips also render in the chat pipeline and in read-only viewers, where
 * no editor bridge exists; the window bus is the surface all three share.
 */
export interface EntityOverlayRequest {
  type: string;
  slug: string;
  caption?: string;
}

export function openEntityOverlay(request: EntityOverlayRequest): void {
  void openModal(`${request.type}-expand`, {
    slug: request.slug,
    ...(request.caption ? { caption: request.caption } : {}),
  });
}

export const UI_EVENTS = {
  TOAST: TOAST_EVENT,
  CONFIRM: CONFIRM_EVENT,
  POPOVER: POPOVER_EVENT,
  MODAL: MODAL_EVENT,
} as const;

/*
 * 0.2.11: `ENTITY_TYPES` is gone from here.
 *
 * It listed three types, and its only consumers were the four XML-chip popovers'
 * <option> lists -- so an author could insert a chip for `endpoint`, `dto` or
 * `database-table` and for nothing else. `ui-view`, `ac`, `design-system`,
 * `diagram` and every plugin type were unreachable from the editor, not by
 * decision but because this constant had never been extended.
 *
 * The popovers now read `listActiveEntityTypes()` from the entity registry.
 */
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
