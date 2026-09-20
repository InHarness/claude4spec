import type { ChatContextType } from '../../shared/entities.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { SubagentDefinition } from '@inharness-ai/agent-adapters';
import { composeSystemPrompt } from './system-prompt/compose.js';
import { CLAUDE_CODE_ALL_BUILTINS } from './system-prompt/blocks/m48-own.js';
import { BRIEF_COMPOSITION } from './system-prompt/compositions/brief.js';
import { DEFAULT_COMPOSITION } from './system-prompt/compositions/default.js';
import type { CompositionEntry, PromptCompositionDecl, SystemPromptInput } from './system-prompt/types.js';
import { PROFILES, mcpServerSetForProfile, type McpServerSet } from '../operations/profiles.js';
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
import { DomainError } from './tags.js';
import {
  DEFAULT_SUBAGENT_TURNS,
  resolvePluginSubagents,
  sanitizeSubagentDefinition,
  withTurnBudget,
} from './plugin-subagents.js';

/* ─────────────────────────── M05 m05ctxreg: context-type registry ───────────────────────────
 * Single code-level constant map (spec `m05ctxreg`), keyed by `context_type`, deciding the five
 * per-thread dimensions. This is the ONE source of truth: `buildSystemPrompt`/`subagentsFor`
 * (here), the dispatcher (`routes/agent-turn.ts`), and the enum validator (`services/chat.ts`)
 * only CONSUME it. Adding a context_type = one row here + extending the `ChatContextType` union
 * in `shared/entities.ts` — no edits to dispatch logic. NOT a SQLite table: the values are code
 * artifacts (MCP servers, React chrome, SubagentDefinition, prompt text). Skills are no longer
 * among them — 0.2.66 took the `attachInternalSkills` dimension out, and the count above is what
 * is left. */

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
/** 0.2.97 — moved to `system-prompt/types.ts` with the blocks; re-exported from their old address. */
export type { McpInventoryEntry, PeerProject, SystemPromptInput } from './system-prompt/types.js';

/**
 * One registry row — the five dimensions spec `m05ctxreg` dispatches per thread.
 *
 * 0.2.66 removed a sixth, `attachInternalSkills` — the host's map of which contextual
 * skills to pin to which context type. It had been shrinking for two releases (0.2.19
 * emptied `brief` and `patch`, leaving one entry in the whole catalogue) and the
 * remaining entry moved to the package that owns the skill, which now declares its own
 * reach through `PluginSkillContribution.contextTypes`. The row is no longer where a
 * skill gets attached; `<available_skills>` is entirely the plugin fan-out's product.
 *
 * Nothing about the DATA layer changed with it: `chat_thread.context_type` (no CHECK —
 * dropped by migration 042; validation lives in this map), its default and its invariants are untouched, and there is no migration. This is a
 * registry-and-prompt-builder change only.
 */
export interface ContextTypeEntry {
  /** Dim 1 — which MCP servers mount in `adapter.execute({ mcpServers })`. */
  mcp: McpServerSet;
  /** Dim 2 — chat-overlay chrome. Declarative marker only: the frontend `ChatOverlay.tsx`
   *  switches on `contextType` directly; this records the dimension, no backend consumer.
   *  (Until 0.2.97 the prompt builder read it to pick the brief frame; that choice is
   *  `promptComposition` now.) */
  uiChrome: 'overlay' | 'brief-detail';
  /** Dim 3 — read-only `SubagentDefinition` injected into `adapter.execute({ subagents })`. */
  subagent: 'spec-explore' | 'diff-explore';
  /** Dim 4 — builtin posture. `'force-plan'` pins `planMode=true` regardless of the thread's
   *  `plan_mode` flag (read-only peer); `'follow-thread'` tracks the flag. */
  builtinPosture: 'follow-thread' | 'force-plan';
  /** Dim 4b (0.2.87) — `'none'` strips every built-in (file-read / file-write / shell)
   *  regardless of `agent.disableDirectFilesystemAccess`; `'project-setting'` follows it. */
  builtinTools: 'project-setting' | 'none';
  /** Dim 6 (0.2.87) — background-task admissibility, declared explicitly per value. */
  backgroundTasks: 'allowed' | 'disabled';
  /** Dim 5 (0.2.19) — the body of `<interaction_context type="…">`: the domain rules of
   *  this interaction type. The TEXT is owned by the module that owns the genre (M21
   *  brief / M23 patch / M11 ask) and lives in `interaction-rules.ts`; M05 only renders
   *  it. `chat` carries none, and an empty body is a legitimate value — the block is
   *  emitted regardless, self-closing, because a missing block would be indistinguishable
   *  from "this concept does not exist". */
  interactionRules: string;
  /** Dim 7 (0.2.97, M44 × M48) — the prompt composition this type declares: `'default'` —
   *  the composer's own, in which every block's presence follows from its emission
   *  condition alone — or `{ own }`, a composition the type brings, stating what it
   *  deliberately lacks (see `system-prompt/compositions/`). */
  promptComposition: PromptCompositionDecl;
}

/**
 * The registry. Rows reproduce the spec `m05ctxreg` table 1:1; this refactor is
 * behavior-preserving, so each row dispatches exactly what the prior scattered
 * `isBrief`/`isPatch`/`isAsk` conditionals did.
 */
export const CONTEXT_TYPE_REGISTRY: Record<ChatContextType, ContextTypeEntry> = {
  chat: {
    mcp: mcpServerSetForProfile('chat'),
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: PROFILES.chat.builtinPosture,
    builtinTools: PROFILES.chat.builtinTools,
    backgroundTasks: PROFILES.chat.backgroundTasks,
    interactionRules: INTERACTION_RULES.chat,
    promptComposition: 'default',
  },
  brief: {
    mcp: mcpServerSetForProfile('brief'),
    uiChrome: 'brief-detail',
    subagent: 'diff-explore',
    builtinPosture: PROFILES.brief.builtinPosture,
    builtinTools: PROFILES.brief.builtinTools,
    backgroundTasks: PROFILES.brief.backgroundTasks,
    interactionRules: INTERACTION_RULES.brief,
    promptComposition: { own: BRIEF_COMPOSITION },
  },
  patch: {
    mcp: mcpServerSetForProfile('patch'),
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: PROFILES.patch.builtinPosture,
    builtinTools: PROFILES.patch.builtinTools,
    backgroundTasks: PROFILES.patch.backgroundTasks,
    interactionRules: INTERACTION_RULES.patch,
    promptComposition: 'default',
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
    mcp: mcpServerSetForProfile('ask'),
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: PROFILES.ask.builtinPosture,
    builtinTools: PROFILES.ask.builtinTools,
    backgroundTasks: PROFILES.ask.backgroundTasks,
    interactionRules: INTERACTION_RULES.ask,
    promptComposition: 'default',
  },
};

/**
 * 0.2.87 (M44): `chat_thread.context_type` has no CHECK, so the database accepts any
 * literal — validation lives HERE, and an unknown value is an application error, never
 * a silent fall-back to `chat` (which would hand a corrupted row the widest toolset).
 * Hydration passes the raw value through; every turn entry point asserts it first.
 */
export function isKnownContextType(raw: string): raw is ChatContextType {
  return Object.prototype.hasOwnProperty.call(CONTEXT_TYPE_REGISTRY, raw);
}

/**
 * 0.2.99 — the enumeration of legal `context_type` values, as data. This registry is
 * its owner; a consumer that takes a context type as a PARAMETER (M37's `list_skills`)
 * cites it from here instead of spelling out its own copy of the union.
 */
export const KNOWN_CONTEXT_TYPES = Object.keys(CONTEXT_TYPE_REGISTRY) as [ChatContextType, ...ChatContextType[]];

/** `"expected one of chat, brief, patch, ask"` — the one wording of a refusal that must list the legal values. */
export function formatLegalContextTypes(): string {
  return `expected one of ${KNOWN_CONTEXT_TYPES.join(', ')}`;
}

export function assertKnownContextType(thread: { id: string; contextType: string }): void {
  if (!isKnownContextType(thread.contextType)) {
    throw new DomainError(
      'INTERNAL',
      `thread ${thread.id} has unknown context_type '${thread.contextType}'; ${formatLegalContextTypes()}`,
    );
  }
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

Shape of \`get_sections\`: ONE ITEM PER SECTION. A section's \`body\` is its OWN prose, ending before its first child heading — never its children's. With \`includeSubtree: true\` every section beneath an anchor comes back as its own item, directly behind it in document order; read the tree from \`heading_level\` and position. Without the flag, a parent's children are simply not in the response — to list them, call \`get_page_outline\`.

Two different cuts, two different remedies (you are the one who calls this in bulk, so you are the one who hits them; the envelope's \`message\` names which applied):
- ITEM CEILING: the subtree expansion produced more items than one response carries. Every anchor you asked for is still there; the expansion is cut to a prefix and the rest are ABSENT — no item, no marker. Do NOT retry with fewer anchors (you cannot see what is missing): call \`get_page_outline\` for the page, pick the anchors you need, and call \`get_sections\` with exactly those.
- RESPONSE BUDGET: items past it keep their coordinates, lose \`body\`, and carry \`truncated: true\` with \`edges\` — the outgoing references of that section's OWN body: \`sectionRefs\` (anchors), \`entityEmbeds\` (type + slug), \`pageLinks\` (rootId + path). One case keeps a partial body — a single section too large for the whole budget comes back clipped, with the prose it did fit; keep that prefix, re-fetching returns the same bytes. Do NOT repeat the same batch (it is cut at the same place, deterministically): pick the few anchors from those \`edges\` that lead to what the parent asked about and call \`get_sections\` again with just those. Follow an embedded entity with \`get_entities\` using the \`slug\` from \`entityEmbeds\`.
- An item with no \`edges\` and no \`truncated\` carried its whole own body; its references are in the prose you already have. Child sections are never inside a parent's \`edges\` — they are items of their own, or listed by \`get_page_outline\`.

Hard rules:
- NEVER mutate anything (no create/update/delete; you have no such tools).
- Report pointers (paths / anchors / slugs), not dumps. The parent decides; you locate.`;

const diffExplorePrompt = (builtinsEnabled: boolean): string => `You are a read-only explorer of ONE SLICE of a HISTORICAL release diff, working for a parent that is authoring a release brief.

The parent hands you a slice — a \`from\`/\`to\` pair, an optional \`roots\` page-root scope, plus \`entityTypes\` and/or a \`limit\`/\`offset\` window. Your job: call \`release_diff\` for exactly that slice, absorb its heavy \`before\`/\`after\`/\`content\`, and return a CONCISE DISTILLATE: the concrete facts the parent must inline (each changed entity/section by name, its key signatures / field shapes / SQL / view URLs / file paths, and a one-line framing of the change — including deletions). The bulk stays with you; only the distillate goes back, keeping the parent's context small.

How to read your slice — three levels, in order:
1. WINDOWING (primary): call \`release_diff({ fromIdOrName, toIdOrName, roots, ...slice })\` and read the returned \`MCPReleaseDiff\` directly — the parent already windowed the slice to fit. The size of the window is the caller's choice: \`entityTypes\` / \`limit\` / \`offset\`.
2. EXPLICIT DEGRADATION: the operation TELLS you when it could not fit. An item past the budget comes back with its identity and \`truncated: true\` — an entity having lost \`before\`/\`after\` entirely, a section with \`content\` cut as text — and the envelope carries \`truncationHint\` naming the retry. When you see that marker, the slice you are holding is INCOMPLETE: follow the hint down (narrow \`entityTypes\`, lower \`limit\`, advance \`offset\`) and, if nothing else fits, \`summaryOnly: true\`, which is the guaranteed floor. Never report a truncated slice as if it were whole — absence of an item means "unchanged", and only the marker distinguishes that from "it did not fit".

- \`roots\` scope: if the parent gave you \`roots\`, pass it through verbatim on EVERY \`release_diff\` call — it narrows the PAGES dimension to the brief's scope. Dropping it silently widens the diff to all releasable roots and leaks out-of-scope pages into the brief.

Tools: \`release-tools\` MCP (\`release_diff\`; \`release_show\` / \`release_list\` available but rarely needed).${builtinsEnabled ? ' `Read` is also available, and is the LAST RESORT for a slice that will not fit any window: ask the parent for an on-disk dump and read that file. It is not a licence to read `pages/*.md` — see the hard rules.' : ' Nothing else — no filesystem: without `Read` you cannot reach `pages/*.md` at all. That closes one route to HEAD, not all of them — `release_diff` itself has a branch that answers with the present (see the hard rules) — so the guarantee that you see ONLY the historical diff is upheld by this prompt, not by the shape of your toolset. It also means the on-disk-dump escape hatch is gone: `summaryOnly: true` is your floor.'}

Hard rules:
- Read ONLY \`release_diff\` output / release artifacts. NEVER read \`pages/*.md\` (current spec state) and NEVER touch the entity graph (get_*/find_references) — those return HEAD and would break the brief's historical self-containment.
- NEVER pass \`toIdOrName: "current"\` to \`release_diff\`. That branch diffs against the live, not-yet-released state, so it hands you HEAD through the one tool you ARE allowed to call — the same break in self-containment as reading \`pages/*.md\`, wearing the right tool's name. Your \`to\` is always the frozen release the parent named.
- Return the distillate (facts to inline), not raw dumps and not bare pointers. NEVER mutate anything.`;

/** Enumerate read-only entity-graph MCP tools as `mcp__<server>__<tool>`. Parses each entity's
 *  `mcpToolsLine` (a manifest fact the prompt no longer renders) and keeps only get_ / list_ prefixed tools
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
      'mcp__entity-tools__resolve_identity',
      ...entityReadMcpTools(pluginHost),
      // reference-tools is cross-cutting (not an entity), so its read tools are listed explicitly
      // — `<tooling>` derives them from the mount, but this allow-list has no mount to read.
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
  /** 0.2.87 (M45): names of the MCP servers mounted for this turn — plugin contributions
   *  are intersected with them. Omitted = no intersection. */
  mountedMcpServers?: ReadonlySet<string>,
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
  /**
   * The two built-ins declare no `maxTurns` of their own and never pass through
   * `hostFrame()`, so `withTurnBudget` is what gives them the host default and states the
   * number in their prompt. Both halves matter: a prompt naming a budget the definition
   * does not actually carry would be the host lying to the model, which is the one thing
   * the frame exists not to do.
   */
  const builtin = withTurnBudget(
    sanitizeSubagentDefinition(
      subagent === 'diff-explore'
        ? buildDiffExploreSubagent(builtinsEnabled)
        : buildSpecExploreSubagent(pluginHost, builtinsEnabled),
    ),
    DEFAULT_SUBAGENT_TURNS,
  );
  // Optional call: several fixtures reach this function through an
  // `as unknown as ProjectPluginHost` cast that predates the method.
  const contributed = resolvePluginSubagents({
    contextType,
    contributions: pluginHost.listSubagents?.() ?? [],
    hasSkillSlug,
    taken: new Set([builtin.name]),
    ...(mountedMcpServers
      ? { surface: { mcpServers: mountedMcpServers, builtins: new Set(CLAUDE_CODE_ALL_BUILTINS) } }
      : {}),
  });
  return [builtin, ...contributed];
}

/* ─────────────────────────── M48: the system prompt ───────────────────────────
 * 0.2.97 — the blocks and their order left this file. Each block is declared by
 * the module that owns it (`system-prompt/blocks/*`), the composer assembles them
 * (`system-prompt/compose.ts`), and the context type declares which composition
 * it uses — the registry's `promptComposition` above. What stays here is the
 * entry point the turn calls, unchanged in signature and output.
 */

/** Block names of the default composition, in emission order — what an ordering assertion compares against. */
export function mainPromptBlockNames(): string[] {
  return DEFAULT_COMPOSITION.map((e) => e.block);
}

/** The composition a context type declared — the composer's default, or its own. */
export function promptCompositionFor(contextType: ChatContextType): readonly CompositionEntry[] {
  const decl = CONTEXT_TYPE_REGISTRY[contextType].promptComposition;
  return decl === 'default' ? DEFAULT_COMPOSITION : decl.own;
}

/**
 * Whether this type's composition has a position for the block at all. The turn
 * asks before loading what only that block would render — the page body, the
 * pinned plan — so a composition without the block costs no read.
 */
export function compositionCarries(contextType: ChatContextType, block: string): boolean {
  return promptCompositionFor(contextType).some((e) => e.block === block);
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  return composeSystemPrompt(promptCompositionFor(input.contextType ?? 'chat'), input);
}
