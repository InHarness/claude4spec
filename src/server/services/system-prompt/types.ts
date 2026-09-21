import type { Annotation, Brief, ChatContextType, Plan } from '../../../shared/entities.js';
import type { Root } from '../../../shared/types.js';
import type { ProjectPluginHost } from '../../core/plugin-host/types.js';
import type { PatchDetail } from '../patch.js';

/*
 * M48 — System Prompt Composition: the shapes the composer and the contributing
 * modules share. Moved here from `chat-context.ts` in 0.2.97 together with the
 * blocks themselves; `chat-context.ts` re-exports the input types, because its
 * consumers have always named them from there.
 */

/**
 * 0.1.58: a workspace peer the agent may consult via `c4s-tools.ask`.
 *
 * 0.2.50 — THREE fields, two of which are names, and the difference between them
 * is the whole reason this comment is long.
 *
 * `name` is what the peer calls itself in its own `config.json`: "C4S - App
 * Spec". It is a label for a human and is NOT an address — `ask({ project })`
 * resolves a non-path value through `findProjectByName`, which compares against
 * the WORKSPACE REGISTRY's name, and the two are routinely different strings.
 * `registryName` is that registry name (`app-spec`), and it is the one the agent
 * must pass.
 *
 * This was found by running the call, not by reading the code: the obvious
 * simplification of this block — "drop the path, the name is an address" —
 * type-checks, reads correctly, and answers PROJECT_SLUG_NOT_FOUND.
 *
 * `path` is the peer's `cwd` and remains the resolver's first attempt, which is
 * why it survives as the fallback address when a peer's config is unreadable.
 */
export interface PeerProject {
  /** Display name from the peer's own `config.json`. A label, never an address. */
  name?: string;
  /** `ProjectRecord.name` from the workspace registry — the address `ask({ project })` resolves. */
  registryName?: string;
  path: string;
  description?: string;
  /**
   * The registry name is also carried by a project NOT in this list — the
   * current one, which is filtered out upstream. The block cannot count that
   * collision itself, so the lister flags it and the peer keeps its `path`.
   */
  nameShared?: boolean;
}

/**
 * 0.2.50: one mounted MCP server as the prompt sees it — the name it is mounted
 * under, and the tools it declares, AFTER the context profile's gate.
 *
 * `tools` is optional for the same reason `McpServerFactory.tools` is: a server
 * built against the pre-0.2.13 contract declares nothing, and the honest
 * rendering of that is the server's bare name rather than a guess.
 */
export interface McpInventoryEntry {
  name: string;
  tools?: readonly string[];
  /**
   * Whether this server came from a PLUGIN rather than the host. The prompt does
   * not render it; `planModeMutatingTools` classifies with it, because a catalog
   * row is a statement about the surface it was declared on and `CATALOG` is
   * keyed by bare tool name. See `toolAdmittedByProfile`, which draws the same
   * distinction for the same reason.
   */
  plugin?: boolean;
}

export interface SystemPromptInput {
  /** M31: per-project host (was the process singleton). */
  host: ProjectPluginHost;
  projectName: string;
  cwd: string;
  /** 0.1.96 multiroot: every configured page root (replaces the single `pagesDir`).
   *  Drives the `<project roots="…">` attr and the `<agent_path_scope>` allow-list. */
  roots: Root[];
  currentPagePath: string | null;
  /** 0.1.96: which root the current page belongs to — the `root="…"` attr on `<current_page>`. */
  currentPageRootId?: string;
  /** 0.2.105: read only to count `total_lines` — no line of it reaches the prompt. */
  currentPageBody: string | null;
  annotations?: Annotation[];
  planMode?: boolean;
  currentPlan?: Plan | null;
  /**
   * 0.2.50: the MCP servers actually mounted for this turn, post-gate — the sole
   * source of the `<tooling>` block, and the replacement for the
   * `planToolsAvailable` / `c4sToolsAvailable` flag pair.
   *
   * Those flags existed so the prompt could be kept in step with the mount by
   * hand. They kept two of the servers in step and left the rest to a list of
   * literals that nothing checked, which is how `page-tools` came to be missing
   * from a prompt that instructs the agent to call `update_sections`. There is
   * no longer a second list to keep in step with: this one is derived from the
   * mount itself, and whether a block like `<workspace_projects>` renders is a
   * question about what is in here, not about a flag beside it.
   *
   * Absent (the hand-rolled test rigs) means "no MCP servers", and the block
   * renders with its built-ins alone rather than crashing.
   */
  mcpInventory?: readonly McpInventoryEntry[];
  /** 0.1.58: workspace peers (current project excluded) for the
   *  `<workspace_projects>` discovery block. Gated on `c4s-tools` being mounted. */
  workspaceProjects?: PeerProject[];
  /** 0.1.58: workspace name — the `workspace="…"` attr on `<workspace_projects>`. */
  workspaceName?: string;
  /**
   * M37 (0.2.19): the active writing style, or `null`. Zero or one — NOT a list.
   * This is the sole source of the prompt's `<project_writing_skill>` block, and there is
   * therefore at most one such block in every one of the four context types.
   *
   * It replaces `forcedSkills: {slug,title}[]`, which was a list because forcing
   * was modelled as a property of a SKILL (`injection: 'forced'`) rather than of
   * the writing-style SLOT. Every other skill — the hardcoded contextual ones and
   * the plugin fan-out — rides `availableSkills` alone, and the model opens it via
   * `load_skill_file(<slug>)` if the description warrants it.
   */
  writingStyleSkill?: { slug: string; title: string } | null;
  /**
   * 0.2.36: the skill LISTING — `{ slug, description }` per attached skill, from
   * `SkillResolver.resolveForContext`. Rendered as `<available_skills>`, which is
   * emitted UNCONDITIONALLY in every context type, empty list included.
   *
   * This field replaced no field: before it, the prompt said nothing about skills
   * at all, because their bodies were shipped to the model out of band via
   * `adapter.execute({ skills })`. Now the prompt is the ONLY carrier of the fact
   * that skills exist, and `load_skill_file` is the only carrier of their content.
   *
   * A description is all the model gets to decide with, so it is the whole cost of
   * a skill in the prompt — one line, where it used to be a whole `SKILL.md`.
   */
  availableSkills?: { slug: string; description: string }[];
  /**
   * 0.2.19: body of the `<interaction_context type="…">` block — the domain rules of
   * this thread's interaction type, owned by the genre's module (M21/M23/M11) and
   * supplied by the caller from `CONTEXT_TYPE_REGISTRY[contextType].interactionRules`.
   * Empty/absent is legitimate (`chat`) and yields a self-closing block; the block is
   * never omitted.
   */
  interactionRules?: string;
  /** 0.1.51: config.language — display name; emits `<spec_language>` (chat/patch only, NOT brief). */
  specLanguage?: string;
  /** 0.1.51: config.agent.conversationalLanguage — display name; emits `<conversational_language>` (chat/patch + brief). */
  conversationalLanguage?: string;
  /**
   * 0.1.90: config-level agent FS path scope. `allowedPaths`/`disallowedPaths` are the raw
   * config lists (NOT the resolved/absolute lists) and drive the block's ALLOWED/DISALLOWED
   * lines. 0.1.130: `artifactDenyDirs` (absolute, from the resolver's implicit deny-set) is
   * always non-empty, so the `<agent_path_scope>` block is now emitted in every chat/patch/ask
   * frame (still absent in brief) — it carries the unconditional ALWAYS-DISALLOWED line for
   * the C4S artifact dirs. The block renders cwd + every root dir itself for ALLOWED.
   */
  agentPathScope?: {
    allowedPaths: string[];
    disallowedPaths: string[];
    artifactDenyDirs: string[];
    /** 0.2.13 item 28 — read-allowed, write-denied. See `agent-path-scope.ts`. */
    pageRootDirs: string[];
  };
  /**
   * 0.2.53: whether this turn HAS the built-in filesystem/shell tools — the
   * negation of `agent.disableDirectFilesystemAccess`. Absent defaults to
   * `{ enabled: false }`, which matches the config default (absent field = the
   * flag is on = the built-ins are gone), so a caller that forgets it describes
   * the default posture rather than the permissive one.
   */
  agentFilesystemAccess?: { enabled: boolean };
  /** M21 m05ctxreg: one of the four interaction types — `chat` (default), `brief`, `patch`,
   *  `ask`. Drives the frame, and is echoed verbatim as `<interaction_context type="…">`. */
  contextType?: ChatContextType;
  /** M21: snapshot of the brief attached to this thread (only when contextType='brief'). */
  brief?: Brief | null;
  /** M23: snapshot of the patch attached to this thread (only when contextType='patch'). */
  patch?: PatchDetail | null;
}

/**
 * The five layers the default composition is ordered by. The axis is VOLATILITY
 * plus LOCALITY OF REFERENCE: a block sits next to what it talks about, and the
 * more often its content changes, the further down it goes.
 *
 *   A — the frame.     Who you are, and which of the four interactions this is.
 *   B — this project.  What exists here: entity types, skills, the writing style.
 *   C — access.        What you can call, and where you may reach.
 *   D — conventions.   How to write, including whatever the active types add.
 *   E — current state. This page, these annotations, this plan, this turn's mode.
 *
 * A layer is a property of a POSITION in a composition, not of a block: the
 * module declaring a block does not know where it will stand (L16).
 */
export type PromptLayer = 'A' | 'B' | 'C' | 'D' | 'E';

/** What every block's `render` receives: the input plus the few derived values. */
export interface PromptContext extends SystemPromptInput {
  contextType: ChatContextType;
  annotations: Annotation[];
  availableSkills: { slug: string; description: string }[];
  mcpInventory: readonly McpInventoryEntry[];
  workspaceProjects: PeerProject[];
  currentPageRootId: string;
  planMode: boolean;
  currentPlan: Plan | null;
  writingStyleSkill: { slug: string; title: string } | null;
  brief: Brief | null;
  patch: PatchDetail | null;
}

/**
 * Per-position options a composition may hand a block — how a composition asks
 * for a block's variant without the block knowing which composition asked.
 * Unknown keys are ignored by the block.
 */
export type BlockOptions = Readonly<Record<string, unknown>>;

/**
 * One block of the prompt, as the module that OWNS it declares it (L16): the
 * tag it is named by, and a `render` that returns the block, or `null` when its
 * emission condition does not hold for this turn. The declaration carries no
 * position and no list of compositions — both belong to the composer.
 */
export interface PromptBlock {
  /** The XML tag name — the block's only identifier. */
  name: string;
  render(ctx: PromptContext, options?: BlockOptions): string | null;
}

/** One position of a composition: which block, in which layer, with which options. */
export interface CompositionEntry {
  block: string;
  layer?: PromptLayer;
  options?: BlockOptions;
}

/**
 * How a context type declares its prompt (M44 × M48): `'default'` — the
 * composer's default composition, every block's presence decided by its own
 * emission condition alone — or `own`, a composition the type brings itself.
 */
export type PromptCompositionDecl = 'default' | { own: readonly CompositionEntry[] };
