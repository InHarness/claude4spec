/**
 * L8 `EditorContextSpec` — the editor CONTEXT is the authority on what an
 * editor instance mounts (M20 `ctx4prof`, rule 3: "the whitelist in the spec
 * is authoritative, the registration is a hint"; rule 4: "save policy per
 * context, not per module").
 *
 * This module knows nothing about the extension registry — the dependency
 * runs the other way: `registry.ts` asks `resolveContextSpec` which names to
 * mount and hands it a read-only view of what is registered, which only the
 * derived `page` context consults.
 *
 * Five contexts (M20 `ctxregst`): `page`, `artifact`, `description`, `plan`
 * and the auxiliary `chat-input`.
 *
 * 2.1.8: `page` is derived from the page root's KIND — never from per-root
 * flags (there are none) and never from its id. Briefs and patches mount the
 * NAMED context `artifact`: prose with `@` links over the `pages` roots, without
 * `section_ref`, `AnchorMarker` or entity nodes. It replaced the synthetic
 * property bag (`MINIMAL_ROOT_EDITOR_PROPS`) those surfaces used to fake.
 */
import {
  KIND_DECLARATIONS,
  PAGES_KIND,
  kindSelects,
  systemRootKindOf,
  type RootKind,
} from '../../shared/root-kinds.js';

export type EditorContextId = 'page' | 'artifact' | 'description' | 'plan' | 'chat-input';

export const ALL_EDITOR_CONTEXTS: EditorContextId[] = ['page', 'artifact', 'description', 'plan', 'chat-input'];

/**
 * The independent layers of a page editor (M20 `m20l13rt`), each decided by
 * the page root's kind. Threaded through `RegistryContext` by EditorFactory.
 */
export interface RootEditorProps {
  /** Anchors + `section_ref` + heading outline — the kind selects `m06-anchor-injection`. */
  sectionIndexed: boolean;
  /** Entity nodes + their validation — the kind's `references` flag. */
  referenceValidated: boolean;
  /**
   * 2.1.9 (M20 `m20l13rt` gated behaviour 3, M14 `m14l13rt` item 5): the `@`
   * autocomplete (`MentionExtension` with the `files` source) and the
   * `PageRefNode` — mounted on a root of kind `pages` only. A file of any other
   * kind gets neither: `@path.md` written there stays prose.
   */
  pageLinks: boolean;
}

/**
 * The editor layers a root of `kind` gets. The `@` SCOPE (which pages the
 * autocomplete suggests) is not a layer: it is every `kind: pages` root,
 * resolved server-side by the link indexer (source root → builtin → `roots[]`
 * order). Whether `@` is mounted at all is — `pageLinks`, decided by the kind.
 */
export function rootEditorPropsForKind(kind: RootKind): RootEditorProps {
  return {
    sectionIndexed: kindSelects(kind, 'm06-anchor-injection'),
    referenceValidated: KIND_DECLARATIONS[kind].flags.references,
    // ASSUMPTION:dev-0303 — a kind other than `pages` gets no `@` even if it
    // selects `m06-anchor-injection` (the one such kind with a page editor,
    // `skills`, selects no `m06-*` anyway).
    pageLinks: kind === PAGES_KIND,
  };
}

/** A `pages` root's editor — the kind's layers. */
export const FULL_ROOT_EDITOR_PROPS: RootEditorProps = rootEditorPropsForKind('pages');

/** One layer object per kind, so a page editor's props keep their identity across renders. */
const LAYERS_BY_KIND = new Map<RootKind, RootEditorProps>([[PAGES_KIND, FULL_ROOT_EDITOR_PROPS]]);

/**
 * 2.1.9 (M20 `m20l13rt`) — the layers of the page editor of a page in
 * `rootId`: the root's KIND is asked of the registry declaration (a root from
 * the source `kod` — today `skills`, M52 — carries its kind there; every
 * `config.roots[]` entry is of kind `pages`), and the gating then branches on
 * that kind's layers alone, never on the id. A `skills` package file therefore
 * opens with entity nodes (`references = tak`) but without anchors,
 * `section_ref`, the `@` autocomplete or the page-ref node.
 */
export function rootEditorPropsForRoot(rootId: string): RootEditorProps {
  const kind: RootKind = systemRootKindOf(rootId) ?? PAGES_KIND;
  let layers = LAYERS_BY_KIND.get(kind);
  if (!layers) {
    layers = rootEditorPropsForKind(kind);
    LAYERS_BY_KIND.set(kind, layers);
  }
  return layers;
}

/**
 * The layers of the FIXED `artifact` context (briefs, patches): prose and `@`
 * links only. Owned by the context — a mounting component names `artifact`
 * and never hands in a layer set of its own.
 */
const ARTIFACT_LAYERS: RootEditorProps = {
  sectionIndexed: false,
  referenceValidated: false,
  pageLinks: true,
};

export type EditorSavePolicy =
  | { mode: 'debounce'; debounceMs: number } // save after idle
  | { mode: 'blur' } // save when focus leaves
  | { mode: 'explicit' }; // Save button (+ dirty-state guard) or submit

export interface EditorContextSpec {
  id: EditorContextId;
  /** Whitelist of registry extension names. Names absent here are NOT mounted at all. */
  extensions: string[];
  /**
   * Whitelist of `SlashCommand.id` AND of command-source ids (2.1.9, M20
   * `lxdrxdm2`); `[]` = no slash framework. A source's ITEMS are never listed
   * here — they are read from the source each time the popover opens.
   */
  slashCommands: string[];
  /** Whitelist of decorations mounted in this instance (declarative; see below). */
  decorations: string[];
  /** Whitelist of mention source ids. */
  mentions?: string[];
  save: EditorSavePolicy;
  /** Global read-only switch; a mounting component may still override per instance. */
  readonly?: boolean;
}

/**
 * The `page` context is not an enum member with a fixed list — it is DERIVED
 * from the page root's KIND (L13). The whitelist for a page is therefore
 * "everything registered, gated by the layer of the kind each name depends on".
 * The registry hands this view in; the spec module never imports the registry.
 */
export interface ContextRegistryView {
  extensionNames(): string[];
  /** Fixed slash commands plus the command sources that stand in `page` (2.1.9). */
  slashCommandIds(): string[];
}

/**
 * L8 `page` save policy: 1000 ms after the last keystroke (M02
 * `autoSaveDebounceMs`). One number on purpose — the M20 race analysis
 * (`m20edge0`) pairs it with the 500 ms WS invalidation batch — and one
 * constant for the page (`page`) and the brief and patch (`artifact`).
 */
export const AUTOSAVE_DEBOUNCE_MS = 1000;

/**
 * Layer gates keyed by registration name, applied to the derived `page` and
 * `artifact` contexts. Extensions absent from this map mount in both.
 *
 * GOLDEN RULE: gating keys on a layer the root's KIND decides, never on
 * `rootId === 'pages'`.
 */
const ROOT_PROP_GATES: Record<string, keyof RootEditorProps> = {
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
  // pageLinks ⇒ `@` autocomplete + the page-ref node (2.1.9, `m20l13rt` (3)).
  mention_extension: 'pageLinks',
  page_ref: 'pageLinks',
};

/**
 * The same gates for the `page` SLASH palette. A command whose node the root
 * gates out of the schema must not be offered: `SlashCommands` deletes the
 * `/query` range BEFORE invoking, and `insertContent` of an unknown node type
 * inserts nothing — the pick would eat the query and leave a blank. `null` =
 * ungated (`/todo` inserts a `todo` marker, mounted in every page root). An id
 * absent here is a plugin command (M33 `contributes.commands`): its popover
 * inserts an entity embed, so it takes the reference gate.
 */
const SLASH_COMMAND_GATES: Record<string, keyof RootEditorProps | null> = {
  mention: 'referenceValidated',
  element: 'referenceValidated',
  list: 'referenceValidated',
  tagged: 'referenceValidated',
  'tagged-mixed': 'referenceValidated',
  diagram: 'referenceValidated',
  section: 'sectionIndexed',
  todo: null,
};

/** The two raw-JSX nodes — mounted in EVERY context (rule 6: passthrough verbatim). */
const RAW_NODES = ['raw_jsx_block', 'raw_jsx_inline'];

/** The 5 M19 entity tags (their nodes come from the M51 registry). */
const M19_NODES = ['inline_mention', 'single_element', 'element_list', 'tagged_list', 'tagged_list_mixed'];

/**
 * M20 `ctxregst` — the three static contexts, transcribed row by row.
 *
 * The XML tag names in these lists (M51) mount the tag NODES the editor builds
 * from the tag registry; every other name is a registry extension.
 *
 * `description`: StarterKit h2–h6 + lists + tables (core, built by
 * EditorFactory) + the `inline_mention` tag node (the only M19 tag allowed) +
 * `AnchorMarker` (passthrough) + the slash framework with `/mention` alone. No
 * `@` mention framework (the field is too short). `task_list`/`task_item` are
 * not in the `ctxregst` row but are GFM syntax the pre-0.2.85 description
 * editor parsed: without them an existing `- [ ] x` is re-serialised as
 * `- \[ \] x` on the next blur-save (rule 7 — the core must cover syntax
 * already in the content; patch filed on brief 0-2-87-to-next).
 *
 * `plan`: starter-kit + the 5 M19 tag nodes + the `section_ref` tag node +
 * `AnchorMarker` + `MentionExtension` + `OutlineExtension` (`heading_actions`);
 * `/section` is the only slash command — no `todo` node, no `/todo`, no plugin commands. A
 * `<todo …/>` in a plan survives its explicit save through the raw node.
 * `page_ref` is implied by the `files` mention source, which inserts one;
 * `task_list`/`task_item` are GFM syntax the core StarterKit already parsed
 * before the whitelist existed (rule 7 — the core must cover syntax already in
 * the content).
 *
 * `chat-input`: minimal — `Document`/`Paragraph`/`Text` (core) +
 * `MentionExtension` + `PageRefNode` + the `section_ref` tag node (allowed
 * exception: the chip most often pasted into chat) + the slash framework
 * (`SlashDispatcher` = `slash_commands`) with `/section`, plus (2.1.9, M52)
 * the `skill_ref` tag node and the `spec-skills` command source — the source
 * by its id in `slashCommands`, the node by its tag name. The source's items
 * (one `/<slug>` per chat skill, and `/skills`) are never listed here.
 */
const STATIC_SPECS: Record<Exclude<EditorContextId, 'page' | 'artifact'>, EditorContextSpec> = {
  description: {
    id: 'description',
    extensions: ['anchor_marker', 'task_list', 'task_item', 'inline_mention', ...RAW_NODES, 'slash_commands'],
    slashCommands: ['mention'],
    decorations: ['broken_refs'],
    mentions: [],
    save: { mode: 'blur' },
  },
  plan: {
    id: 'plan',
    extensions: [
      'anchor_marker',
      'task_list',
      'task_item',
      ...M19_NODES,
      'section_ref',
      ...RAW_NODES,
      'page_ref',
      'heading_actions',
      'annotationHighlight',
      'mention_extension',
      'slash_commands',
    ],
    slashCommands: ['section'],
    decorations: ['annotations', 'broken_refs'],
    mentions: ['files'],
    save: { mode: 'explicit' },
  },
  'chat-input': {
    id: 'chat-input',
    extensions: ['section_ref', 'skill_ref', ...RAW_NODES, 'page_ref', 'mention_extension', 'slash_commands'],
    slashCommands: ['section', 'spec-skills'],
    decorations: [],
    mentions: ['files'],
    save: { mode: 'explicit' },
  },
};

/**
 * Materialize the `EditorContextSpec` for a context. `page` is derived from
 * `rootProps` — the layers of the page root's kind (`rootEditorPropsForKind`)
 * — and from what is currently registered (plugins contribute both schema
 * extensions and slash commands to pages). `artifact` is fixed: the same
 * derivation over its own layers, whatever `rootProps` says. The other three
 * are static.
 */
export function resolveContextSpec(
  contextId: EditorContextId,
  rootProps: RootEditorProps,
  registry: ContextRegistryView,
): EditorContextSpec {
  if (contextId === 'artifact') {
    // Fixed: the page derivation over the artifact layers, never the caller's
    // — no anchors, no section refs, no entity nodes; prose and `@` links over
    // every `kind: pages` root.
    return { ...resolveContextSpec('page', ARTIFACT_LAYERS, registry), id: 'artifact' };
  }
  if (contextId !== 'page') return STATIC_SPECS[contextId];
  return {
    id: 'page',
    extensions: registry.extensionNames().filter((name) => {
      const gate = ROOT_PROP_GATES[name];
      return gate ? rootProps[gate] : true;
    }),
    slashCommands: registry.slashCommandIds().filter((id) => {
      const gate = id in SLASH_COMMAND_GATES ? SLASH_COMMAND_GATES[id] : 'referenceValidated';
      return gate ? rootProps[gate] : true;
    }),
    decorations: rootProps.referenceValidated ? ['annotations', 'broken_refs'] : ['annotations'],
    // Scope = every `pages` root (M14, 2.1.8); the editor's root rides along
    // as the precedence's first step (`MentionExtension` option `rootId`).
    // 2.1.9: no `@` at all on a root whose kind is not `pages`.
    mentions: rootProps.pageLinks ? ['files'] : [],
    save: { mode: 'debounce', debounceMs: AUTOSAVE_DEBOUNCE_MS },
  };
}

/**
 * Rule 4 guard for mounting components: a component wires the save mechanics
 * its context declares and nothing else. A mismatch is a programming error;
 * it is reported, not thrown, so a wrong wiring never takes an editor down.
 */
export function assertSaveMode<M extends EditorSavePolicy['mode']>(
  spec: EditorContextSpec,
  mode: M,
): Extract<EditorSavePolicy, { mode: M }> {
  if (spec.save.mode !== mode) {
    console.error(
      `[editor] context "${spec.id}" declares save mode "${spec.save.mode}", component wired "${mode}"`,
    );
  }
  return spec.save as Extract<EditorSavePolicy, { mode: M }>;
}
