import type { ChatContextType } from '../../shared/entities.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { SubagentDefinition } from '@inharness-ai/agent-adapters';
import { composeSystemPrompt } from './system-prompt/compose.js';
import { CLAUDE_CODE_ALL_BUILTINS } from './system-prompt/blocks/m48-own.js';
import { DEFAULT_COMPOSITION } from './system-prompt/compositions/default.js';
import type { CompositionEntry, PromptCompositionDecl, SystemPromptInput } from './system-prompt/types.js';
import { registerCoreOperations } from '../operations/core-operations.js';

/**
 * Seed the process-wide catalog, for the same reason `profile-gate` does it at
 * its own module init: on an unseeded catalog this module's answers are WRONG
 * rather than absent. `<claude4spec_plan_mode>` classifies each mounted tool by
 * its `opClass`, and with no rows to read every tool looks alike. Idempotent, so
 * importing it from both places is safe.
 */
registerCoreOperations();
import { DomainError } from './tags.js';
import {
  DEFAULT_SUBAGENT_TURNS,
  resolvePluginSubagents,
  sanitizeSubagentDefinition,
  withTurnBudget,
} from './plugin-subagents.js';

/* ─────────────────────────── M44: context-type registry ───────────────────────────
 * 2.1.88 — a code map of the rows the owner modules contribute (`context-types/rows/`),
 * keyed by `context_type`. `buildSystemPrompt`/`subagentsFor` (here) and the turn
 * handler (`routes/agent-turn.ts`) only CONSUME it. A new value = one full row at the
 * module that brings it + its entry in the map + the index row (M44 `3f5ej79s`).
 * NOT a SQLite table: the values are code artifacts (MCP servers, chrome, subagents). */

/**
 * 0.2.13 — `McpServerSet` lives in `operations/profiles.ts`; it is the server set
 * of the external `mcp` channel only (2.1.88: the turn assembles its servers from
 * the row's `Serwery` column, see `turn-mcp-servers.ts`).
 */
export type { McpServerSet } from '../operations/profiles.js';
/** 0.2.97 — moved to `system-prompt/types.ts` with the blocks; re-exported from their old address. */
export type { McpInventoryEntry, PeerProject, SystemPromptInput } from './system-prompt/types.js';

/**
 * 2.1.88 (M44 `k3gkrn09`, L15 `6jkqb2h4`) — the registry is the code map of the
 * rows the owner modules contribute (`context-types/rows/`). One row = the L15
 * columns; `ContextTypeEntry` is kept as the old name of the row type.
 */
export type { ContextTypeRow as ContextTypeEntry } from './context-types/row.js';
export { CONTEXT_TYPE_REGISTRY, defaultContextType } from './context-types/registry.js';
import { CONTEXT_TYPE_REGISTRY, projectContextTypeRows } from './context-types/registry.js';
import type { ContextTypeRow } from './context-types/row.js';

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

/**
 * 2.1.88 (M44 `tug9fzdn`) — the context-type registry of ONE project: the rows
 * whose `Wymaga możliwości` together with the contributing module's requirements
 * fit the project's capability set. A value outside it does not exist there.
 */
export function contextTypeRegistryFor(capabilities: {
  has(name: string): boolean;
}): Readonly<Partial<Record<ChatContextType, ContextTypeRow>>> {
  return Object.fromEntries(projectContextTypeRows(capabilities).map((row) => [row.value, row]));
}

/** The context types one project registers, in registry order (see {@link contextTypeRegistryFor}). */
export function contextTypesFor(capabilities: { has(name: string): boolean }): ChatContextType[] {
  return Object.keys(contextTypeRegistryFor(capabilities)) as ChatContextType[];
}

/**
 * 2.1.77 (M44 `1j39ajh8`) — the per-project backstop of a turn: a thread whose
 * context type the project's registry does not hold is refused like an unknown
 * value. `registered` absent (rigs) = every row of the code map.
 */
export function assertRegisteredContextType(
  thread: { id: string; contextType: string },
  registered: readonly ChatContextType[] | undefined,
): void {
  assertKnownContextType(thread);
  if (registered && !registered.includes(thread.contextType as ChatContextType)) {
    throw new DomainError(
      'INTERNAL',
      `thread ${thread.id} has context_type '${thread.contextType}', which this project does not register; expected one of ${registered.join(', ')}`,
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
const specExplorePrompt = (builtinsEnabled: boolean, entities = true): string => `You are a read-only explorer of the CURRENT specification (${entities ? 'pages + entities + sections' : 'pages + sections'}).

Your job: explore on the parent's behalf and report CONCISE findings — file paths, section anchors, and entity slugs — never the full bulk you read. You exist to keep the parent's context small.

Tools: read-only spec operations on \`reference-tools\` — \`list_pages\` (which pages exist), \`search_pages\` (phrase or regex over the prose; modes are a cost ladder count -> map -> hits, and the DEFAULT is \`map\` — identity rows with no prose, so pass \`mode: \"hits\"\` explicitly when you need the text. A hit is a SECTION carrying \`matchCount\`; feed its \`anchor\` to \`get_sections\`. Narrow the scan with \`pathInclude\`/\`pathExclude\` before it opens files, or \`anchors\` to name sections outright), \`get_page_outline\` + \`get_sections\` (a page's headings as a tree, then the body of EVERY anchor you need in one call), \`get_page\` (a whole page as sections keyed by anchor, frontmatter and preamble as fields) ${entities ? '— plus the read-only entity graph (get_*/list_*, find_references, check_consistency).' : '— plus check_consistency. This project has no entities, so there is no entity graph to read.'}${builtinsEnabled ? ' Read/Grep/Glob are also available for the rest of the repository.' : ' There are no built-in file tools here — every intent they would serve is covered above: list_pages for Glob, search_pages for Grep, get_page / get_sections for Read.'}

Shape of \`get_sections\`: ONE ITEM PER SECTION. A section's \`body\` is its OWN prose, ending before its first child heading — never its children's. With \`includeSubtree: true\` every section beneath an anchor comes back as its own item, directly behind it in document order; read the tree from \`heading_level\` and position. Without the flag, a parent's children are simply not in the response — to list them, call \`get_page_outline\`.

Two different cuts, two different remedies (you are the one who calls this in bulk, so you are the one who hits them; the envelope's \`message\` names which applied):
- ITEM CEILING: the subtree expansion produced more items than one response carries. Every anchor you asked for is still there; the expansion is cut to a prefix and the rest are ABSENT — no item, no marker. Do NOT retry with fewer anchors (you cannot see what is missing): call \`get_page_outline\` for the page, pick the anchors you need, and call \`get_sections\` with exactly those.
- RESPONSE BUDGET: items past it keep their coordinates, lose \`body\`, and carry \`truncated: true\` with \`edges\` — the outgoing references of that section's OWN body: \`sectionRefs\` (anchors), \`entityEmbeds\` (type + slug), \`pageLinks\` (rootId + path). One case keeps a partial body — a single section too large for the whole budget comes back clipped, with the prose it did fit; keep that prefix, re-fetching returns the same bytes. Do NOT repeat the same batch (it is cut at the same place, deterministically): pick the few anchors from those \`edges\` that lead to what the parent asked about and call \`get_sections\` again with just those.${entities ? ' Follow an embedded entity with \`get_entities\` using the \`slug\` from \`entityEmbeds\`.' : ''}
- An item with no \`edges\` and no \`truncated\` carried its whole own body; its references are in the prose you already have. Child sections are never inside a parent's \`edges\` — they are items of their own, or listed by \`get_page_outline\`.

Hard rules:
- NEVER mutate anything (no create/update/delete; you have no such tools).
- Report pointers (${entities ? 'paths / anchors / slugs' : 'paths / anchors'}), not dumps. The parent decides; you locate.`;

const diffExplorePrompt = (): string => `You are a read-only explorer of ONE SLICE of a HISTORICAL release diff, working for a parent that is authoring a release brief.

The parent hands you a slice — a \`from\`/\`to\` pair, an optional \`roots\` page-root scope, plus \`entityTypes\` and/or a \`limit\`/\`offset\` window, or one page in \`paths\` with a \`sectionOffset\`/\`sectionLimit\` section window. Your job: call \`release_diff\` for exactly that slice, absorb its heavy \`before\`/\`after\`/\`content\`, and return a CONCISE DISTILLATE: the concrete facts the parent must inline (each changed entity/section by name, its key signatures / field shapes / SQL / view URLs / file paths, and a one-line framing of the change — including deletions). The bulk stays with you; only the distillate goes back, keeping the parent's context small.

How to read your slice — two levels, in order:
1. WINDOWING (primary): call \`release_diff({ fromReleaseName, toReleaseName, roots, ...slice })\` and read the returned \`MCPReleaseDiff\` directly — the parent already sized the slice to fit. Two kinds of window, both the caller's choice: the PAGE window (\`entityTypes\` / \`limit\` / \`offset\`, plus \`paths\`) or the SECTION window of one page (\`paths\` with exactly one page + \`sectionOffset\` / \`sectionLimit\`; \`sectionLimit: 1\` reads it section by section). Size the window from \`size\` in the \`summaryOnly\` map — per page, and with one path per section in \`sectionMap\` — not by guessing.
2. EXPLICIT DEGRADATION: the operation TELLS you when it could not fit. An item past the budget comes back with its identity and \`truncated: true\` — an entity having lost \`before\`/\`after\` entirely, a section with \`content\` cut as text — and the envelope carries \`truncationHint\` naming the retry. When you see that marker, the slice you are holding is INCOMPLETE: follow the hint down — narrower page window, then the one page through \`paths\`, then that page's section window from the \`sectionOffset\` the hint names — and, if nothing else fits, \`summaryOnly: true\`, the guaranteed floor. Never report a truncated slice as if it were whole — absence of an item means "unchanged", and only the marker distinguishes that from "it did not fit". A page read through the section window is whole only once your windows covered positions 0 to \`total.sections\`.

There is no third level. Nothing gets dumped to disk for you to read back: the response budget sits below the transport ceiling, so a response is never dropped silently, and the only road to more content is a smaller slice. A single section bigger than the budget comes back cut as text with \`truncated: true\` — say so in your distillate rather than inventing the rest.

- \`roots\` scope: if the parent gave you \`roots\`, pass it through verbatim on EVERY \`release_diff\` call that has no \`paths\` — it narrows the PAGES dimension to the brief's scope. Dropping it silently widens the diff to all page roots and leaks out-of-scope pages into the brief. A call WITH \`paths\` (a one-page slice, a section window, a \`truncationHint\` pointer) leaves \`roots\` out: the two are mutually exclusive (400 CONFLICTING_FILTERS), and each \`paths\` key already names its root.

Tools: \`release-tools\` MCP (\`release_diff\`; \`release_show\` / \`release_list\` available but rarely needed) and \`load_skill_file\`. Nothing else — no filesystem and no entity graph. Without them you cannot reach \`pages/*.md\` or HEAD's entities at all; but \`release_diff\` itself has a branch that answers with the present (see the hard rules), so the guarantee that you see ONLY the historical diff is upheld by this prompt as well as by your toolset.

Hard rules:
- Read ONLY \`release_diff\` output / release artifacts. NEVER read \`pages/*.md\` (current spec state) and NEVER touch the entity graph (get_*/find_references) — those return HEAD and would break the brief's historical self-containment.
- NEVER pass \`toReleaseName: "current"\` to \`release_diff\`. That branch diffs against the live, not-yet-released state, so it hands you HEAD through the one tool you ARE allowed to call — the same break in self-containment as reading \`pages/*.md\`, wearing the right tool's name. Your \`to\` is always the frozen release the parent named.
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
function buildSpecExploreSubagent(
  pluginHost: ProjectPluginHost,
  builtinsEnabled: boolean,
  entities = true,
): SubagentDefinition {
  /**
   * 2.1.77 (M45 `37ogwcgx`): the entity-graph half of the MCP allow-list exists only
   * with the capability `entities`. Without it the enumeration has no entity server
   * to walk, so the list keeps the `reference-tools` rows of the definition table
   * (and the skill channel) only — no `entity-tools` name, no per-type read tool.
   */
  const entityGraph = entities
    ? [
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
        // `find_references` is rendered by `reference-tools` only with `entities` (M19 `wjjr1oc0`).
        'mcp__reference-tools__find_references',
      ]
    : [];
  return {
    name: 'spec-explore',
    description:
      'Read-only explorer of the CURRENT spec (pages, entities, sections). Delegate to it to LOCATE things — paths, section anchors, entity slugs — without pulling bulk into your own context. Returns concise pointers, not full dumps. Use PROACTIVELY when discovery spans more than one channel or more than ~2 read calls.',
    prompt: specExplorePrompt(builtinsEnabled, entities),
    tools: [
      'Read',
      'Grep',
      'Glob',
      ...entityGraph,
      // reference-tools is cross-cutting (not an entity), so its read tools are listed explicitly
      // — `<tooling>` derives them from the mount, but this allow-list has no mount to read.
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
 *  entity graph (it returns HEAD) — only release-scoped `release-tools` + `load_skill_file`.
 *  2.1.5: no built-ins either. `Read` was there for the on-disk dump of a response too big
 *  for the transport; the budget now sits below that ceiling and the section window cuts
 *  a large page at the source, so there is no dump left to read. */
function buildDiffExploreSubagent(): SubagentDefinition {
  return {
    name: 'diff-explore',
    description:
      'Read-only explorer of ONE SLICE of a historical release diff for a brief. Spawn it in parallel (one per disjoint slice) and hand it a `from`/`to` + optional `roots` scope + `entityTypes` and/or `limit`/`offset` window — or one page in `paths` with a `sectionOffset`/`sectionLimit` section window, sized from `size` in the summaryOnly map; it calls heavy `release_diff` for that slice, absorbs the bulk, and returns a concise distillate (facts to inline) — keeping the whole diff out of your own context. When the brief is root-scoped, pass the same `roots` to every diff-explore slice so the pages filter is not lost on fan-out — except a one-page `paths` slice, which replaces `roots` (the two are mutually exclusive).',
    prompt: diffExplorePrompt(),
    tools: [
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
  /**
   * 2.1.77 (M45 `37ogwcgx`): the project's capability set. Without `entities` the
   * `spec-explore` allow-list carries no entity-server tool; without `briefs` the
   * built-in `diff-explore` is never built — no turn of such a project has it in
   * its `subagents` array (its only row, `brief`, is not registered either, M44
   * `1j39ajh8`). Absent (rigs) = every capability.
   */
  capabilities?: { has(name: string): boolean },
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
   * is why `spec-explore` keeps naming Read/Grep/Glob and simply loses them in a gated
   * posture, while its MCP channel, the one it actually works through, survives whole.
   * (2.1.5: `diff-explore` names no built-in at all — see its builder.)
   *
   * `builtinsEnabled` therefore no longer gates the LIST; it still shapes `spec-explore`'s
   * PROMPT, which must stop promising file tools it will not have.
   */
  const { subagent } = CONTEXT_TYPE_REGISTRY[contextType];
  const entities = capabilities ? capabilities.has('entities') : true;
  const briefs = capabilities ? capabilities.has('briefs') : true;
  /**
   * The two built-ins declare no `maxTurns` of their own and never pass through
   * `hostFrame()`, so `withTurnBudget` is what gives them the host default and states the
   * number in their prompt. Both halves matter: a prompt naming a budget the definition
   * does not actually carry would be the host lying to the model, which is the one thing
   * the frame exists not to do.
   */
  const definition: SubagentDefinition | null =
    subagent === 'diff-explore'
      ? briefs
        ? buildDiffExploreSubagent()
        : null
      : buildSpecExploreSubagent(pluginHost, builtinsEnabled, entities);
  const builtin = definition
    ? withTurnBudget(sanitizeSubagentDefinition(definition), DEFAULT_SUBAGENT_TURNS)
    : null;
  // Optional call: several fixtures reach this function through an
  // `as unknown as ProjectPluginHost` cast that predates the method.
  const contributed = resolvePluginSubagents({
    contextType,
    contributions: pluginHost.listSubagents?.() ?? [],
    hasSkillSlug,
    // The context's own built-in name is reserved: the built one's name, or
    // `diff-explore` when this context's built-in is not built (no `briefs`), so
    // a plugin cannot take that name. The other built-in's name is not reserved.
    taken: new Set(builtin ? [builtin.name] : ['diff-explore']),
    ...(mountedMcpServers
      ? { surface: { mcpServers: mountedMcpServers, builtins: new Set(CLAUDE_CODE_ALL_BUILTINS) } }
      : {}),
  });
  return builtin ? [builtin, ...contributed] : contributed;
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
