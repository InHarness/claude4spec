import type {
  Annotation,
  Brief,
  ChatContextType,
  Plan,
} from '../../shared/entities.js';
import type { PatchDetail } from './patch.js';
import path from 'node:path';
import type { Root } from '../../shared/types.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { PLAN_MODE_DENY_GROUPS, type SubagentDefinition, type ToolGroup } from '@inharness-ai/agent-adapters';
import { DIRECT_FILESYSTEM_DENY_GROUPS } from './agent-tool-posture.js';
import { buildClaudeCodeToolPolicy, claudeCodeKnownBuiltins } from '@inharness-ai/agent-adapters/claude-code';
import { PROFILES, mcpServerSetForProfile, type McpServerSet } from '../operations/profiles.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';

/**
 * Seed the process-wide catalog, for the same reason `profile-gate` does it at
 * its own module init: on an unseeded catalog this module's answers are WRONG
 * rather than absent. `<claude4spec_plan_mode>` classifies each mounted tool by
 * its `opClass`, and with no rows to read every tool looks alike. Idempotent, so
 * importing it from both places is safe.
 */
registerCoreOperations();
import { INTERACTION_RULES } from './interaction-rules.js';
import { resolvePluginSubagents, sanitizeSubagentDefinition } from './plugin-subagents.js';

/* ─────────────────────────── M05 m05ctxreg: context-type registry ───────────────────────────
 * Single code-level constant map (spec `m05ctxreg`), keyed by `context_type`, deciding the five
 * per-thread dimensions. This is the ONE source of truth: `buildSystemPrompt`/`subagentsFor`
 * (here), the dispatcher (`routes/agent-turn.ts`), and the enum validator (`services/chat.ts`)
 * only CONSUME it. Adding a context_type = one row here + extending the `ChatContextType` union
 * in `shared/entities.ts` — no edits to dispatch logic. NOT a SQLite table: the values are code
 * artifacts (bundled skills, MCP servers, React chrome, SubagentDefinition). */

/**
 * 0.2.13 — `McpServerSet` moved to `operations/profiles.ts` and is now DERIVED
 * from the context profile's admitted operation classes rather than written out
 * per row. Re-exported here because this module's consumers have always named it
 * from this path.
 *
 * The direction of the dependency is the point: a profile declares which classes
 * of catalog operations it admits, and the mounted server set falls out of that.
 * Written side by side, the two drifted — the registry could say `planTools:
 * true` for a profile whose operation set had no plan entries, and nothing
 * disagreed.
 */
export type { McpServerSet } from '../operations/profiles.js';

/** One registry row — the six dimensions spec `m05ctxreg` dispatches per thread. */
export interface ContextTypeEntry {
  /** Dim 1 — M37: hardcoded contextual skills attached to `inlineSkills` on top of
   *  `config.writingStyle` (which `resolveForContext` auto-appends to every context
   *  type — deliberately not listed here) and on top of the unconditional fan-out of
   *  plugin-contributed contextual skills (likewise not listed: it is the same for
   *  every row). 0.2.19 emptied this for `brief` and `patch` — a mode's identity is
   *  dim 6 below, not a skill — leaving exactly one entry in the whole catalogue.
   *  None of these gets a `<project_skill>` block; that slot belongs to the writing
   *  style alone. */
  attachInternalSkills: string[];
  /** Dim 2 — which MCP servers mount in `adapter.execute({ mcpServers })`. */
  mcp: McpServerSet;
  /** Dim 3 — chat-overlay chrome. Declarative marker only: the frontend `ChatOverlay.tsx`
   *  switches on `contextType` directly; this records the dimension, no backend consumer. */
  uiChrome: 'overlay' | 'brief-detail';
  /** Dim 4 — read-only `SubagentDefinition` injected into `adapter.execute({ subagents })`. */
  subagent: 'spec-explore' | 'diff-explore';
  /** Dim 5 — builtin posture. `'force-plan'` pins `planMode=true` regardless of the thread's
   *  `plan_mode` flag (read-only peer); `'follow-thread'` tracks the flag. */
  builtinPosture: 'follow-thread' | 'force-plan';
  /** Dim 6 (0.2.19) — the body of `<interaction_context type="…">`: the domain rules of
   *  this interaction type. The TEXT is owned by the module that owns the genre (M21
   *  brief / M23 patch / M11 ask) and lives in `interaction-rules.ts`; M05 only renders
   *  it. `chat` carries none, and an empty body is a legitimate value — the block is
   *  emitted regardless, self-closing, because a missing block would be indistinguishable
   *  from "this concept does not exist". */
  interactionRules: string;
}

/**
 * The registry. Rows reproduce the spec `m05ctxreg` table 1:1; this refactor is
 * behavior-preserving, so each row dispatches exactly what the prior scattered
 * `isBrief`/`isPatch`/`isAsk` conditionals did.
 */
export const CONTEXT_TYPE_REGISTRY: Record<ChatContextType, ContextTypeEntry> = {
  chat: {
    attachInternalSkills: ['writing-style-author'],
    mcp: mcpServerSetForProfile('chat'),
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: PROFILES.chat.builtinPosture,
    interactionRules: INTERACTION_RULES.chat,
  },
  brief: {
    // 0.2.19: was `['brief-author']`, forced. The skill no longer exists: its identity
    // half became `interactionRules` below, its methodology half belongs to the active
    // writing style's `workflows/brief.md`.
    attachInternalSkills: [],
    mcp: mcpServerSetForProfile('brief'),
    uiChrome: 'brief-detail',
    subagent: 'diff-explore',
    builtinPosture: PROFILES.brief.builtinPosture,
    interactionRules: INTERACTION_RULES.brief,
  },
  patch: {
    // 0.2.19: was `['patch-implementer']`, forced — same split as `brief` above.
    attachInternalSkills: [],
    mcp: mcpServerSetForProfile('patch'),
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: PROFILES.patch.builtinPosture,
    interactionRules: INTERACTION_RULES.patch,
  },
  ask: {
    // Full `chat` toolset MINUS c4s-tools MINUS transagent-tools (recursion guard: a consulted
    // peer cannot consult/delegate to another peer). Read-only enforced via forced plan-mode.
    //
    // 0.2.13 sharpens that from a posture into a gate: the `ask` profile admits
    // only the `read` and `plan` operation classes, so the WRITE tools of the
    // mounted plugin servers are filtered out of `tools/list` rather than merely
    // being discouraged by forced plan mode. A peer may leave a plan; it cannot
    // mutate the spec it was consulted about.
    attachInternalSkills: [],
    mcp: mcpServerSetForProfile('ask'),
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: PROFILES.ask.builtinPosture,
    interactionRules: INTERACTION_RULES.ask,
  },
};

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
  currentPageBody: string | null;
  /** Counts indexed by entity-plugin type. Example: `{ endpoint: 12, dto: 5 }`. */
  entityCounts: Record<string, number>;
  tagCount: number;
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
   * This is the sole source of the prompt's `<project_skill>` block, and there is
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

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function attrs(o: Record<string, string | number | undefined | null>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}="${escapeAttr(String(v))}"`)
    .join(' ');
}

function selfClose(name: string, attrsStr: string): string {
  return attrsStr ? `<${name} ${attrsStr}/>` : `<${name}/>`;
}

/**
 * 0.1.96 multiroot: serialize the `roots="…"` attr on `<project>`. Format is a
 * `;`-separated list of `id=dir` pairs: the built-in `pages` root first, then
 * every user root in `roots[]` order. Example: `pages=pages;adr=docs/adr`.
 *
 * The `id=dir` shape is the point of the attribute and the reason it survives
 * unabbreviated: this is the ONLY place in the prompt that binds a root
 * IDENTIFIER — the token every page tool takes as `rootId` — to a directory.
 * `<agent_path_scope>` names the same directories and no identifiers, which
 * makes it useless for constructing a call.
 *
 * 0.2.50 — `briefs=` and `patches=` are gone. They were listed "for the agent's
 * spatial map" while being neither roots nor reachable: `rootId: "briefs"`
 * answers ROOT_NOT_FOUND ("active roots: […]"), and `<agent_path_scope>` names
 * both directories as ALWAYS DISALLOWED. An attribute called `roots` carrying
 * two entries that are not roots, cannot be passed anywhere, and are forbidden
 * to touch is worse than an attribute that omits them: it invites exactly one
 * kind of call, and that call fails.
 */
function buildRootsAttr(roots: Root[]): string {
  const parts: string[] = [];
  const pagesRoot = roots.find((r) => r.id === 'pages');
  if (pagesRoot) parts.push(`pages=${pagesRoot.dir}`);
  for (const r of roots) {
    if (r.id === 'pages') continue;
    parts.push(`${r.id}=${r.dir}`);
  }
  return parts.join(';');
}

function buildEntityRows(pluginHost: ProjectPluginHost): string {
  // Each active plugin contributes one <entity> row; empty roleNoun = opt-out
  // (legacy ui-view behaviour). Row body uses narrativeBlock when present,
  // otherwise falls back to the plural roleNoun.
  const rows: string[] = [];
  for (const m of pluginHost.listEntities()) {
    if (!m.systemPrompt.roleNoun) continue;
    const body = m.systemPrompt.narrativeBlock ?? m.systemPrompt.roleNoun;
    rows.push(`  <entity type="${m.type}">${body}</entity>`);
  }
  // rows.push('  <entity name="tag">Cross-cutting categorization (color, slug)</entity>');
  return rows.join('\n');
}

function buildEntityEmbedTypeUnion(pluginHost: ProjectPluginHost): string {
  // Used inside the entity_embeds section, e.g. "endpoint|dto|database-table".
  // Falls back to a sensible default when no plugins are active.
  const types = pluginHost
    .listEntities()
    .filter((m) => m.systemPrompt.roleNoun)
    .map((m) => m.type);
  return types.length > 0 ? types.join('|') : 'entity';
}

/* ─────────────────────────── LAYER A — the frame ───────────────────────────
 *
 * 0.2.50 — `<claude4spec_identity>` used to be a single 15 KB template literal
 * holding thirteen sub-blocks: the identity paragraph, the entity catalogue, the
 * embed grammar, the linking discipline, discovery, the change protocol, the
 * delegation heuristic, tags, TODOs, diagram referencing, anchors, and handling
 * instructions for two blocks that appeared seven hundred lines further down.
 * The order recorded when each was written, and nothing else.
 *
 * They are separate builders now, assigned to layers (see `MAIN_PROMPT_BLOCKS`
 * at the bottom of this file), so that a block sits next to what it talks about
 * and the order is a value you can read rather than a history you have to
 * reconstruct. `identity` keeps the four sentences that are actually identity.
 */
function buildIdentity(projectName: string): string {
  return `<claude4spec_identity>
You are a specification writing assistant for project "${projectName}". The user is editing a specification that consists of markdown pages and structured entities. The pages are markdown on disk; the entities are structured records reached only through MCP tools. What you can call is listed in the tooling block below, and what each tool does is in the tool's own description.
</claude4spec_identity>`;
}

/* ─────────────────────────── LAYER B — this project ─────────────────────── */

/**
 * 0.2.50 — the rows state RULES; the closing line says where the SHAPES are.
 *
 * Every row used to open by enumerating the type's fields, its enums and which
 * read carries its content. All of that is what `describe_entity_type` returns,
 * and it returns it DERIVED from the declared data schema — so the tool's answer
 * cannot drift from what the host enforces, while a hand-written preview of it
 * can and did. Naming the tool once costs a line and is always current; the
 * rows keep only what the tool does not answer: when to reach for the type, and
 * the conventions no validator enforces.
 */
function buildEntitiesBlock(pluginHost: ProjectPluginHost): string {
  const schemaPointer =
    '  Call describe_entity_type(type) for a type\'s fields, enums, required-ness and which reads ' +
    'carry which — before your first write of a type. The rows above state RULES, not shapes.';
  return `<entities>\n${buildEntityRows(pluginHost)}\n${schemaPointer}\n</entities>`;
}

/* ─────────────────────────── LAYER D — writing conventions ───────────────── */

/**
 * The embed grammar, and — since 0.2.50 — the linking discipline that used to
 * stand beside it as `<entity_linking_rule severity="mandatory">`.
 *
 * The two were one rule written twice. The five-way decision tree ("pick the
 * smallest tag that fits") appeared in full in both blocks, and a third time in
 * `interaction-rules.ts`. What the linking rule added beyond the duplication was
 * a "pre-edit self-check": sweep every draft with two regexes, verify each hit
 * with a separate tool call, and — for a hit you decide to leave alone — "state
 * the exemption to yourself". For a paragraph naming five HTTP paths that is
 * five MCP round-trips before one write, using two tools that do not exist
 * (`get_endpoint`, `get_dto`), plus an instruction with no observable form.
 *
 * The rule's own justification does survive, and is kept: prose-named entities
 * really are invisible to `find_references`. But it is stated as what it is.
 * `severity="mandatory"` claimed an enforcement that has no enforcer — none of
 * `check_consistency`'s fourteen rules reads prose, so nothing anywhere reports
 * a violation. A rule nobody can check is advice, and calling it mandatory only
 * teaches the agent that severities are decoration.
 */
function buildEntityEmbeds(pluginHost: ProjectPluginHost): string {
  const embedTypeUnion = buildEntityEmbedTypeUnion(pluginHost);
  return `<entity_embeds severity="recommended">
Pages can embed live entity views as self-closing XML tags. The Tiptap editor renders each tag as a rich UI widget that fetches fresh data from the spec — the embed stays in sync as the entity changes, so you never duplicate field or column lists into prose.

When an entity that exists in the spec is named in prose, link it with a tag instead of typing the bare name. This is not a formatting preference: \`find_references\` reads tags, so a prose-named entity has no incoming references and goes stale silently as slugs and paths change. Nothing reports this — no consistency rule reads prose — which is exactly why it has to be a habit rather than something you expect to be told about.

Pick the smallest tag that fits:

  <inline_mention type="${embedTypeUnion}" slug="..."/>
    Inline chip inside a sentence. Use when naming an entity in flowing prose. Valid inside entity descriptions too, and it renders in your chat replies as well as in pages.

  <single_element type="..." slug="..." caption="..."/>
    Block card with the entity's full detail view. Use when this page documents that specific entity. The optional \`caption\` is per-reference prose and works for EVERY entity type, so the same entity can be framed differently in two places.

  <element_list type="..." slugs="a,b,c"/>
    Static block list of hand-picked entities, fixed order. Use when the reader should see exactly these N items.

  <tagged_list type="..." tags="x,y" filter="and|or"/>
    Dynamic block list filtered by tag — auto-updates as entities are tagged and untagged. Use to surface e.g. "all DTOs tagged auth" without maintaining the list by hand.

  <tagged_list_mixed tags="x" filter="and|or"/>
    Like tagged_list, but spans every ACTIVE entity type sharing the tag(s). Use to show a cross-cutting feature slice.

Bare prose is right in three cases: the name itself is the SUBJECT of the sentence (naming conventions, escape syntax, the tag grammar); the thing named is not a registered entity (a plugin is disabled, or the value is illustrative); or it sits in a code fence showing literal source or SQL, where mid-fence embeds would be noise.

Slugs are kebab-case, and the kebab/snake mismatch is the common trap — a table written \`user_account\` is the entity \`user-account\`. Resolve the slug with \`search_entities\` or \`list_entities\` before you embed it; a wrong slug renders as a broken widget, and a wrong slug passed to \`find_references\` answers \`[]\`, which reads exactly like "nothing uses this".
</entity_embeds>`;
}

/**
 * Discovery and impact, in one block.
 *
 * 0.2.50 merged three: `<entity_discovery severity="recommended">`,
 * `<entity_change_protocol severity="mandatory">` and the threshold half of
 * `<delegation_policy>`. They overlapped by roughly sixty per cent — the same
 * four channels were enumerated twice in two different wordings, each block
 * carrying a pointer to the other — and much of what remained was a paraphrase
 * of `find_references`'s own tool description, which the model receives anyway.
 *
 * Two claims were removed rather than reworded, because the host had already
 * done the work they asked for: "for renames, propose propagation" (a rename
 * through `update_entities` calls `propagateSlugChange` itself) and "for
 * deletes, show what will break" (`delete_entities` returns `brokenReferences`
 * per entity). Both told the agent to offer something it cannot withhold.
 *
 * What survives from the mandatory half is the part that genuinely cannot be
 * read off a tool description: show the user the impact BEFORE mutating.
 *
 * 0.2.57 — the delegation paragraph NO LONGER NAMES A SUBAGENT.
 *
 * It used to say `spec-explore`, and that was a thumb on the scale: naming the
 * host's own definition in the parent's prompt structurally favours it over one
 * a plugin contributes, whatever the two descriptions say. Since a writing
 * style can now ship an explorer that knows the specification's organisation —
 * something the built-in cannot know — the parent must choose on `description`
 * alone. The host emits no `<available_subagents>` block either (it never has);
 * the roster reaches the model as the SDK's own system-reminder.
 */
function buildDiscoveryAndImpact(): string {
  return `<discovery_and_impact severity="mandatory">
Before answering a question about how things connect, planning a change, or orienting yourself in an unfamiliar area, query the graph rather than reasoning from memory. The graph knows who uses what; pattern-matching does not.

Four channels, each finding a different KIND of reference. Which ones you need depends on the question; concluding "nothing uses this" requires all four:
  1. \`find_references\` — direct XML refs. It also covers dynamic tag consumers when you pass \`includeTagMatches: true\`, which folds channel 2 into the same call and marks each row with what matched.
  2. Tag membership — \`list_entities({ tags, tagFilter })\` for what carries a tag, and \`list_tags({ coOccurringWith })\` for the tags that travel with it. The second is how you learn a taxonomy you do not already know.
  3. Structured links between entities — the typed relations a type declares (its type carries its own tools), plus \`check_consistency\`, which reports the ones that dangle.
  4. Prose drift — search the pages for the entity's HTTP path, class name or table identifier, to catch what an author wrote as bare text instead of a tag.

Ground the answer on what came back, not on what you remember. If you skipped discovery, say so ("answering from thread context, not querying the graph") — silence looks identical to forgetting.

MUTATION IS THE STRICT CASE. Before any \`update_*\`, \`delete_*\`, slug rename or re-tag on an active entity, run the channels and PRESENT THE IMPACT TO THE USER FIRST: which pages link it, which dynamic lists surface it, which entities point at it, where the prose names it — counts and specific paths or anchors, not a summary. Then mutate. This is the one part of this block you cannot infer from a tool description, because it is about who decides, not about what the tools do. "It is only a slug rename" is precisely the case that breaks the most pages.

Delegate a sweep spanning more than one channel, or a first look at an unfamiliar area, to an explorer subagent: it reads the bulk in its own context and returns paths, anchors and slugs. One targeted lookup you do yourself. The parent synthesizes; the subagent locates. Choose the explorer by its OWN description — the roster you were given is the authority on which ones exist here, and one of them may know this specification's organisation better than the general-purpose one does.
</discovery_and_impact>`;
}

/**
 * 0.2.50 — rewritten from a description of the DATABASE ENTITY to a description
 * of the USE.
 *
 * The old block opened on "a tag is a slug plus a color, no FK, no owned data" —
 * schema trivia, and colour in particular is a UI concern the agent cannot see
 * and has no basis to choose. Then a three-step "workflow" whose every step was
 * wrong: `create_tag(slug, color)` (the real first parameter is `name`, so the
 * call as written fails validation), `tag_entity(type, slug, tagSlug)` (the real
 * parameter is a LIST), and a mandatory "define once globally" step that
 * `tag_entity` performs by itself.
 *
 * Meanwhile the thing that makes tags worth having — that they are a query index
 * ACROSS entity types — was never stated, and the two tools that realize it
 * (`list_tags({ coOccurringWith })`, the `tags` filter on `list_entities`) were
 * not mentioned at all.
 */
function buildTags(): string {
  return `<tags>
A tag is a cross-cutting label attached to any number of entities of any type. Its use is that it is an INDEX ACROSS TYPES: the one way to ask "what belongs to this feature" and get back endpoints, DTOs, tables and criteria together, when nothing structural relates them.

It reaches you through three channels, and they answer different questions:
  - \`list_entities({ tags, tagFilter: 'and' | 'or' })\` — the tag as a QUERY, composable with that type's own field filters.
  - \`list_tags({ coOccurringWith })\` — the tags sharing entities with a given tag. This is how you discover a project's taxonomy without already knowing it.
  - \`find_references({ includeTagMatches: true })\` — which PAGES surface an entity through a dynamic list.

Attach with \`tag_entity\`, which takes a LIST and creates any tag it does not find, so a separate registration step is not needed. Reach for \`create_tag\` only to give a tag a \`description\` — the one field that records what the tag MEANS, and the only thing that keeps a taxonomy legible to whoever inherits it.

On a page, consume a tag with \`<tagged_list type="..." tags="auth"/>\` for one type or \`<tagged_list_mixed tags="auth"/>\` across all of them; both re-render as entities are tagged and untagged. Tags are for groupings that cut ACROSS the structure — use an entity's own structural fields and links for relationships between specific entities.
</tags>`;
}

const TODO_MARKERS = `<todo_markers>
  <todo comment="..."/>
Lightweight inline TODO marker. Lives only in markdown — never persisted as an entity. To survey open TODOs, Grep pages/ for \`<todo comment=\`.
</todo_markers>`;

/**
 * 0.2.50 — two changes, both about closing the gap between what this block asks
 * and what the tools do.
 *
 * It used to end by telling the agent to discover an anchor by READING THE WHOLE
 * PAGE and picking the comment line out of it, while `get_page_outline` and
 * `search_pages` exist to answer exactly that and cost a fraction as much.
 *
 * And it described the anchor rule as a discipline, without mentioning that
 * `update_sections` ENFORCES it: dropping an anchor refuses the whole batch with
 * ANCHOR_LOSS unless the anchors are named in `dropAnchors`. An agent that knows
 * the guard exists reads a refusal as information; one that does not reads it as
 * an obstacle and looks for a way around, which here means a built-in write.
 */
const SECTIONS_AND_ANCHORS = `<sections_and_anchors>
Every markdown heading carries an immutable 8-char anchor on the line before it: \`<!-- anchor: xxxxxxxx -->\`. The indexer assigns them — do not invent, edit or strip one. When you rename a heading or move a section, keep heading, anchor and body glued together; the indexer recognizes the move and the versioning subsystem records it. Never leave "(moved to MXX)" breadcrumbs behind: move history belongs to the versioning system, not to the prose.

This is enforced where it matters. \`update_sections\` refuses the ENTIRE batch with ANCHOR_LOSS if a write would drop an anchor, unless you name that anchor in \`dropAnchors\` — so an accidental loss is a refusal, and a deliberate removal is something you say out loud. Read a refusal as the guard doing its job rather than as an obstacle to route around.

To find an anchor, ask for it: \`get_page_outline\` enumerates them for a page as a tree, and \`search_pages\` finds the sections matching a phrase and hands back their anchors. Reading a whole page to grep for the comment line is the expensive way to the same string.

To LINK a section, embed \`<section_ref anchor="xxxxxxxx"/>\`. It renders as a clickable chip in BOTH pipelines — Tiptap (the page editor) and react-markdown (your chat replies, plan blame, annotation popups) — so it is the right tool whether you are editing a page or answering the user here. Anchors are globally unique, so the anchor alone suffices; no path needed. Prefer it over prose like "see section X in pages/foo.md": the ref survives heading rewrites and cross-file moves, and the prose does not. For whole-page links, use \`@pages/foo.md\` (or \`@pages/foo.md#xxxxxxxx\`) in markdown pages; in chat replies that form does NOT render as a chip, so use a plain markdown link or point at a section with \`<section_ref/>\`.
</sections_and_anchors>`;

/* ─────────────────────────── LAYER E — current state ─────────────────────── */

/**
 * 0.2.56 — the block stops sending a long page down the whole-page path.
 *
 * It used to answer "the rest is missing" with `get_page`, which reads the entire
 * file to hand back a preview's worth of what was wanted — and on a page over the
 * response budget comes back truncated anyway. `get_page_outline` answers the same
 * question for a fraction of it, hands back the anchors to fetch, and carries the
 * page `hash` on its envelope, so the sectional route now closes on a write rather
 * than stopping one call short of one.
 *
 * What it must never name is a filesystem read. `agent.disableDirectFilesystemAccess`
 * defaults to TRUE, which removes `Read` from the catalogue outright — a prompt
 * pointing there is pointing at a tool the agent does not have.
 */
const CURRENT_PAGE_HANDLING = `<current_page_handling>
\`<current_page>\` is what the user is looking at right now. It carries the page's \`path\` and its \`root\` — and you need both, because \`get_page\` without a \`rootId\` answers INVALID_ARGUMENT. Long pages are inlined only as a preview (see the \`preview_lines\` / \`total_lines\` attributes). To see the rest, prefer the sectional route where it is open to you: \`get_page_outline({ rootId, path })\` returns every section as a tree with its size and its anchor, and its envelope carries the page's \`hash\`; then \`get_sections({ anchors })\` reads only the ones you actually need. That route needs a SECTION-INDEXED root — on any other root \`get_page_outline\` answers INVALID_ARGUMENT and \`get_page\` is the only way through. The truncation notice inside \`<current_page>\` already names whichever route applies to the page you are looking at; follow it rather than guessing. Use \`get_page\` when you genuinely need the whole page. Either way you end up holding the \`hash\` that \`update_page\` and \`update_sections\` require as \`expectedHash\`, so editing a page never depends on reading all of it.
</current_page_handling>`;

/**
 * 0.2.50 — the block gained the trap, which is the whole reason it is worth its
 * space.
 *
 * An annotation's `text` is the user's SELECTION as Tiptap rendered it, not as
 * the markdown was authored. It looks like a ready-made `textEdits.find`, and
 * for an unformatted sentence it happens to work. Over anything carrying
 * emphasis, a link or an embed, the rendered text and the source text are
 * different bytes, `find` is literal, and the call answers FIND_NOT_FOUND — a
 * failure whose cause is invisible from where the agent stands.
 */
const ANNOTATION_HANDLING = `<annotation_handling>
When the request carries \`<annotations>\`, they are the primary context for the user's message — address each one specifically. Before answering about a page other than the current one, open it: \`get_page\` needs a \`rootId\` as well as a path. An annotation on the current page carries its \`root\`; one without that attribute came from elsewhere and does not know its root — find it with \`list_pages\` rather than assuming \`pages\`.

Do NOT paste an annotation's \`text\` into \`textEdits.find\`. That text is the user's selection as RENDERED, while \`find\` matches the source literally, byte for byte — so any emphasis, link or embed inside the selection makes the two differ and the edit fails FIND_NOT_FOUND. Read the source around the annotation and build the find-string from what is actually written there.
</annotation_handling>`;

/* 0.2.50 — `<plan_tools_usage>` and `<c4s_tools_usage>` are GONE, and so is the
 * category they belonged to: a prompt block explaining how to use one MCP
 * server.
 *
 * Every claim in the pair already had a home in the description of the tool it
 * described — that the peer is read-only, that `project` and `server` are
 * alternatives with `server` winning, that a peer thread continues by
 * `threadId`, that plan-tools are thread-scoped and take no `threadId`, that MCP
 * survives plan mode. The model receives those descriptions through `tools/list`
 * on every turn, so the blocks bought a second copy and the chance of the two
 * disagreeing. They took it: `<c4s_tools_usage>` still described entity edits as
 * "soft-blocked at prompt level", which stopped being true in 0.2.13 when the
 * `ask` profile began filtering write tools out of `tools/list` outright.
 *
 * The rule this leaves behind: `<tooling>` is an INVENTORY OF NAMES, and what a
 * tool does lives in `McpToolDeclaration.description`. There is no third place.
 * The one sentence in the pair with no home — when to call `update_plan` outside
 * plan mode — moved into that tool's description, where it says "when to call
 * me", which is what a description is for.
 */


/**
 * M21: usage contract for the `brief-tools` MCP server.
 * Mounted only when this chat thread has `context_type='brief'`. The editorial
 * doctrine is split in two since 0.2.19: the genre's domain rules arrive in
 * `<interaction_context type="brief">` (M21), the methodology in the active
 * writing style's `workflows/brief.md`. This block is neither — it describes the
 * tool surface, so the agent knows what is callable in this thread.
 */
const BRIEF_TOOLS_USAGE = `<brief_tools_usage>
brief-tools is scoped automatically to this brief — there is no path parameter, and no way to reach another brief from this thread.
  - get_brief — the brief as { frontmatter, body, content, hash }.
  - update_brief (action: replace | append | insert_after_section) — edits the body.
      * frontmatter is IMMUTABLE for you (type, from_release, to_release, generated_at, generator_version).
      * expectedHash is REQUIRED: pass the hash get_brief returned (stale → BRIEF_CONFLICT, missing → VALIDATION).
      * insert_after_section MISSES SILENTLY. A target it cannot find — an anchor that is not in the brief, a heading that matches nothing — is NOT an error: the fragment is appended at the END of the brief and the call reports success. Nothing warns you. So read the brief before addressing a section, and check afterwards that the text landed where you meant it to.
</brief_tools_usage>`;

/**
 * The plan-mode tool policy, taken straight from agent-adapters (0.9.6, M18
 * deny-groups). `planMode: true` IS `PLAN_MODE_DENY_GROUPS`, and
 * `buildClaudeCodeToolPolicy` is the same function the adapter calls to turn
 * those groups into `options.tools` / `options.disallowedTools` — so the lists
 * interpolated below are a 1:1 mirror of actual gating, not a hand-maintained
 * paraphrase that can drift (see 0-1-125-to-next follow-up).
 *
 * The groups are non-empty, so the policy is never `undefined`; the guard exists
 * so a future contract change fails loudly instead of rendering an empty list
 * into the prompt.
 */
const PLAN_MODE_TOOL_POLICY_OR_NULL = buildClaudeCodeToolPolicy(PLAN_MODE_DENY_GROUPS);
if (!PLAN_MODE_TOOL_POLICY_OR_NULL) {
  throw new Error('plan-mode tool policy is empty — the agent-adapters gating contract changed');
}
/** Narrowed once here: the block below is a function now, and a module-level
 *  `if`-throw does not narrow across a function boundary. */
const PLAN_MODE_TOOL_POLICY = PLAN_MODE_TOOL_POLICY_OR_NULL;

/**
 * 0.2.50 — the MCP half of this block is reframed, and the reframing is the fix.
 *
 * It used to head a list of MCP tools "Forbidden (mutating)", beside the
 * built-in list under the same heading. For the built-ins that word is exact:
 * `planMode` desugars to `disallowedToolGroups: ['file-write','shell']` and the
 * adapter enforces it. For MCP it is false, and not by oversight. `gateServers`
 * takes `thread.contextType` and has never taken `planMode`; `profile-gate`'s
 * own doc comment says twice that forced plan mode "does not apply to MCP at
 * all"; the specification says the same in three separate places. The axes are
 * deliberately split — read-only is what the `ask` PROFILE buys, and a profile
 * is fixed for the life of a thread, while plan mode is a per-turn switch.
 *
 * So every entity, page and tag mutation IS mounted and callable here. Saying
 * "forbidden" about tools that answer when called is the exact thing
 * `profiles.ts` warns against, from the wrong side: "a gate, not a sentence in a
 * prompt asking the model not to". This block is a sentence asking the model not
 * to, and it should say so — a model that discovers one "forbidden" tool working
 * has been taught what the other prohibitions are worth.
 *
 * The list is generated rather than written. The old pattern
 * (`create_*`/`update_*`/`delete_*`/`link_*`/`unlink_*`) missed everything not
 * named that way: `file_patch`, `run_turn`, `abort_turn`, `release_create`,
 * `release_update`, and `ask`, which spends a whole turn in another project.
 * Deriving it from the mounted set and each tool's catalog `opClass` means it
 * cannot go stale or be partial. `plan`-class tools stay exempt by construction:
 * persisting the plan is the point of the mode.
 */
const PLAN_MODE_EXEMPT_CLASSES: ReadonlySet<string> = new Set(['read', 'plan']);

function planModeMutatingTools(inventory: readonly McpInventoryEntry[]): string[] {
  const names = new Set<string>();
  for (const server of inventory) {
    for (const tool of server.tools ?? []) {
      const op = CATALOG.get(tool);
      /**
       * A row counts only if it describes the surface the tool arrived on —
       * the same test `toolAdmittedByProfile` applies, for the same reason.
       * `CATALOG` is keyed by bare name, so a plugin shipping a tool called
       * `update_plan` or `get_page` would otherwise inherit that host row's
       * `plan`/`read` class and be exempted from this list, while the `chat`
       * profile mounts it and its own mutating handler runs.
       */
      const applies = op && (server.plugin ? op.contributedBy === 'plugin' : op.contributedBy !== 'plugin');
      /**
       * With no applicable row, the surface decides — and the two surfaces get
       * opposite defaults, which is the same asymmetry the gate settles on.
       *
       * A HOST tool with no row is not listed. Over-listing is not caution here,
       * it is a false prohibition, and a model that finds one "forbidden" tool
       * working learns what the rest of the prohibitions are worth. The one
       * host-owned tool with no catalog row is `load_skill_file`, deliberately,
       * and telling the agent not to call it in plan mode would contradict
       * <project_writing_skill>, which instructs it to.
       *
       * A PLUGIN tool with no applicable row IS listed. The host has never seen
       * that surface, `chat` admits writes so the gate passed it through, and
       * the cost of guessing wrong runs the other way: a plugin write nobody
       * asked the agent to hold off on. The price is a false prohibition on an
       * undeclared plugin read — visible, and fixed by declaring it.
       */
      if (!applies) {
        if (server.plugin) names.add(tool);
        continue;
      }
      if (PLAN_MODE_EXEMPT_CLASSES.has(op!.opClass)) continue;
      names.add(tool);
    }
  }
  return [...names].sort();
}

function buildPlanMode(inventory: readonly McpInventoryEntry[]): string {
  const mutating = planModeMutatingTools(inventory);
  return `<claude4spec_plan_mode>
Plan Mode is ACTIVE. Investigate and propose — do not modify.

The plan you draft must conform to the writing style referenced in <project_writing_skill/>. Before drafting or updating the plan, ensure load_skill_file(slug) has been called this turn — its conventions constrain every line of the plan. If the user's request appears to violate them, surface the conflict in the plan rather than quietly working around it.

The built-in file and shell tools are GATED OFF for this turn — not discouraged, unavailable:
  - Denied: ${PLAN_MODE_TOOL_POLICY.deny.join(', ')}
  - Available: ${PLAN_MODE_TOOL_POLICY.allow.join(', ')}

The MCP tools are a different matter, and you should know exactly how. Plan mode does not gate them at all — the tools below are mounted and WILL execute if you call them. This is an instruction, not a barrier:
  - Do not call: ${mutating.length > 0 ? mutating.join(', ') : '(none mounted this turn)'}
  - plan-tools are the exception, and the point: persist the plan with update_plan rather than writing it out as prose in your reply.

End your response with a concrete, numbered plan the user can review and approve before execution. If a request clearly requires mutation, describe what you would do — do not do it.
</claude4spec_plan_mode>`;
}

// Every built-in agent-adapters knows about — a sourced, generated list rather
// than a hand-maintained one (see 0-1-125-to-next follow-up). 0.9.6 exports the
// full catalog directly, so this no longer has to be reconstructed as a union of
// the two plan-mode halves (which omitted BashOutput / KillShell / MultiEdit /
// NotebookRead).
const CLAUDE_CODE_ALL_BUILTINS = claudeCodeKnownBuiltins();

/**
 * 0.2.50 — `<tooling>` is DERIVED from the servers this turn actually mounted,
 * not described alongside them.
 *
 * What it replaced: a hardcoded `entity-tools` literal, a loop over each entity
 * type's `mcpToolsLine`, a hardcoded `reference-tools` literal, an unconditional
 * `skill-tools` literal, and two more literals behind boolean flags the caller
 * had to remember to set. Six ways for the prompt to describe a set it was not
 * reading, and it used them: `page-tools` appeared in NONE of them, in a prompt
 * whose path-scope block tells the agent to write pages with `create_page` and
 * `update_sections`. `workspace-tools`, `patch-tools`, `transagent-tools` and
 * `mark_plan_applied` were invisible for the same reason — the loop enumerated
 * ENTITY TYPES, so a host-owned server that is not an entity type could not
 * appear however long it had been mounted.
 *
 * The input is now the post-gate mount itself (see `mcpInventory`), so a new
 * tool reaches the prompt by existing, and a tool the profile withholds cannot
 * be advertised. A server that declares no tools renders as its bare name: the
 * `tools?` contract means "I cannot enumerate this", and the honest rendering of
 * that is silence about the contents, not an invented list.
 *
 * The `<builtin>` line still prints the full catalog even in plan mode, where
 * the file-write and shell groups are gated off. That is deliberate and stated
 * where it belongs: `<claude4spec_plan_mode>` names both halves of the split, so
 * this line is an inventory of what the adapter knows and that block is the
 * policy for the turn.
 */
function buildTooling(inventory: readonly McpInventoryEntry[], builtinsEnabled: boolean): string {
  /**
   * 0.2.50 — the `<builtin>` line says what it IS.
   *
   * It prints the adapter's whole catalog, which two other blocks then narrow:
   * `<claude4spec_plan_mode>` gates the file-write and shell groups off for the
   * turn, and `<available_skills>` prohibits `Skill` outright. Printed bare, the
   * line read as a permission list, and the prompt then contradicted itself
   * twice over — most visibly on `Skill`, advertised here as available and
   * forbidden by another block. Naming it an inventory costs six words and
   * removes the contradiction without pretending a mounted tool is absent.
   *
   * The note says "elsewhere in this prompt" rather than "below": the two blocks
   * that narrow it sit on either side of this one — `<available_skills>` is
   * layer B and `<claude4spec_plan_mode>` layer E — and a direction the reader
   * can check is a direction that can be wrong.
   */
  /**
   * 0.2.53 — the line now has two states, and only ONE flag moves it.
   *
   * With `agent.disableDirectFilesystemAccess` on, the file and shell built-ins
   * are gone from the model's catalog for the whole thread, so printing them as
   * "what the adapter knows" would be inventorying tools that do not exist here.
   * The gated list is DERIVED from the same `buildClaudeCodeToolPolicy` the
   * adapter itself calls, so it is a 1:1 mirror of the actual gating rather than
   * a hand-maintained paraphrase that can drift — the same trick as
   * `PLAN_MODE_TOOL_POLICY` above.
   *
   * Plan mode deliberately does NOT move this line, though it denies groups too:
   * it is a per-turn switch whose split `<claude4spec_plan_mode>` states in full,
   * and that division of labour (inventory here, policy there) is what the 0.2.50
   * note above bought. The flag is a different kind of fact — the tools are
   * absent for the thread's whole life — so it belongs in the inventory.
   */
  const builtins = builtinsEnabled
    ? CLAUDE_CODE_ALL_BUILTINS
    : (buildClaudeCodeToolPolicy(DIRECT_FILESYSTEM_DENY_GROUPS as ToolGroup[])?.allow ?? []);
  const lines: string[] = [
    `<tooling>`,
    `  <builtin note="what the adapter knows; other blocks in this prompt narrow it">${builtins.join(', ')}</builtin>`,
  ];
  for (const { name, tools } of inventory) {
    lines.push(
      tools && tools.length > 0
        ? `  <mcp name="${name}">${tools.join(', ')}</mcp>`
        : `  <mcp name="${name}"/>`,
    );
  }
  lines.push(`</tooling>`);
  return lines.join('\n');
}

/** True when the turn mounted a server under this name — the gate for the blocks
 *  that only make sense beside it (today: `<workspace_projects>` beside `c4s-tools`). */
function hasServer(inventory: readonly McpInventoryEntry[], name: string): boolean {
  return inventory.some((s) => s.name === name);
}

/* ─────────────────────────── 0.1.67 m05ctxreg: wbudowane subagenty ───────────────────────────
 * Czwarty wymiar rejestru `context_type`: który read-only subagent jest wstrzykiwany do
 * `adapter.execute({ subagents })`. Subagent przejmuje „bulk" eksploracji w swoim kontekście i
 * oddaje rodzicowi zwięzłe findings (ścieżki / anchory / slugi), zamiast całego zrzutu.
 *
 * Uwaga implementacyjna (drift vs brief): adapter NIE ma pola `mcp` per-subagent — dostęp do MCP
 * nadaje się przez nazwy `mcp__<server>__<tool>` w `tools` (subagent dziedziczy serwery MCP
 * zamontowane dla rodzica, a `tools` jest allow-listą). Read-only i brak zagnieżdżania
 * (Agent/Task) są wymuszone konstrukcją `tools` — zero narzędzi mutujących. */

/** English per "English UI/API messages": agent-facing instruction, same register as system prompt. */
const specExplorePrompt = (builtinsEnabled: boolean): string => `You are a read-only explorer of the CURRENT specification (pages + entities + sections).

Your job: explore on the parent's behalf and report CONCISE findings — file paths, section anchors, and entity slugs — never the full bulk you read. You exist to keep the parent's context small.

Tools: read-only spec operations on \`reference-tools\` — \`list_pages\` (which pages exist), \`search_pages\` (phrase or regex over the prose; modes are a cost ladder count -> map -> hits, and the DEFAULT is \`map\` — identity rows with no prose, so pass \`mode: \"hits\"\` explicitly when you need the text. A hit is a SECTION carrying \`matchCount\`; feed its \`anchor\` to \`get_sections\`. Narrow the scan with \`pathInclude\`/\`pathExclude\` before it opens files, or \`anchors\` to name sections outright), \`get_page_outline\` + \`get_sections\` (a page's headings as a tree, then the body of EVERY anchor you need in one call), \`get_page\` (a page as authored) — plus the read-only entity graph (get_*/list_*, find_references, check_consistency).${builtinsEnabled ? ' Read/Grep/Glob are also available for the rest of the repository.' : ' There are no built-in file tools here — every intent they would serve is covered above: list_pages for Glob, search_pages for Grep, get_page / get_sections for Read.'}

Truncation protocol for \`get_sections\` (you are the one who calls it in bulk, so you are the one who hits the budget):
- An item that came back with \`truncated: true\` carries \`edges\` — the outgoing references of the WHOLE section, including the part you did not receive: \`sectionRefs\` (anchors), \`entityEmbeds\` (type + slug), \`pageLinks\` (rootId + path).
- Such an item usually has NO \`body\` at all; one case keeps a partial one — a single section too large for the whole budget comes back clipped, with the prose it did fit. Keep and use that prefix; do not throw it away and re-fetch, you will get the same bytes back.
- Do NOT repeat the same batch. It will be cut at exactly the same place — the budget is spent in input order, deterministically.
- Instead, read the \`edges\` you were handed, pick the few anchors that actually lead to what the parent asked about, and call \`get_sections\` again with just those. Follow an embedded entity with \`get_entities\` using the \`slug\` from \`entityEmbeds\` rather than fetching the section again for it.
- An item with no \`edges\` is not a truncated one — it carried its whole body, and its references are in the prose you already have.

Hard rules:
- NEVER mutate anything (no create/update/delete; you have no such tools).
- Report pointers (paths / anchors / slugs), not dumps. The parent decides; you locate.`;

const diffExplorePrompt = (builtinsEnabled: boolean): string => `You are a read-only explorer of ONE SLICE of a HISTORICAL release diff, working for a parent that is authoring a release brief.

The parent hands you a slice — a \`from\`/\`to\` pair, an optional \`roots\` page-root scope, plus \`entityTypes\` and/or a \`limit\`/\`offset\` window. Your job: call \`release_diff\` for exactly that slice, absorb its heavy \`before\`/\`after\`/\`content\`, and return a CONCISE DISTILLATE: the concrete facts the parent must inline (each changed entity/section by name, its key signatures / field shapes / SQL / view URLs / file paths, and a one-line framing of the change — including deletions). The bulk stays with you; only the distillate goes back, keeping the parent's context small.

How to read your slice — three levels, in order:
1. WINDOWING (primary): call \`release_diff({ fromIdOrName, toIdOrName, roots, ...slice })\` and read the returned \`MCPReleaseDiff\` directly — the parent already windowed the slice to fit. The size of the window is the caller's choice: \`entityTypes\` / \`limit\` / \`offset\`.
2. EXPLICIT DEGRADATION: the operation TELLS you when it could not fit. An item past the budget comes back with its identity and \`truncated: true\` — an entity having lost \`before\`/\`after\` entirely, a section with \`content\` cut as text — and the envelope carries \`truncationHint\` naming the retry. When you see that marker, the slice you are holding is INCOMPLETE: follow the hint down (narrow \`entityTypes\`, lower \`limit\`, advance \`offset\`) and, if nothing else fits, \`summaryOnly: true\`, which is the guaranteed floor. Never report a truncated slice as if it were whole — absence of an item means "unchanged", and only the marker distinguishes that from "it did not fit".

- \`roots\` scope: if the parent gave you \`roots\`, pass it through verbatim on EVERY \`release_diff\` call — it narrows the PAGES dimension to the brief's scope. Dropping it silently widens the diff to all releasable roots and leaks out-of-scope pages into the brief.

Tools: \`release-tools\` MCP (\`release_diff\`; \`release_show\` / \`release_list\` available but rarely needed).${builtinsEnabled ? ' `Read` is also available, and is the LAST RESORT for a slice that will not fit any window: ask the parent for an on-disk dump and read that file. It is not a licence to read `pages/*.md` — see the hard rules.' : ' Nothing else — no filesystem, and that is structural rather than a promise: without `Read` you cannot reach `pages/*.md` at all, so the guarantee that you see ONLY the historical diff is enforced by your toolset instead of by this paragraph. It also means the on-disk-dump escape hatch is gone: `summaryOnly: true` is your floor.'}

Hard rules:
- Read ONLY \`release_diff\` output / release artifacts. NEVER read \`pages/*.md\` (current spec state) and NEVER touch the entity graph (get_*/find_references) — those return HEAD and would break the brief's historical self-containment.
- Return the distillate (facts to inline), not raw dumps and not bare pointers. NEVER mutate anything.`;

/** Enumerate read-only entity-graph MCP tools as `mcp__<server>__<tool>`. Parses each entity's
 *  `mcpToolsLine` exactly like {@link buildTooling} and keeps only get_ / list_ prefixed tools
 *  (drops mutating create_ / update_ / delete_ / link_ tools). Realizes the brief's get_/list_
 *  wildcards. */
function entityReadMcpTools(pluginHost: ProjectPluginHost): string[] {
  const tools: string[] = [];
  for (const m of pluginHost.listEntities()) {
    if (!m.systemPrompt.mcpToolsLine) continue;
    const colonIdx = m.systemPrompt.mcpToolsLine.indexOf(':');
    if (colonIdx === -1) continue;
    const serverName = m.systemPrompt.mcpToolsLine.slice(0, colonIdx).trim();
    const toolList = m.systemPrompt.mcpToolsLine.slice(colonIdx + 1).trim();
    for (const raw of toolList.split(',')) {
      const tool = raw.trim();
      if (/^(get|list)_/.test(tool)) tools.push(`mcp__${serverName}__${tool}`);
    }
  }
  return tools;
}

/** `spec-explore`: read-only exploration of the current spec (entity graph). Built per-turn
 *  because the entity-graph toolset depends on which entity plugins are mounted. */
function buildSpecExploreSubagent(pluginHost: ProjectPluginHost, builtinsEnabled: boolean): SubagentDefinition {
  return {
    name: 'spec-explore',
    description:
      'Read-only explorer of the CURRENT spec (pages, entities, sections). Delegate to it to LOCATE things — paths, section anchors, entity slugs — without pulling bulk into your own context. Returns concise pointers, not full dumps. Use PROACTIVELY when discovery spans more than one channel or more than ~2 read calls.',
    prompt: specExplorePrompt(builtinsEnabled),
    tools: [
      'Read',
      'Grep',
      'Glob',
      // M13: CRUD (incl. reads) moved to the generic entity-tools server, composed
      // by the host — no longer discoverable by scanning per-type mcpToolsLine
      // (entityReadMcpTools below now only catches a future custom server that
      // happens to expose a get_/list_ tool, which none currently do).
      'mcp__entity-tools__get_entities',
      'mcp__entity-tools__list_entities',
      'mcp__entity-tools__search_entities',
      'mcp__entity-tools__describe_entity_type',
      ...entityReadMcpTools(pluginHost),
      // reference-tools is cross-cutting (not an entity), so its read tools are listed explicitly
      // — mirrors the hardcode in buildTooling().
      'mcp__reference-tools__find_references',
      'mcp__reference-tools__check_consistency',
      'mcp__reference-tools__get_page_outline',
      // 0.2.3 item 14 stage 1: the domain replacements for Glob / Grep / Read
      // over the specification. Granted alongside the built-ins, not instead of
      // them — narrowing the toolset is a later stage, gated on telemetry.
      'mcp__reference-tools__list_pages',
      'mcp__reference-tools__search_pages',
      'mcp__reference-tools__get_page',
      'mcp__reference-tools__get_sections',
      // 0.2.54: the skill channel. Granted so the ban on the native `Skill` tool in every
      // subagent toolset describes the state of things rather than an intention — the job
      // `Skill` would do is done by this MCP tool.
      'mcp__skill-tools__load_skill_file',
    ],
    model: 'sonnet',
  };
}

/** `diff-explore`: read-only exploration of a historical `release_diff`. Deliberately WITHOUT the
 *  entity graph (it returns HEAD) — only release-scoped `release-tools` + Read for the on-disk dump. */
function buildDiffExploreSubagent(builtinsEnabled: boolean): SubagentDefinition {
  return {
    name: 'diff-explore',
    description:
      'Read-only explorer of ONE SLICE of a historical release diff for a brief. Spawn it in parallel (one per disjoint slice) and hand it a `from`/`to` + optional `roots` scope + `entityTypes` and/or `limit`/`offset` window; it calls heavy `release_diff` for that slice, absorbs the bulk, and returns a concise distillate (facts to inline) — keeping the whole diff out of your own context. When the brief is root-scoped, pass the same `roots` to every diff-explore slice so the pages filter is not lost on fan-out.',
    prompt: diffExplorePrompt(builtinsEnabled),
    tools: [
      'Read',
      'Grep',
      'Glob',
      'mcp__release-tools__release_show',
      'mcp__release-tools__release_diff',
      'mcp__release-tools__release_list',
      // 0.2.54: see the note on spec-explore's copy of this line.
      'mcp__skill-tools__load_skill_file',
    ],
    model: 'sonnet',
  };
}

/**
 * Dimension four of the `context_type` registry, as of 0.2.54 no longer a constant: the
 * `SubagentDefinition`s injected into `adapter.execute({ subagents })`.
 *
 * The return value is a UNION resolved per turn — the built-in of this context type's row,
 * plus the `contributes.subagents` fan-out of the effective plugin pool filtered by each
 * contribution's `contextTypes[]`. What changed is the TYPE OF THE COLUMN'S VALUE, not the
 * number of rows: the registry stays a code constant of four rows and a plugin adds none.
 *
 * Read by PULL, and that is what makes the capability teardown-free: this function consults
 * the plugin host when a turn is built and keeps no copy, and `subagents` is a per-turn
 * mutable field of the execute params. Enabling, disabling or reloading a plugin therefore
 * takes effect FROM THE NEXT TURN — no session restart, no `ProjectContext` invalidation,
 * and nothing for `unregisterPlugin` to unwire beyond dropping its record.
 *
 * `chat`/`patch`/`ask` get `spec-explore` (current entity graph); `brief` gets
 * `diff-explore` (release-scoped, no entity graph, because the graph returns HEAD).
 *
 * `hasSkillSlug` is injected rather than imported: `skill-registry.ts` imports
 * `CONTEXT_TYPE_REGISTRY` from this module, so reaching back for the registry would close a
 * cycle. It defaults to accept-all so the two-argument call sites and test fixtures that
 * predate this parameter keep compiling.
 */
export function subagentsFor(
  contextType: ChatContextType,
  pluginHost: ProjectPluginHost,
  builtinsEnabled = false,
  hasSkillSlug: (slug: string) => boolean = () => true,
): SubagentDefinition[] {
  /**
   * 0.2.53 mounted NO subagent at all while the built-ins were denied, and the reason was
   * the library rather than this posture: `subagentToolPolicy` intersected a definition's
   * whole `tools` list with an allow-list of BUILT-IN names, so every `mcp__*` entry fell
   * out and both explorers came back with `tools: []` — which the SDK reads as "no tools",
   * not "inherit". That branch carried its own deletion trigger: "when the library passes
   * `mcp__*` through, delete this branch and the explorers come back on their own."
   *
   * agent-adapters 0.9.9 does exactly that (the predicate is now
   * `t.startsWith('mcp__') || allowed.has(t)`), so the branch is gone. Deny-group
   * propagation is unchanged — a denied BUILT-IN still drops from every definition — which
   * is why the two explorers keep naming Read/Grep/Glob and simply lose them in a gated
   * posture, while their MCP channel, the one they actually work through, survives whole.
   *
   * `builtinsEnabled` therefore no longer gates the LIST; it still shapes the two built-in
   * PROMPTS, which must stop promising file tools they will not have.
   */
  const { subagent } = CONTEXT_TYPE_REGISTRY[contextType];
  const builtin = sanitizeSubagentDefinition(
    subagent === 'diff-explore'
      ? buildDiffExploreSubagent(builtinsEnabled)
      : buildSpecExploreSubagent(pluginHost, builtinsEnabled),
  );
  // Optional call: several fixtures reach this function through an
  // `as unknown as ProjectPluginHost` cast that predates the method.
  const contributed = resolvePluginSubagents({
    contextType,
    contributions: pluginHost.listSubagents?.() ?? [],
    hasSkillSlug,
    taken: new Set([builtin.name]),
  });
  return [builtin, ...contributed];
}

/**
 * 0.1.58: discovery block listing workspace peers the agent may consult via
 * `c4s-tools.ask`. The current project is excluded upstream.
 *
 * This is the prompt's model block, and the reason is worth naming: it carries
 * exactly what a parameter requires and nothing that is obtainable some other
 * way. There is no tool that lists peers, so without this block the `project`
 * argument is unguessable — which is the test every block in this file should
 * pass and most of them did not.
 *
 * 0.2.50 — `id` REPLACES `path` as the address, and `name` is demoted to a
 * label. `resolveWorkspaceProject` tries the value as a path first and then
 * falls back to `findProjectByName`, so a name IS an address — but the registry
 * name, which is not the display name this block used to render beside the path.
 * A peer shown as "C4S - App Spec" is registered as `app-spec`, and passing the
 * former answers PROJECT_SLUG_NOT_FOUND. That was found by making the call; the
 * simplification it refutes ("drop the path, the name is the address") had
 * survived three readings of the code.
 *
 * `id` is therefore `registryName`, and a peer whose registry name is somehow
 * missing keeps `path` so it stays reachable rather than becoming decorative.
 *
 * So does a peer whose registry name it SHARES. The name is not a key — the
 * registry says so in as many words — and `findProjectByName` searches one
 * project per workspace, so a duplicate inside a single workspace never reaches
 * `AMBIGUOUS_PROJECT`: the first match wins, silently, and the second peer is
 * unaddressable. `path` is tried before the name fallback and is exact, so the
 * peers that collide keep it. The block stays short in the ordinary case and
 * stays CORRECT in the case that would otherwise consult the wrong project.
 */
function buildWorkspaceProjects(workspaceName: string, peers: PeerProject[]): string {
  const lines = [`<workspace_projects ${attrs({ workspace: workspaceName })}>`];
  const nameCounts = new Map<string, number>();
  for (const p of peers) {
    if (p.registryName) nameCounts.set(p.registryName, (nameCounts.get(p.registryName) ?? 0) + 1);
  }
  for (const p of peers) {
    const unique = p.registryName !== undefined && nameCounts.get(p.registryName) === 1;
    lines.push(
      `  ${selfClose(
        'peer',
        attrs({
          id: p.registryName,
          name: p.name,
          path: unique ? undefined : p.path,
          description: p.description,
        }),
      )}`,
    );
  }
  lines.push(
    `  Pass a peer's \`id\` as the \`project\` argument of \`ask\` — that is the registry name the resolver matches. \`name\` is the peer's own label for itself and is NOT an address. Where a \`path\` is also shown, that peer's \`id\` is shared with another project and only the path addresses it unambiguously — pass the path.`,
    `</workspace_projects>`,
  );
  return lines.join('\n');
}

/**
 * 0.2.19: `<interaction_context type="chat|brief|patch|ask">` — the domain rules of the
 * thread's interaction type. Emitted UNCONDITIONALLY, in every context type including
 * `chat`, as block #1a (right after `<claude4spec_identity>`) or as block #1 of the brief
 * frame, where it replaced `<claude4spec_brief_identity>` + `<self_contained_invariant>`.
 *
 * With no rules the block still renders, self-closing with just its `type`. That is not a
 * degenerate case to tidy away: an absent block is indistinguishable from "this host has
 * no such concept", whereas `<interaction_context type="chat"/>` says the concept exists
 * and this type carries no extra rules. The `type` attribute alone is worth emitting — it
 * tells the agent which of the four modes it is in.
 *
 * The body is verbatim from `interaction-rules.ts` (owned by M21/M23/M11); this function
 * deliberately contains no genre text of its own.
 */
function buildInteractionContext(contextType: ChatContextType, interactionRules?: string): string {
  const body = (interactionRules ?? '').trim();
  if (body === '') return selfClose('interaction_context', attrs({ type: contextType }));
  return [`<interaction_context ${attrs({ type: contextType })}>`, body, `</interaction_context>`].join('\n');
}

/**
 * `<available_skills>` — the listing, plus the channel rule that governs all of it.
 *
 * ## Always emitted, empty or not
 *
 * A project with no skills still gets the block, carrying only the instruction. An
 * ABSENT block is indistinguishable from a host that has no concept of skills,
 * which is a different and wronger thing to tell the model than "this project has
 * none": the first invites it to look for skills some other way, the second closes
 * the question.
 *
 * ## Why the instruction is here and not in the tool description
 *
 * The two prohibitions — never `Skill()`, never `Read` — are about tools this
 * block does not own, so they cannot live in `load_skill_file`'s own description.
 * The native `Skill` tool stays in the toolset and the SDK discovers skills of its
 * own through `settingSources` (`~/.claude/skills`), so without this line the
 * model has two channels to one concept, one of which reaches a different set of
 * documents.
 *
 * ## This soft block is PERMANENT (0.2.50)
 *
 * It used to be described as layer 1 of three, with layer 2 waiting on a
 * `disallowedTools: ['Skill']` field that `@inharness-ai/agent-adapters` would
 * eventually expose. That wait is over and the answer was no: 0.9.6 REJECTED
 * per-name `disallowedTools` permanently in favour of semantic
 * `disallowedToolGroups`. The condition "when the dependency exposes the field"
 * will never be met, so do not build a watch or a TODO on it.
 *
 * Outside plan mode there is therefore no hard block on native `Skill()`, and
 * there will not be one — this prompt line is the whole mechanism. Inside plan
 * mode `Skill` IS silenced, but only incidentally: it belongs to the `shell`
 * group, which `planMode` denies, so it disappears from the model's tool
 * catalog entirely. That is a reversal of the old behaviour, where `Skill` sat
 * in the read-only class and plan mode preserved it.
 *
 * The remaining layer is the `SubagentDefinition.tools` allow-lists, which name
 * no `Skill` and must not start to.
 *
 * The builder knows nothing about where the listing came from or how a package is
 * laid out — it renders slugs, descriptions and a fixed rule.
 */
function buildAvailableSkills(entries: { slug: string; description: string }[]): string {
  const lines = [`<available_skills>`];
  for (const e of entries) {
    lines.push(`  ${selfClose('skill', attrs({ slug: e.slug, description: e.description }))}`);
  }
  lines.push(
    `  Open a skill with load_skill_file(slug) — it returns the skill body plus a manifest of its package files.`,
    `  Read a subfile the skill points you to with load_skill_file(slug, file), e.g. load_skill_file("${entries[0]?.slug ?? 'some-skill'}", "workflows/brief.md").`,
    `  Never open a skill with the native Skill() tool and never read one with Read — skills are not files you can reach; load_skill_file is the only channel.`,
    `</available_skills>`,
  );
  return lines.join('\n');
}

/**
 * The writing-style slot. 0.2.50 renames the block from `<project_skill>` to
 * `<project_writing_skill>` and stops describing what is inside it.
 *
 * The name first: M37 gives this slot to the active WRITING STYLE and to nothing
 * else — at most one, never a general project skill — while every other skill
 * of the turn rides the `<available_skills>` listing. `<project_skill>` named
 * the opposite of what the slot is.
 *
 * The contents second, which is the more consequential half. The block used to
 * assert that the skill "contains the BINDING project specification — module/
 * layer structure, file layout, naming, workflow, and quality rules". Nothing
 * guarantees any of that: the slot is filled from `config.writingStyle` and
 * validated only for presence in the registry and `meta.scope ===
 * 'writing-style'`. That sentence describes ONE project's skill, shipped to
 * every installation as a fact — and it is the kind of falsehood that suppresses
 * its own discovery, because an agent told what a document contains has a reason
 * not to open it.
 *
 * 0.2.50 finishes the thought. The block briefly rendered the skill's own
 * `description` instead — truer than the invented sentence, but the same shape
 * of mistake: a `description` is a blurb written to help a model DECIDE whether
 * to open a skill, and here there is no decision left, since the style is
 * already selected and the block orders it read regardless. It is `summarise
 * what the document contains` by another route, and buys nothing for the tokens.
 *
 * What the block says now is generic and true of every writing style: one
 * exists, it binds everything you produce, and you have not read it yet.
 *
 * Also gone: "re-call whenever you transition from plan mode into execution".
 * The system prompt is frozen after the first turn (`setInitialSystemPrompt`),
 * so that transition has no representation the agent can observe — the
 * instruction names an event it will never see happen.
 */
function buildProjectSkill(ws: { slug: string; title: string }): string {
  return [
    `<project_writing_skill ${attrs({ slug: ws.slug, title: ws.title })}>`,
    `This project has an active writing style, and it is BINDING on everything you produce: pages, plans, entity content, and the structure of your answers all follow it.`,
    ``,
    `You do not know its conventions yet, and this block does not summarise them.`,
    `  1. Before your first tool call in this thread, call load_skill_file("${ws.slug}") and read it.`,
    `  2. Treat its content as authoritative. If a request seems to contradict it, surface the conflict rather than quietly overriding the convention.`,
    `</project_writing_skill>`,
  ].join('\n');
}

/**
 * 0.1.51: spec-authoring language directive (config.language). Emitted verbatim —
 * `lang` is a display name from SUPPORTED_LANGUAGES. Chat/patch frames only; NOT the
 * brief frame (a brief is a separate artifact governed by conversational language).
 */
function buildSpecLanguage(lang: string): string {
  return [
    `<spec_language>`,
    `Write all specification content (pages, entity descriptions, briefs) in ${lang}. This governs the artifact, not necessarily your chat replies.`,
    `</spec_language>`,
  ].join('\n');
}

/**
 * 0.1.51: conversational language directive (config.agent.conversationalLanguage).
 * Emitted verbatim. Present in chat/patch AND brief frames.
 */
function buildConversationalLanguage(lang: string): string {
  return [
    `<conversational_language>`,
    `Always communicate with the user in ${lang}, regardless of the language they write in.`,
    `</conversational_language>`,
  ].join('\n');
}

/**
 * 0.1.90: soft filesystem-scope directive (config.agent.allowedPaths/disallowedPaths).
 * The HARD boundary is enforced natively by the agent-adapters sandbox; this block is the
 * directional guide and the only layer for adapters without a sandbox. ALLOWED lists `cwd`,
 * every root dir (only when outside `cwd`), then the configured `allowedPaths`; DISALLOWED
 * lists the configured `disallowedPaths` (precedence). Empty allowed/disallowed lists are
 * omitted from their line.
 * 0.1.130: `artifactDenyDirs` (always non-empty) adds an unconditional ALWAYS-DISALLOWED
 * line for the C4S artifact dirs — hard-locked at the sandbox level, editable only via the
 * MCP tools (plan-tools/brief-tools/entity-tools/release-tools). This makes the block always
 * present; the caller now gates only on `agentPathScope` being set (still non-brief only).
 */
/**
 * 0.2.50 — the block no longer names a fixed list of MCP servers.
 *
 * It used to close with "use plan-tools / brief-tools / entity-tools /
 * release-tools instead, and page-tools for the pages", which is true of a chat
 * thread and false of a brief one: the `brief` profile mounts `release-tools`
 * alone out of the plugin pool and no plan-tools, so four of the five named
 * servers are absent from its `tools/list`. Now that the brief frame carries
 * this block, that sentence would point a brief thread at tools it does not
 * have, and leave the built-in `Write` — forbidden by this very block — as its
 * only remaining route. Pointing at `<tooling>`, which is itself derived from
 * the mount, cannot be wrong in either frame; the page paragraph is emitted only
 * where the page tools are actually mounted, for the same reason.
 */
function buildAgentPathScope(
  scope: {
    allowedPaths: string[];
    disallowedPaths: string[];
    artifactDenyDirs: string[];
    pageRootDirs: string[];
  },
  cwd: string,
  roots: Root[],
  inventory: readonly McpInventoryEntry[],
): string {
  // Root dirs may be relative (e.g. '.' or 'pages') — resolve against cwd before the
  // inside check, mirroring the M05 resolver, so a nested root dir is correctly omitted.
  const rootExtras = [
    ...new Set(
      roots.map((r) => path.resolve(cwd, r.dir)).filter((rootAbs) => !isInside(cwd, rootAbs)),
    ),
  ];
  const allowed = [cwd, ...rootExtras, ...scope.allowedPaths];
  const lines = [
    `<agent_path_scope>`,
    `You are scoped to this project's filesystem. The hard boundary is enforced natively by the agent sandbox; this block is the directional guide.`,
    `  ALLOWED (you may read/write here): ${allowed.join(', ')}`,
  ];
  if (scope.disallowedPaths.length) {
    lines.push(`  DISALLOWED (never read/write here, takes precedence): ${scope.disallowedPaths.join(', ')}`);
  }
  // 0.1.130: unconditional hard-lock on the C4S artifact dirs. Absolute paths; edit ONLY
  // via the dedicated MCP tools — the built-in FS tools are blocked at the sandbox level.
  lines.push(
    `  ALWAYS DISALLOWED — C4S artifact dirs (edit ONLY via MCP tools, never with built-in Read/Write/Edit/Bash): ${scope.artifactDenyDirs.join(', ')}`,
  );
  /**
   * 0.2.13 item 28. Stated as its own line rather than folded into the one above, because
   * the rule is genuinely different: an artifact dir is closed to reads AND writes, a page
   * root is READABLE and closed to writes only. Collapsing the two would tell the agent to
   * stop grepping pages, which is the opposite of what `<entity_discovery>` asks of it two
   * blocks earlier.
   */
  if (scope.pageRootDirs.length && hasServer(inventory, 'page-tools')) {
    lines.push(
      `  READ-ONLY to built-in tools — page roots (${scope.pageRootDirs.join(', ')}): read and grep them freely, but NEVER write one with Write/Edit/Bash. ` +
        `A page is written with create_page / update_page / delete_page, and a batch of sections with update_sections. ` +
        `That is not a style preference: those operations label the write for the file watcher and honour expectedHash, so the page is re-indexed and conflict-checked before you are told it succeeded. A built-in write skips both.`,
    );
  }
  lines.push(
    `Stay within ALLOWED minus DISALLOWED. Do not touch files outside this scope (e.g. other projects, source code next to the spec). If a task seems to require an out-of-scope path, say so instead of attempting it. Never hand-edit the C4S artifact dirs — write them through the MCP servers listed in <tooling>, which is the set actually mounted for this turn.`,
    `</agent_path_scope>`,
  );
  return lines.join('\n');
}

/**
 * 0.2.53 — the built-in filesystem/shell posture, stated to the model in BOTH
 * states, for `chat` / `patch` / `ask`. There is no omitted case: a block that
 * appears only when something is switched off teaches the model to read its
 * absence as permission, and the `enabled="true"` body has its own thing to say.
 *
 * The `brief` frame does not carry it — that frame states its posture inside its
 * own `<interaction_context type="brief">` block instead.
 *
 * `enabled` is the NEGATION of `agent.disableDirectFilesystemAccess`: the config
 * field names what is taken away, the prompt names what the model has.
 *
 * The disabled body names the four capabilities that genuinely stop working, so
 * a model asked for one of them says which setting is in the way instead of
 * reaching for a tool that is not in its catalog and improvising after it fails.
 */
function buildAgentFilesystemAccess(access: { enabled: boolean }): string {
  if (!access.enabled) {
    return [
      `<agent_filesystem_access enabled="false">`,
      `This project runs you WITHOUT built-in filesystem or shell tools. Read, Grep, Glob, Edit, Write, NotebookEdit, Bash and Skill are not in your catalog — they are absent, not merely discouraged, so there is nothing to fall back to and no point proposing one.`,
      `The specification is fully reachable anyway, through the MCP servers listed in <tooling>: read with get_page / get_sections / list_pages / search_pages, write with update_sections / update_page. That is the point of the posture, not a workaround for it — a core write carries expectedHash, captures a version and injects anchors, and a built-in write skipped all three.`,
      `Four things genuinely do not work while this is on. If you are asked for one, say which setting is in the way rather than attempting it:`,
      `  - git recovery ("Fix it with Agent") — it drives git through Bash, and no MCP operation replaces it;`,
      `  - a brief with source: analysis — reading somebody else's repository needs the file built-ins;`,
      `  - the c4s CLI — it is a shell program; only its \`ask\` survives, and only where this turn mounted the server that exposes it — check <tooling>;`,
      `  - scaffolding a new writing style — it writes a skill package under .claude/skills/, which no C4S operation owns.`,
      `The user can turn all four back on by unchecking \"Block direct file access\" in Settings → Agent. Say that plainly; do not try to work around it.`,
      `One thing that DOES still work, and it is about you rather than the user: the read-only explorer subagents are mounted here as usual. They never held the file built-ins to begin with — they read the specification through the same MCP operations you do — so this posture takes nothing away from them, and delegating a wide sweep is still the way to keep the bulk of what you read out of your own context.`,
      `</agent_filesystem_access>`,
    ].join('\n');
  }
  return [
    `<agent_filesystem_access enabled="true">`,
    `This project leaves the built-in filesystem and shell tools available to you, so work outside the specification (implementation code, git, the c4s CLI, scaffolding a writing style) is possible here.`,
    `That does NOT make them an alternative route into the specification. Pages, entities, plans and briefs are still read and written ONLY through the MCP servers in <tooling>: a built-in write bypasses expectedHash, version capture and anchor injection, so it corrupts the consistency contract while reporting success. Reach for Read/Edit/Write only for files that are not C4S artifacts.`,
    `</agent_filesystem_access>`,
  ].join('\n');
}

/** True when `child` is the same as or nested under `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * M21 brief-context system prompt. Minimal frame: interaction context (identity +
 * self-containment invariant, from M21's own rules), brief-tools usage, the active
 * writing-style skill (methodology — supplies `workflows/brief.md`, which the agent
 * reads itself), brief snapshot, optional annotations. Excludes pluginHost tooling,
 * plan tools, entity counters — agent operates on a single artifact with a reduced
 * surface.
 *
 * 0.2.19 removed three blocks from this frame: `<claude4spec_brief_identity>` and
 * `<self_contained_invariant>` (both folded into `<interaction_context type="brief">`,
 * whose body M21 owns) and `<writing_style_brief_workflow>` (the host no longer points
 * at a style's internal file layout — every package file rides `InlineSkill.files` and
 * the agent navigates its own style).
 */
function buildBriefSystemPrompt(input: {
  projectName: string;
  cwd: string;
  /**
   * 0.2.53: the brief frame does NOT carry `<agent_filesystem_access>` — it
   * states its posture in its own `<interaction_context type="brief">` body —
   * but its `<builtin>` inventory must still be truthful about what this thread
   * actually has, so the flag is threaded in for that one line.
   */
  builtinsEnabled: boolean;
  brief: Brief | null;
  annotations: Annotation[];
  writingStyleSkill: { slug: string; title: string } | null;
  availableSkills: { slug: string; description: string }[];
  interactionRules?: string;
  conversationalLanguage?: string;
  /** 0.2.50: the mounted set, for the derived `<tooling>` block. */
  mcpInventory: readonly McpInventoryEntry[];
  /** 0.2.50: this frame emits `<agent_path_scope>` too — see the note at its push. */
  roots: Root[];
  agentPathScope?: SystemPromptInput['agentPathScope'];
}): string {
  const parts: string[] = [];
  // Block #1 — where the chat/patch/ask frame has `<claude4spec_identity>` then this,
  // the brief frame opens with it: in brief mode the interaction rules ARE the identity.
  parts.push(buildInteractionContext('brief', input.interactionRules));
  // The retired `<claude4spec_brief_identity>` block carried the project name and cwd
  // alongside the rules. The rules moved to M21; these two are project facts, not genre
  // rules, so they stay in the frame — as the same `<project/>` self-close the other
  // frame uses, minus every counter a brief thread has no access to.
  parts.push(selfClose('project', attrs({ name: input.projectName, cwd: input.cwd })));

  /**
   * 0.2.50 — DERIVED, like the main frame's, and this frame is why the derivation
   * was overdue. The literal it replaces advertised `get_release`,
   * `get_release_diff` and `list_releases`: three names, none of which is a tool.
   * The server exposes `release_create` / `release_list` / `release_show` /
   * `release_diff` / `release_update`, and the brief frame's OWN subagent
   * definition used the correct ones — so a brief thread was handed two disjoint
   * vocabularies for the same three operations, one of them fictional.
   */
  parts.push(buildTooling(input.mcpInventory, input.builtinsEnabled));
  parts.push(BRIEF_TOOLS_USAGE);
  /**
   * 0.2.50 — the brief frame gains `<agent_path_scope>`, and this is a straight
   * correction of a two-way falsehood.
   *
   * `resolveAgentExecutionScope` runs unconditionally and its result reaches
   * `baseExecuteArgs` for every context type, so a brief thread HAS a path scope
   * and always did: cwd writable, artifact dirs closed, page roots read-only.
   * The frame simply never rendered it. Meanwhile the brief interaction rules
   * asserted "you have NO filesystem access" — an enforcement that is not set
   * anywhere in production code. The agent was therefore told it was forbidden
   * something it could do, and told nothing about the limits that actually bound
   * it. Both halves are fixed by emitting the same block every other frame gets.
   */
  if (input.agentPathScope) {
    parts.push(buildAgentPathScope(input.agentPathScope, input.cwd, input.roots, input.mcpInventory));
  }
  // 0.1.51: only `<conversational_language>` in the brief frame — `<spec_language>`
  // is omitted (it governs spec content; the brief is a separate artifact).
  if (input.conversationalLanguage) {
    parts.push(buildConversationalLanguage(input.conversationalLanguage));
  }
  // 0.2.36: unconditional, and immediately BEFORE <project_skill>. The order is
  // load-bearing — see the note at the main frame's identical pair.
  parts.push(buildAvailableSkills(input.availableSkills));
  // M37 (0.2.19): at most ONE <project_skill> block, for the active writing style — the
  // sole occupant of that slot. With no style selected the agent has no methodology for
  // the genre, but it still has its identity, its posture and the self-containment
  // invariant, all of which arrived in the interaction context above.
  if (input.writingStyleSkill) {
    parts.push(buildProjectSkill(input.writingStyleSkill));
  }

  if (input.brief) {
    const fm = input.brief.frontmatter;
    const scopeRoots = Array.isArray(fm.roots) ? fm.roots.filter((r) => typeof r === 'string') : [];
    // 0.1.96 (L13, M21 §121-123): when the brief is scoped to specific page roots,
    // make that scope an explicit, actionable directive — the raw `roots:` frontmatter
    // line inside <current_brief> is too easy for the author to miss, so scoping must
    // not depend on it. Whole-release briefs (no `roots`) emit nothing here.
    if (scopeRoots.length > 0) {
      const list = scopeRoots.join(', ');
      const arr = JSON.stringify(scopeRoots);
      const includesPages = scopeRoots.includes('pages');
      parts.push(
        [
          `<brief_scope ${attrs({ roots: list })}>`,
          `This brief is SCOPED to specific page roots: ${list}. It does NOT cover the whole release.`,
          `- PAGES: pass \`roots: ${arr}\` to EVERY release_diff call (the summary probe AND every heavy slice), and hand the same \`roots\` to each diff-explore subagent slice. Pages outside these roots MUST NOT enter the brief. Omitting \`roots\` defaults release_diff to ALL releasable roots and silently breaks this scope.`,
          `- ENTITIES are root-agnostic (release_diff never filters them by root): include entity changes that are referenced in the scoped pages' prose or are thematically tied to this scope — a relevance judgement, not a structural filter.`,
          includesPages
            ? `- This scope INCLUDES the built-in \`pages\` root (the carrier of the entity graph), so treat entities as whole-release: include ALL entity changes — omitting one would silently make the brief incomplete.`
            : `- This scope does NOT include the built-in \`pages\` root, so do not sweep in unrelated entity changes; include only entities relevant to the scoped pages above.`,
          `</brief_scope>`,
        ].join('\n'),
      );
    }
    parts.push(
      [
        `<current_brief ${attrs({
          path: input.brief.path,
          from_release: fm.from_release ?? '(initial)',
          to_release: fm.to_release,
          implemented: fm.implemented ? 'true' : 'false',
          hash: input.brief.hash,
          ...(scopeRoots.length > 0 ? { roots: scopeRoots.join(', ') } : {}),
        })}>`,
        input.brief.content,
        `</current_brief>`,
      ].join('\n'),
    );
  }

  if (input.annotations.length > 0) {
    // The brief frame has no `<current_page>`, so no annotation can borrow its root.
    parts.push(buildAnnotations(input.annotations, null, 'pages'));
  }

  return parts.join('\n\n');
}

const CURRENT_PAGE_PREVIEW_LINES = 40;

function buildCurrentPage(
  path: string,
  body: string | null,
  root: string,
  sectionIndexed: boolean,
): string {
  if (body === null) {
    return selfClose('current_page', attrs({ path, root, unavailable: 'true' }));
  }
  if (body.trim() === '') {
    return selfClose('current_page', attrs({ path, root, empty: 'true' }));
  }
  const lines = body.split('\n');
  const totalLines = lines.length;
  if (totalLines <= CURRENT_PAGE_PREVIEW_LINES) {
    return `<current_page ${attrs({ path, root, total_lines: totalLines })}>\n${body}\n</current_page>`;
  }
  const preview = lines.slice(0, CURRENT_PAGE_PREVIEW_LINES).join('\n');
  const remaining = totalLines - CURRENT_PAGE_PREVIEW_LINES;
  /**
   * The marker names CORE OPERATIONS, and never a filesystem read.
   *
   * 0.2.50 removed the "Read {path}" it used to carry: with
   * `agent.disableDirectFilesystemAccess` — default TRUE — `Read` is not in the
   * agent's catalogue at all, so the notice was pointing at a tool that does not
   * exist. That constraint is standing, not a one-off fix: whatever this line says
   * next, it may not send the agent to the disk.
   *
   * 0.2.56 leads with the sectional route instead of `get_page`. Reading a whole page
   * to reach part of it is the expensive answer, it truncates again past the response
   * budget, and `get_page_outline` supplies both halves of what comes next — the anchors
   * to fetch, and the page `hash` that arms the write.
   *
   * That route is offered only when the page's root is SECTION-INDEXED. `get_page_outline`
   * goes through `RootSet.requireSectionIndexed`, which answers INVALID_ARGUMENT on a
   * root without an index — so on such a root the sectional lead would be an instruction
   * that cannot succeed, and the notice names `get_page` instead. This is the same rule
   * `get_page`'s own `truncationHint` follows (`ops/pages.ts`, `lineWindowsRefused`): a
   * hint never proposes a call the operation it points at refuses.
   */
  return `<current_page ${attrs({
    path,
    root,
    total_lines: totalLines,
    preview_lines: `1-${CURRENT_PAGE_PREVIEW_LINES}`,
  })}>
${preview}
[... ${remaining} more line${remaining === 1 ? '' : 's'} truncated. ${
    sectionIndexed
      ? `To read on, call get_page_outline({ rootId: "${root}", path: "${path}" }) and then get_sections({ anchors }) for the sections you need — that get_page_outline envelope also carries the page hash that update_page and update_sections take as expectedHash. Call get_page({ rootId: "${root}", path: "${path}" }) only when you need the whole page.`
      : `To read on, call get_page({ rootId: "${root}", path: "${path}" }) — this root is not section-indexed, so get_page_outline and get_sections do not apply to it. The response carries the page hash that update_page takes as expectedHash.`
  }]
</current_page>`;
}

/**
 * 0.2.50 — each annotation now carries the `root` of the page it sits on, where
 * that is knowable.
 *
 * `page` alone is not an address: `get_page` without a `rootId` answers
 * INVALID_ARGUMENT. `<current_page>` has always carried its root, so an
 * annotation — which asks the agent to go and read a page — was the one block
 * naming a page it could not open. The asymmetry had no reason behind it.
 *
 * Knowable means: an annotation is raised from the page the user is viewing, so
 * an annotation whose `page` matches the current page shares its root. An
 * annotation carried over from a different page does not say which root it came
 * from — the client's annotation record has no such field — and rather than
 * guess, those render without the attribute and `<annotation_handling>` says
 * what to do about it. Threading a root through the client's annotation wire
 * type is the real fix and is a change of its own.
 */
function buildAnnotations(
  annotations: Annotation[],
  currentPagePath: string | null,
  currentPageRootId: string,
): string {
  const lines: string[] = [`<annotations>`];
  for (const a of annotations) {
    const root = currentPagePath && a.page === currentPagePath ? currentPageRootId : undefined;
    lines.push(
      `  <annotation ${attrs({ page: a.page, root, comment: a.comment ?? '' })}>`,
      a.text,
      `  </annotation>`,
    );
  }
  lines.push(`</annotations>`);
  return lines.join('\n');
}

/**
 * M23: patch snapshot block for a patch-resolution thread. Mirrors
 * `<current_brief>` — full file content verbatim plus a directive framing the
 * task (apply the patch's findings to the spec).
 */
function buildCurrentPatch(patch: PatchDetail): string {
  const fm = patch.frontmatter;
  return [
    `<current_patch ${attrs({
      path: patch.path,
      patch_kind: String(fm.patch_kind ?? ''),
      // 0.2.14: was `status="awaiting|completed"`. A missing key reads `false`,
      // and so does a legacy `status: completed` — that key is unknown now.
      applied: String(fm.applied === true),
      brief: typeof fm.brief === 'string' ? fm.brief : undefined,
      hash: patch.hash,
    })}>`,
    `This thread exists to resolve the patch below — a coding agent in another`,
    `terminal filed it as feedback while implementing a brief. Read it, then`,
    `apply its findings to the specification (edit the relevant pages/entities).`,
    `\`applied\` says whether this patch was already folded into the spec once —`,
    `it is a signal to read, not a flag you set: nothing in this thread can`,
    `change it, and only the user flips it from the patch page.`,
    ``,
    patch.content,
    `</current_patch>`,
  ].join('\n');
}

/**
 * The five layers the main frame is ordered by. The axis is VOLATILITY plus
 * LOCALITY OF REFERENCE: a block sits next to what it talks about, and the more
 * often its content changes, the further down it goes.
 *
 *   A — the frame.     Who you are, and which of the four interactions this is.
 *   B — this project.  What exists here: entity types, skills, the writing style.
 *   C — access.        What you can call, and where you may reach.
 *   D — conventions.   How to write, including whatever the active types add.
 *   E — current state. This page, these annotations, this plan, this turn's mode.
 */
type PromptLayer = 'A' | 'B' | 'C' | 'D' | 'E';

/**
 * One block of the prompt. `render` returns the block or `null` when the block
 * does not apply to this turn — the conditionals that used to be `if`s wrapping
 * a `parts.push`.
 */
interface PromptBlock {
  layer: PromptLayer;
  /** The XML tag name, for ordering assertions and for reading the table. */
  name: string;
  render(ctx: PromptContext): string | null;
}

/** What every block's `render` receives: the input plus the few derived values. */
interface PromptContext extends SystemPromptInput {
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
 * THE ORDER, as data.
 *
 * 0.2.50 — this table replaces seventeen `parts.push(…)` calls interleaved with
 * `if`s and with comments like "right after the language directives and before
 * `<current_patch>`". Those comments existed because the order was not readable
 * from anything: it was a sequence of statements recording when each block was
 * added — `0.1.51 step 6a`, `0.1.58 step 5a`, `0.2.36` — and a block's position
 * was an accident of its release. Written down as a list, the order can be read
 * in one screen, asserted in one test, and argued with.
 *
 * Two placements are worth defending because they look wrong:
 *
 *   `<interaction_context>` is FIRST, ahead of identity. The brief frame already
 *   opened with it, so this makes one rule for four modes rather than two rules
 *   for two groups — and in every mode, which of the four interactions this is
 *   frames everything after it.
 *
 *   `<claude4spec_plan_mode>` is LAST despite being tool policy, which by layer
 *   would put it in C. It is a per-turn switch — state, not contract — and it is
 *   a refusal, which is the one kind of instruction that benefits from recency.
 */
const MAIN_PROMPT_BLOCKS: readonly PromptBlock[] = [
  // ── A — the frame ───────────────────────────────────────────────────────
  {
    layer: 'A',
    name: 'interaction_context',
    render: (c) => buildInteractionContext(c.contextType, c.interactionRules),
  },
  { layer: 'A', name: 'claude4spec_identity', render: (c) => buildIdentity(c.projectName) },

  // ── B — this project ────────────────────────────────────────────────────
  {
    layer: 'B',
    name: 'project',
    render: (c) => {
      /**
       * 0.2.50 — `<project>` carries IDENTITY, not statistics: every counter is
       * gone, `pages` and `sections` included.
       *
       * Each was frozen at turn 1: the prompt is written once per thread
       * (`setInitialSystemPrompt`, and the CLI ignores later ones), so the first
       * mutation makes the number wrong for the rest of the thread. `ac` was
       * additionally a filtered subset — `defaultPredicate` restricts it to
       * active criteria — so `ac=1545` was not the number of criteria and
       * nothing in the prompt said so.
       *
       * What decided it was looking for a consumer, and the same look condemns
       * `pages`/`sections`. No block anywhere says "if there are more than N
       * pages, do X"; the one block that ever cited a counter,
       * `<sections_and_anchors>`, stopped doing so in #171. An agent that needs
       * a count calls `list_entities({ mode: 'count' })` and gets a current one.
       *
       * The `counted=` stamp went with them. It was honest about these two
       * attributes and misleading about the rest of the prompt, which it
       * implied was fresh — and it cost a `listTree()` walk plus a
       * `sections.count()` on the way to every turn's prompt.
       */
      const projectAttrs: Record<string, string | number> = {
        name: c.projectName,
        cwd: c.cwd,
        roots: buildRootsAttr(c.roots),
      };
      return selfClose('project', attrs(projectAttrs));
    },
  },
  { layer: 'B', name: 'entities', render: (c) => buildEntitiesBlock(c.host) },
  /**
   * `<available_skills>` IMMEDIATELY BEFORE `<project_writing_skill>`, and the
   * adjacency is load-bearing rather than tidy: the listing carries the
   * CONVENTION for opening a skill, and the style block issues an INSTRUCTION to
   * open one. Reversed, the model is told to call `load_skill_file` before
   * anything has said what that is or that it is the only channel.
   */
  { layer: 'B', name: 'available_skills', render: (c) => buildAvailableSkills(c.availableSkills) },
  {
    layer: 'B',
    name: 'project_writing_skill',
    render: (c) => (c.writingStyleSkill ? buildProjectSkill(c.writingStyleSkill) : null),
  },

  // ── C — access ──────────────────────────────────────────────────────────
  { layer: 'C', name: 'tooling', render: (c) => buildTooling(c.mcpInventory, c.agentFilesystemAccess?.enabled ?? false) },
  {
    layer: 'C',
    name: 'workspace_projects',
    // Gated on the SERVER being mounted rather than on a flag beside it: the
    // block exists to make `ask`'s `project` argument constructible, so it is
    // wanted exactly when `ask` is reachable.
    render: (c) =>
      hasServer(c.mcpInventory, 'c4s-tools') && c.workspaceProjects.length > 0
        ? buildWorkspaceProjects(c.workspaceName ?? '', c.workspaceProjects)
        : null,
  },
  {
    layer: 'C',
    // Promoted out of layer E (it used to sit among the `<current_*>` blocks):
    // a path scope is a contract about where you may reach, fixed for the
    // thread, not a fact about this turn.
    name: 'agent_path_scope',
    render: (c) =>
      c.agentPathScope ? buildAgentPathScope(c.agentPathScope, c.cwd, c.roots, c.mcpInventory) : null,
  },
  {
    layer: 'C',
    // Directly after the path scope, and in the same layer, because it answers
    // the question that block raises: the path scope says WHERE the built-in
    // tools may reach, this one says WHETHER there are any. Unconditional —
    // `render` never returns null, in either state of the flag.
    name: 'agent_filesystem_access',
    render: (c) => buildAgentFilesystemAccess(c.agentFilesystemAccess ?? { enabled: false }),
  },

  // ── D — writing conventions ─────────────────────────────────────────────
  { layer: 'D', name: 'entity_embeds', render: (c) => buildEntityEmbeds(c.host) },
  /**
   * Blocks contributed by the ACTIVE entity types, in `listEntities()` order.
   * `<diagram_references>` is the first migrant: it used to be hardcoded here
   * and emitted even for projects with no `diagram` type mounted.
   */
  {
    layer: 'D',
    name: 'plugin_prompt_blocks',
    render: (c) => {
      const blocks: string[] = [];
      for (const m of c.host.listEntities()) {
        for (const b of m.systemPrompt.promptBlocks ?? []) blocks.push(b.body);
      }
      return blocks.length > 0 ? blocks.join('\n\n') : null;
    },
  },
  { layer: 'D', name: 'discovery_and_impact', render: () => buildDiscoveryAndImpact() },
  { layer: 'D', name: 'tags', render: () => buildTags() },
  { layer: 'D', name: 'todo_markers', render: () => TODO_MARKERS },
  { layer: 'D', name: 'sections_and_anchors', render: () => SECTIONS_AND_ANCHORS },
  {
    layer: 'D',
    name: 'spec_language',
    render: (c) => (c.specLanguage ? buildSpecLanguage(c.specLanguage) : null),
  },
  {
    layer: 'D',
    name: 'conversational_language',
    render: (c) =>
      c.conversationalLanguage ? buildConversationalLanguage(c.conversationalLanguage) : null,
  },

  // ── E — current state ───────────────────────────────────────────────────
  {
    layer: 'E',
    name: 'current_patch',
    render: (c) => (c.contextType === 'patch' && c.patch ? buildCurrentPatch(c.patch) : null),
  },
  {
    layer: 'E',
    name: 'current_page',
    // 0.1.79: `ask` (peer-consult) emits no `<current_*>` page block — it explores
    // the peer's spec headlessly, with no "current page" anchor.
    render: (c) =>
      c.contextType !== 'ask' && c.currentPagePath
        ? buildCurrentPage(
            c.currentPagePath,
            c.currentPageBody,
            c.currentPageRootId,
            /**
             * An unknown root defaults to section-indexed: `pages`, the builtin every
             * project has, is indexed, and the notice for a root this context cannot
             * see should read like the normal case rather than like the exception.
             */
            c.roots.find((r) => r.id === c.currentPageRootId)?.sectionIndexed ?? true,
          )
        : null,
  },
  // Handling instructions sit BELOW the block they are about. They used to live
  // at the top of `<claude4spec_identity>`, some seven hundred lines above the
  // thing they described.
  {
    layer: 'E',
    name: 'current_page_handling',
    render: (c) => (c.contextType !== 'ask' && c.currentPagePath ? CURRENT_PAGE_HANDLING : null),
  },
  {
    layer: 'E',
    name: 'annotations',
    render: (c) =>
      c.annotations.length > 0
        ? buildAnnotations(c.annotations, c.currentPagePath, c.currentPageRootId)
        : null,
  },
  {
    layer: 'E',
    name: 'annotation_handling',
    render: (c) => (c.annotations.length > 0 ? ANNOTATION_HANDLING : null),
  },
  {
    layer: 'E',
    name: 'current_plan',
    render: (c) => {
      if (!c.currentPlan || c.currentPlan.body.trim().length === 0) return null;
      /**
       * 0.2.50 — `hash` and `path` join `version`, and the omission they fix was
       * expensive out of all proportion to its size.
       *
       * The block injects the plan's ENTIRE body — some 25 KB in a real thread.
       * To change one line of it the agent calls `update_plan`, which REQUIRES
       * `expectedHash` on every call after the one that creates the plan, and
       * the only source of a hash was `get_plan`. So the agent called
       * `get_plan`, received the same 25 KB a second time, and only then could
       * write. The injection saved no call; it doubled one.
       *
       * `get_plan`'s own doc comment states the principle this block was
       * breaking: "a read operation that cannot arm the write operation's guard
       * leaves the caller no legal first move." `<current_plan>` was exactly
       * such a read, and the hash was in the same object the whole time.
       */
      /**
       * ...but ONLY on a whole plan. `getByThread` reads through `getByPath`,
       * which windows the file at half the response budget, and `hash` is the
       * digest of the WHOLE file either way — so on a truncated read the hash
       * arms `expectedHash` against bytes the block never showed. The guard then
       * passes on a body composed from the visible part, and the plan loses its
       * tail with a `file_version` row asserting the edit was the change.
       * `readForWrite`'s doc comment describes exactly this, which is why that
       * second read exists at all.
       *
       * A truncated block therefore withholds the hash instead of handing over
       * a loaded one, and says why. That restores the extra `get_plan` call in
       * the one case where the call is not redundant.
       */
      const truncated = c.currentPlan.truncated === true;
      const block = `<current_plan ${attrs({
        path: c.currentPlan.path,
        version: c.currentPlan.currentVersion,
        hash: truncated ? undefined : c.currentPlan.hash,
        truncated: truncated ? 'true' : undefined,
      })}>\n${c.currentPlan.body}\n</current_plan>`;
      if (!truncated) return block;
      return (
        `${block}\n` +
        `This plan was TRUNCATED to fit the prompt${c.currentPlan.truncationHint ? ` (${c.currentPlan.truncationHint})` : ''} — the body above is not the whole file, and no hash is given for it. ` +
        `Do NOT compose an update from what you see here: read the plan with get_plan first and write against the hash it returns, or you will write the truncation back over the missing part.`
      );
    },
  },
  {
    layer: 'E',
    name: 'claude4spec_plan_mode',
    render: (c) => (c.planMode ? buildPlanMode(c.mcpInventory) : null),
  },
];

/** Block names in emission order — what an ordering assertion compares against. */
export function mainPromptBlockNames(): string[] {
  return MAIN_PROMPT_BLOCKS.map((b) => b.name);
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const contextType = input.contextType ?? 'chat';

  // M05 m05ctxreg: the brief context (uiChrome='brief-detail' in the registry) uses a
  // different frame — no entity counters, no plan tools, a narrow toolset. Since
  // 0.2.50 it does carry `<agent_path_scope>`, which it always should have.
  if (CONTEXT_TYPE_REGISTRY[contextType].uiChrome === 'brief-detail') {
    return buildBriefSystemPrompt({
      projectName: input.projectName,
      cwd: input.cwd,
      roots: input.roots,
      brief: input.brief ?? null,
      annotations: input.annotations ?? [],
      writingStyleSkill: input.writingStyleSkill ?? null,
      availableSkills: input.availableSkills ?? [],
      interactionRules: input.interactionRules,
      conversationalLanguage: input.conversationalLanguage,
      mcpInventory: input.mcpInventory ?? [],
      agentPathScope: input.agentPathScope,
      builtinsEnabled: input.agentFilesystemAccess?.enabled ?? false,
    });
  }

  const ctx: PromptContext = {
    ...input,
    contextType,
    annotations: input.annotations ?? [],
    availableSkills: input.availableSkills ?? [],
    mcpInventory: input.mcpInventory ?? [],
    workspaceProjects: input.workspaceProjects ?? [],
    currentPageRootId: input.currentPageRootId ?? 'pages',
    planMode: input.planMode ?? false,
    currentPlan: input.currentPlan ?? null,
    writingStyleSkill: input.writingStyleSkill ?? null,
    brief: input.brief ?? null,
    patch: input.patch ?? null,
  };

  return MAIN_PROMPT_BLOCKS.map((b) => b.render(ctx))
    .filter((s): s is string => s !== null && s !== '')
    .join('\n\n');
}
