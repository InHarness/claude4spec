import type { AnyExtension, Editor } from '@tiptap/core';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { Annotation } from '../../shared/entities.js';
import type { SlashCommand } from './extensions/SlashMenu.js';

export interface RegistryContext {
  qc: QueryClient;
  currentPath: string | null;
  onSlashInvoke: (editor: Editor, command: SlashCommand) => void;
  getAnnotations: () => Annotation[];
  /** Context in which the extension is being instantiated. Set by EditorFactory. */
  contextId?: EditorContextId;
  /**
   * 0.1.96: per-root behaviour props of the page's root. Set by EditorFactory.
   * Factory extensions (e.g. the `@` mention framework) may read
   * `rootProps.linkTargets` to scope their link/autocomplete targets.
   */
  rootProps?: RootEditorProps;
}

/**
 * 0.1.96: the subset of a `Root`'s behaviour flags that gate which editor
 * extensions mount. Mirrors the three gating fields of the shared `Root` type
 * (kept structurally local so this client module doesn't depend on server-side
 * config types). Threaded through `RegistryContext` by EditorFactory.
 */
export interface RootEditorProps {
  /** Section-indexed ⇒ Anchor / SectionRef / heading-outline extensions. */
  sectionIndexed: boolean;
  /** Reference-validated ⇒ the 5 reference nodes + broken-ref decorations. */
  referenceValidated: boolean;
  /** Root ids whose pages are valid `@`-autocomplete / link targets (in addition to self). */
  linkTargets: string[];
}

/**
 * Full-behaviour props — the built-in `pages` root editor. Used as the default
 * when a caller does not pass root props, preserving pre-0.1.96 behaviour.
 */
export const FULL_ROOT_EDITOR_PROPS: RootEditorProps = {
  sectionIndexed: true,
  referenceValidated: true,
  linkTargets: [],
};

/** Minimal-behaviour props — a default user root / brief / patch editor. */
export const MINIMAL_ROOT_EDITOR_PROPS: RootEditorProps = {
  sectionIndexed: false,
  referenceValidated: false,
  linkTargets: [],
};

export type EditorExtensionFactory = AnyExtension | ((ctx: RegistryContext) => AnyExtension);

export type ExtensionScope = 'shared' | 'full';

export type EditorContextId = 'page' | 'description' | 'plan' | 'chat-input';

export const ALL_EDITOR_CONTEXTS: EditorContextId[] = ['page', 'description', 'plan', 'chat-input'];

export interface EditorExtensionRegistration {
  name: string;
  extension?: EditorExtensionFactory;
  priority?: number;
  /** @deprecated Prefer `availableIn`. Kept for backward compat until all registrations migrate. */
  scope?: ExtensionScope;
  /** Whitelist of contexts in which this extension is mounted. If omitted, derived from `scope`. */
  availableIn?: EditorContextId[];
  slashCommand?: SlashCommand;
  markdownIt?: { kind: 'inline' | 'block' | 'block_content'; pattern: RegExp };
}

/**
 * 0.1.96: root-property gates keyed by registration name. Kept centrally here (not
 * on each registration) so that per-root behaviour is gated on a root PROPERTY and
 * the registration list stays declarative. Only applied in the `page` context — the
 * sole context backed by a configurable root. Extensions absent from this map mount
 * in every page root (the "minimal" base editor: pages / user roots / briefs / patches).
 *
 * GOLDEN RULE: gating keys on a Root property (sectionIndexed / referenceValidated),
 * never on `rootId === 'pages'`.
 */
const ROOT_PROP_GATES: Record<string, 'sectionIndexed' | 'referenceValidated'> = {
  // sectionIndexed ⇒ Anchor / SectionRef / heading-outline actions.
  anchor_marker: 'sectionIndexed',
  section_ref: 'sectionIndexed',
  heading_actions: 'sectionIndexed',
  // referenceValidated ⇒ the 5 reference nodes (broken-ref decorations render inside
  // their node views).
  inline_mention: 'referenceValidated',
  single_element: 'referenceValidated',
  element_list: 'referenceValidated',
  tagged_list: 'referenceValidated',
  tagged_list_mixed: 'referenceValidated',
};

const REGISTRY: EditorExtensionRegistration[] = [];

export function registerEditorExtension(reg: EditorExtensionRegistration): void {
  const existing = REGISTRY.findIndex((r) => r.name === reg.name);
  if (existing >= 0) REGISTRY[existing] = reg;
  else REGISTRY.push(reg);
}

export function getEditorExtensions(
  ctx: RegistryContext,
  scope: ExtensionScope = 'full',
): AnyExtension[] {
  return [...REGISTRY]
    .filter((r) => r.extension && (scope === 'full' || (r.scope ?? 'shared') === 'shared'))
    .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000))
    .map((r) =>
      typeof r.extension === 'function'
        ? (r.extension as (ctx: RegistryContext) => AnyExtension)(ctx)
        : (r.extension as AnyExtension),
    );
}

/**
 * Returns extensions whitelisted for a given editor context.
 * Resolution order:
 *   1. If `availableIn` is set → use it literally.
 *   2. Fallback to `scope`: 'shared' → all contexts, 'full' → ['page', 'plan'].
 *   3. In the `page` context, additionally gate on the page root's PROPERTIES
 *      (`rootProps`) via `ROOT_PROP_GATES`.
 * Sorted by priority asc (lower = earlier).
 *
 * `rootProps` defaults to full-behaviour props so callers that have not yet been
 * migrated keep the pre-0.1.96 `pages`-root editor.
 */
export function getEditorExtensionsForContext(
  ctx: RegistryContext,
  contextId: EditorContextId,
  rootProps: RootEditorProps = FULL_ROOT_EDITOR_PROPS,
): AnyExtension[] {
  const ctxWithId: RegistryContext = { ...ctx, contextId, rootProps };
  return [...REGISTRY]
    .filter(
      (r) =>
        r.extension &&
        isAvailableInContext(r, contextId) &&
        satisfiesRootProps(r, contextId, rootProps),
    )
    .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000))
    .map((r) =>
      typeof r.extension === 'function'
        ? (r.extension as (ctx: RegistryContext) => AnyExtension)(ctxWithId)
        : (r.extension as AnyExtension),
    );
}

function isAvailableInContext(
  reg: EditorExtensionRegistration,
  contextId: EditorContextId,
): boolean {
  if (reg.availableIn) return reg.availableIn.includes(contextId);
  const scope = reg.scope ?? 'shared';
  if (scope === 'shared') return true;
  return contextId === 'page' || contextId === 'plan';
}

/**
 * 0.1.96 root-property gate. Only the `page` context is backed by a configurable
 * root, so non-page contexts (plan / description / chat-input) are never filtered
 * by root props. In the `page` context, an extension named in `ROOT_PROP_GATES`
 * mounts only when the corresponding root property is enabled.
 */
function satisfiesRootProps(
  reg: EditorExtensionRegistration,
  contextId: EditorContextId,
  rootProps: RootEditorProps,
): boolean {
  if (contextId !== 'page') return true;
  const gate = ROOT_PROP_GATES[reg.name];
  if (!gate) return true;
  return rootProps[gate];
}

export function getRegisteredSlashCommands(): SlashCommand[] {
  return REGISTRY.filter((r) => r.slashCommand).map((r) => r.slashCommand!);
}

export function getRegisteredSlashCommandsForContext(contextId: EditorContextId): SlashCommand[] {
  return REGISTRY.filter((r) => r.slashCommand && isAvailableInContext(r, contextId)).map(
    (r) => r.slashCommand!,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Mention framework (L8 MentionExtension generic sources)
// ────────────────────────────────────────────────────────────────────────────

export interface MentionSource<T = unknown> {
  /** Stable source id, e.g. 'files' for M14 page references. */
  id: string;
  /** Trigger character (typically '@'). */
  trigger: string;
  /** Contexts in which this source is active. If omitted, active in all contexts. */
  availableIn?: EditorContextId[];
  /** Async or sync search. Returns up to `limit` items for `query`. */
  search: (query: string, limit?: number) => Promise<T[]> | T[];
  /** Render one item row in the popup. */
  renderItem: (item: T, active: boolean) => ReactElement;
  /** Handle item selection. Receives editor + insertion range via callback args. */
  onSelect: (item: T, editor: Editor) => void;
  /** Optional: stable key for React list rendering. */
  getItemKey?: (item: T) => string;
  /** Optional: minimum query length before search fires. Default 0 (show suggestions on trigger). */
  minQueryLength?: number;
}

const MENTION_REGISTRY: MentionSource<unknown>[] = [];

export function registerMentionSource<T>(source: MentionSource<T>): void {
  const existing = MENTION_REGISTRY.findIndex((s) => s.id === source.id);
  if (existing >= 0) MENTION_REGISTRY[existing] = source as MentionSource<unknown>;
  else MENTION_REGISTRY.push(source as MentionSource<unknown>);
}

export function getRegisteredMentionSources(contextId?: EditorContextId): MentionSource<unknown>[] {
  if (!contextId) return [...MENTION_REGISTRY];
  return MENTION_REGISTRY.filter((s) => !s.availableIn || s.availableIn.includes(contextId));
}

export function getMentionSourceByTrigger(
  trigger: string,
  contextId?: EditorContextId,
): MentionSource<unknown> | undefined {
  return getRegisteredMentionSources(contextId).find((s) => s.trigger === trigger);
}
