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
  rootEditorPropsForKind,
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
   * 2.1.8: the editor layers of the page root's kind. Set by EditorFactory.
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

/** The registration under `name`, if any (read-only view for tests and diagnostics). */
export function getEditorExtensionRegistration(name: string): Readonly<EditorExtensionRegistration> | undefined {
  return REGISTRY.find((r) => r.name === name);
}

const registryView = {
  // Schema extensions plus every registered XML tag — a tag's node is mounted
  // by name like any extension, but comes from the M51 registry.
  extensionNames: () => [
    ...REGISTRY.filter((r) => r.extension).map((r) => r.name),
    ...listXmlTags().map((t) => t.name),
  ],
  // The derived `page` context admits every registered command and every
  // command source that stands in `page` (2.1.9) — by id, like a command.
  slashCommandIds: () => [
    ...REGISTRY.filter((r) => r.slashCommand).map((r) => r.slashCommand!.id),
    ...COMMAND_SOURCES.filter((s) => s.context === 'page').map((s) => s.id),
  ],
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
  // The `artifact` context is a narrowed page (2.1.8): a registration that
  // declares `page` is not mis-declared for it.
  const hintContext = contextId === 'artifact' ? 'page' : contextId;
  if (!reg.availableIn || reg.availableIn.includes(hintContext)) return;
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

/**
 * Registry ∩ `spec.slashCommands` (by `SlashCommand.id`) — the FIXED commands.
 * Read live so plugin commands that arrive later show up. Command sources
 * admitted by the same whitelist come from `getSlashCommandSourcesForContext`.
 */
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
// Command sources (2.1.9, M20 `lxdrxdm2` — L8 contribution kind `źródło komend`)
// ────────────────────────────────────────────────────────────────────────────

/**
 * One item of a command source's list (L8 `7l0puqrn`): `id` unique within the
 * source, `label` shown, `description`, and `hint` — the VISIBLE trigger the
 * typed `/prefix` is matched against and the measure of a collision with a
 * fixed command. `origin` — the optional origin marker shown beside the label.
 */
export interface SlashCommandSourceItem {
  id: string;
  label: string;
  description: string;
  hint: string;
  origin?: string;
  /**
   * Picking this item narrows the same slash popover to the items of the
   * command source with this id: the popover stays open, the typed prefix is
   * cleared and only that source's items are listed. The source's `onSelect`
   * is not called for such an item.
   */
  narrowTo?: string;
}

/**
 * A command source — a list of slash items whose composition depends on the
 * project state. Registered DIRECTLY from a module's front-end bootstrap (never
 * through the plugin host, so no axis-A/B auto-deactivation: it stays while the
 * module is in the build).
 */
export interface SlashCommandSource<T extends SlashCommandSourceItem = SlashCommandSourceItem> {
  /** Stable id — what a context's `EditorContextSpec.slashCommands` whitelists. */
  id: string;
  /**
   * The context the source stands in (column 3 of the contributor's sheet). A
   * declaration: the context's whitelist decides whether the source mounts.
   */
  context: EditorContextId;
  /** Read the current items. Called on EVERY popover open; nothing is cached between opens. */
  list: () => Promise<T[]> | T[];
  /**
   * The pick: control passes to the source. The `/prefix` range has already
   * been deleted; the source inserts at the caret in one transaction, or opens
   * a window through `openPopover` (never `window.prompt`).
   */
  onSelect: (item: T, editor: Editor) => void | Promise<void>;
}

const COMMAND_SOURCES: SlashCommandSource[] = [];

/** Register (or replace, by `id`) a command source. */
export function registerSlashCommandSource<T extends SlashCommandSourceItem>(source: SlashCommandSource<T>): void {
  const existing = COMMAND_SOURCES.findIndex((s) => s.id === source.id);
  if (existing >= 0) COMMAND_SOURCES[existing] = source as unknown as SlashCommandSource;
  else COMMAND_SOURCES.push(source as unknown as SlashCommandSource);
}

/** Remove a command source by id (a module leaving the build; tests). */
export function unregisterSlashCommandSource(id: string): void {
  const i = COMMAND_SOURCES.findIndex((s) => s.id === id);
  if (i >= 0) COMMAND_SOURCES.splice(i, 1);
}

/**
 * The command sources an instance of `contextId` admits: those whose `id`
 * stands in the context's `EditorContextSpec.slashCommands`. A source outside
 * the whitelist contributes nothing to that context's popover.
 */
export function getSlashCommandSourcesForContext(
  contextId: EditorContextId,
  rootProps: RootEditorProps = FULL_ROOT_EDITOR_PROPS,
): SlashCommandSource[] {
  const allowed = new Set(getContextSpec(contextId, rootProps).slashCommands);
  return COMMAND_SOURCES.filter((s) => allowed.has(s.id));
}

// ────────────────────────────────────────────────────────────────────────────
// Mention framework (L8 MentionExtension generic sources)
// ────────────────────────────────────────────────────────────────────────────

/**
 * 2.1.8 — what a mention source knows about the editor it searches for. `rootId`
 * is the root of the page being edited (null outside a page: plan, brief, chat
 * input); M14's `files` source passes it on so `@path.md` suggestions follow the
 * same precedence as resolution (source root → `builtin` → `roots[]` order).
 */
export interface MentionSearchContext {
  rootId: string | null;
}

export interface MentionSource<T = unknown> {
  /** Stable source id, e.g. 'files' for M14 page references. */
  id: string;
  /** Trigger character (typically '@'). */
  trigger: string;
  /** HINT per context; the context's `EditorContextSpec.mentions` whitelist is authoritative. */
  availableIn?: EditorContextId[];
  /** Async or sync search. Returns up to `limit` items for `query`, for the editor in `ctx`. */
  search: (query: string, limit?: number, ctx?: MentionSearchContext) => Promise<T[]> | T[];
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
