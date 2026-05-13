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
}

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
 * Sorted by priority asc (lower = earlier).
 */
export function getEditorExtensionsForContext(
  ctx: RegistryContext,
  contextId: EditorContextId,
): AnyExtension[] {
  const ctxWithId: RegistryContext = { ...ctx, contextId };
  return [...REGISTRY]
    .filter((r) => r.extension && isAvailableInContext(r, contextId))
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
