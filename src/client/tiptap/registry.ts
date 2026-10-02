import type { AnyExtension, Editor } from '@tiptap/core';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { Annotation } from '../../shared/entities.js';
import type { SlashCommand } from './extensions/SlashMenu.js';
import { isRegisteredXmlTag, listXmlTags } from '../../shared/xml-markup/registry.js';
import {
  resolveContextSpec,
  FULL_ROOT_EDITOR_PROPS,
  type EditorContextId,
  type EditorContextSpec,
  type RootEditorProps,
} from './contextSpec.js';

// The context contract lives in `contextSpec.ts` (it must not depend on this
// registry); re-exported here so existing imports keep working.
export {
  ALL_EDITOR_CONTEXTS,
  assertSaveMode,
  FULL_ROOT_EDITOR_PROPS,
  MINIMAL_ROOT_EDITOR_PROPS,
  artefactRootEditorProps,
  type EditorContextId,
  type EditorContextSpec,
  type EditorSavePolicy,
  type RootEditorProps,
} from './contextSpec.js';

export interface RegistryContext {
  qc: QueryClient;
  currentPath: string | null;
  /**
   * 0.2.89: the root `currentPath` is relative to, in the `page` context. A page
   * is addressed by the pair, so anything that builds a link to it needs both.
   */
  rootId?: string | null;
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
  /**
   * The materialized `EditorContextSpec` this instance is built from. Set by
   * the registry when instantiating factory extensions; the raw-JSX nodes read
   * `contextSpec.extensions` to know which allowlisted tags have NO node here
   * and must pass through verbatim (M20 `ctx4prof`, rule 6).
   */
  contextSpec?: EditorContextSpec;
}

export type EditorExtensionFactory = AnyExtension | ((ctx: RegistryContext) => AnyExtension);

/**
 * 2.1.2 (M51) — an editor extension serves syntax and nodes that are NOT XML
 * markup tags (and slash commands). The node of a registered tag is built by
 * the editor itself from the registry (`extensions/xmlNodes.ts`); a module
 * contributing a tag registers neither a node nor a parser rule for it, and
 * a registration whose `name` is a registered tag name is rejected.
 */
export interface EditorExtensionRegistration {
  /** The extension's name. */
  name: string;
  /** The extension definition, engine-dependent. */
  extension?: EditorExtensionFactory;
  /** Load order (default 1000). */
  priority?: number;
  /**
   * HINT per context — the module declares where its extension makes sense.
   * It does NOT decide what mounts: the context's `EditorContextSpec`
   * whitelist is authoritative (M20 `ctx4prof`, rule 3). A name whitelisted by
   * a context but not declared here still mounts, with a one-time warning so
   * the declaration gets fixed.
   */
  availableIn?: EditorContextId[];
  /** Optional — when the extension contributes a slash command. */
  slashCommand?: SlashCommand;
  /** Optional — a parser rule of its own; ONLY for syntax outside the XML markup registry. */
  markdownIt?: { kind: 'inline' | 'block' | 'block_content'; pattern: RegExp };
}

const REGISTRY: EditorExtensionRegistration[] = [];

// ────────────────────────────────────────────────────────────────────────────
// Schema version (L8 `m33l8wir` / `m20l11sc` ordering invariant)
// ────────────────────────────────────────────────────────────────────────────
//
// Tiptap freezes its ProseMirror schema when an editor instance is created. A
// node type registered AFTER that moment is silently dropped by ProseMirror —
// no error, an empty render, and an embed of that type shows "unknown type".
// The plugin boot is deliberately non-blocking (main.tsx), so an editor mounted
// on a deep link can be created before a plugin's extensions arrive; the same
// window reopens on every `plugin:reloaded`.
//
// The spec allows two implementations: gate editor creation on a plugins-ready
// signal, or re-initialise live instances once the extensions land. This is the
// second one. Every registration that changes the SCHEMA (adds, replaces or
// removes an entry carrying `extension`) bumps `schemaVersion`; editors include
// it in their `useEditor` deps (see `useEditorSchema.ts`) and rebuild with the
// current document carried across. Slash commands and mention sources are read
// from the registry live, so a registration carrying only those does not bump —
// today no shipped plugin contributes a schema extension, which keeps the boot
// free of rebuilds while still closing the race for the day one does.
let schemaVersion = 0;
const schemaListeners = new Set<() => void>();
let notifyQueued = false;

function bumpSchemaVersion(): void {
  schemaVersion += 1;
  if (notifyQueued) return;
  notifyQueued = true;
  // Coalesce: one plugin registers several extensions back to back; the
  // editors should rebuild once per settled batch, not once per call.
  queueMicrotask(() => {
    notifyQueued = false;
    for (const listener of schemaListeners) listener();
  });
}

/** Monotonic counter of schema-affecting registry changes. */
export function getEditorSchemaVersion(): number {
  return schemaVersion;
}

/** Subscribe to schema-affecting registry changes; returns the unsubscribe. */
export function subscribeEditorSchema(listener: () => void): () => void {
  schemaListeners.add(listener);
  return () => {
    schemaListeners.delete(listener);
  };
}

export function registerEditorExtension(reg: EditorExtensionRegistration): void {
  if (isRegisteredXmlTag(reg.name)) {
    throw new Error(
      `Editor extension "${reg.name}" is rejected — "${reg.name}" is a registered XML tag; its node is built from the tag registry`,
    );
  }
  const existing = REGISTRY.findIndex((r) => r.name === reg.name);
  const touchesSchema = !!reg.extension || (existing >= 0 && !!REGISTRY[existing]!.extension);
  if (existing >= 0) REGISTRY[existing] = reg;
  else REGISTRY.push(reg);
  if (touchesSchema) bumpSchemaVersion();
}

/**
 * 0.2.29 — drop every registration whose name starts with `prefix`.
 *
 * `registerEditorExtension` only ever upserts, which makes this module a PUSH
 * cache: once a plugin's entries land here nothing takes them out again. That is
 * fine while plugins only ever arrive, but a plugin can also LEAVE the pool —
 * the host unwires it with `registry.unregisterPlugin(name)`, and every SERVER-
 * side consumer notices because they all read by pull. The client's push caches
 * do not: a departed package's slash commands would stay in the menu until a
 * full page reload.
 *
 * So the plugin-command layer re-registers by REPLACE rather than merge, and
 * this is the removal half of it. Prefix-scoped on purpose — `plugin-cmd:` is
 * owned entirely by `pluginCommands.ts`, so clearing it cannot touch a built-in
 * or an entity-borne extension, which register under their own bare names.
 */
export function unregisterEditorExtensionsByPrefix(prefix: string): void {
  let touchedSchema = false;
  for (let i = REGISTRY.length - 1; i >= 0; i--) {
    if (!REGISTRY[i]!.name.startsWith(prefix)) continue;
    if (REGISTRY[i]!.extension) touchedSchema = true;
    REGISTRY.splice(i, 1);
  }
  if (touchedSchema) bumpSchemaVersion();
}

const registryView = {
  // Schema extensions plus every registered XML tag — a tag's node is mounted
  // by name like any extension, but comes from the M51 registry.
  extensionNames: () => [
    ...REGISTRY.filter((r) => r.extension).map((r) => r.name),
    ...listXmlTags().map((t) => t.name),
  ],
  slashCommandIds: () => REGISTRY.filter((r) => r.slashCommand).map((r) => r.slashCommand!.id),
};

/**
 * The `EditorContextSpec` an instance of `contextId` is built from. `page` is
 * derived from `rootProps` and the live registry (plugins contribute to pages);
 * the other contexts are static. Components read `.save` from here.
 */
export function getContextSpec(
  contextId: EditorContextId,
  rootProps: RootEditorProps = FULL_ROOT_EDITOR_PROPS,
): EditorContextSpec {
  return resolveContextSpec(contextId, rootProps, registryView);
}

const hintWarned = new Set<string>();

function warnHintMismatch(reg: EditorExtensionRegistration, contextId: EditorContextId): void {
  if (!reg.availableIn || reg.availableIn.includes(contextId)) return;
  const key = `${reg.name}@${contextId}`;
  if (hintWarned.has(key)) return;
  hintWarned.add(key);
  console.warn(
    `[editor] context "${contextId}" whitelists extension "${reg.name}" which does not declare it in availableIn — the context wins; fix the registration`,
  );
}

/**
 * Registry ∩ `spec.extensions` — the extensions an editor mounts for
 * `contextId` (M20 `ctx4prof`, rule 3: the context whitelist is authoritative,
 * `availableIn` is a hint). A name absent from the whitelist is not in the
 * returned array at all: no keymap, no input rules, no parser tokens.
 * Sorted by priority asc (lower = earlier).
 */
export function getEditorExtensionsForContext(
  ctx: RegistryContext,
  contextId: EditorContextId,
  rootProps: RootEditorProps = FULL_ROOT_EDITOR_PROPS,
): AnyExtension[] {
  const spec = getContextSpec(contextId, rootProps);
  const allowed = new Set(spec.extensions);
  const ctxWithId: RegistryContext = { ...ctx, contextId, rootProps, contextSpec: spec };
  const entries: Array<{ priority: number; build: () => AnyExtension }> = [...REGISTRY]
    .filter((r) => r.extension && allowed.has(r.name))
    .map((r) => ({
      priority: r.priority ?? 1000,
      build: () => {
        warnHintMismatch(r, contextId);
        return typeof r.extension === 'function'
          ? (r.extension as (ctx: RegistryContext) => AnyExtension)(ctxWithId)
          : (r.extension as AnyExtension);
      },
    }));
  // The nodes of the whitelisted XML tags, built from the M51 registry. They
  // load after the raw-JSX nodes (300/301), whose rules must run first.
  for (const node of xmlTagNodesFor(spec.extensions)) {
    entries.push({ priority: XML_TAG_NODE_PRIORITY, build: () => node });
  }
  return entries.sort((a, b) => a.priority - b.priority).map((e) => e.build());
}

/** Load order of the XML tag nodes: after the raw-JSX nodes, before page refs. */
const XML_TAG_NODE_PRIORITY = 600;

/**
 * The builder of XML tag nodes, provided by `extensions/xmlNodes.ts` when it
 * loads. Injected rather than imported: the nodes' views reach (through the
 * entity modules) back into this registry, and a static import would evaluate
 * them before `REGISTRY` exists.
 */
let xmlTagNodesFor: (names: readonly string[]) => AnyExtension[] = () => [];

export function provideXmlTagNodes(builder: (names: readonly string[]) => AnyExtension[]): void {
  xmlTagNodesFor = builder;
}

/** Registry ∩ `spec.slashCommands` (by `SlashCommand.id`). Read live so plugin commands that arrive later show up. */
export function getRegisteredSlashCommandsForContext(
  contextId: EditorContextId,
  rootProps: RootEditorProps = FULL_ROOT_EDITOR_PROPS,
): SlashCommand[] {
  const allowed = new Set(getContextSpec(contextId, rootProps).slashCommands);
  return REGISTRY.filter((r) => r.slashCommand && allowed.has(r.slashCommand.id)).map(
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
  /** HINT per context; the context's `EditorContextSpec.mentions` whitelist is authoritative. */
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

/** Registry ∩ `spec.mentions`; without a context, every registered source. */
export function getRegisteredMentionSources(
  contextId?: EditorContextId,
  rootProps: RootEditorProps = FULL_ROOT_EDITOR_PROPS,
): MentionSource<unknown>[] {
  if (!contextId) return [...MENTION_REGISTRY];
  const allowed = new Set(getContextSpec(contextId, rootProps).mentions ?? []);
  return MENTION_REGISTRY.filter((s) => allowed.has(s.id));
}

export function getMentionSourceByTrigger(
  trigger: string,
  contextId?: EditorContextId,
  rootProps?: RootEditorProps,
): MentionSource<unknown> | undefined {
  return getRegisteredMentionSources(contextId, rootProps).find((s) => s.trigger === trigger);
}
