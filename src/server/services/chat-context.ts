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
import type { SubagentDefinition } from '@inharness-ai/agent-adapters';
import { CLAUDE_CODE_READONLY_BUILTINS, CLAUDE_CODE_MUTATING_BUILTINS } from '@inharness-ai/agent-adapters/claude-code';

/* ─────────────────────────── M05 m05ctxreg: context-type registry ───────────────────────────
 * Single code-level constant map (spec `m05ctxreg`), keyed by `context_type`, deciding the five
 * per-thread dimensions. This is the ONE source of truth: `buildSystemPrompt`/`subagentsFor`
 * (here), the dispatcher (`routes/agent-turn.ts`), and the enum validator (`services/chat.ts`)
 * only CONSUME it. Adding a context_type = one row here + extending the `ChatContextType` union
 * in `shared/entities.ts` — no edits to dispatch logic. NOT a SQLite table: the values are code
 * artifacts (bundled skills, MCP servers, React chrome, SubagentDefinition). */

/** Which built-in MCP servers a context_type mounts. The dispatcher resolves this descriptor to
 *  the real server set; `transagentTools` stays AND-gated by the recursion-depth guard
 *  (`!isChildBanka`) at the call site. */
export interface McpServerSet {
  /** `'all'` = full entity-plugin servers + tag/reference; `'release-only'` = whitelist
   *  (`BRIEF_ALLOWED_PLUGIN_MCP`, i.e. read-only release-tools) for the narrow brief toolset. */
  pluginServers: 'all' | 'release-only';
  planTools: boolean;
  briefTools: boolean;
  c4sTools: boolean;
  transagentTools: boolean;
}

/** One registry row — the five dimensions spec `m05ctxreg` dispatches per thread. */
export interface ContextTypeEntry {
  /** Dim 1 — bundled skill (M15) added to `inlineSkills` on top of `config.writingStyle`.
   *  `'brief-author'` for brief; `null` for chat/patch/ask (writing-style only). */
  bundledSkill: 'brief-author' | null;
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
}

/**
 * The registry. Rows reproduce the spec `m05ctxreg` table 1:1; this refactor is
 * behavior-preserving, so each row dispatches exactly what the prior scattered
 * `isBrief`/`isPatch`/`isAsk` conditionals did.
 */
export const CONTEXT_TYPE_REGISTRY: Record<ChatContextType, ContextTypeEntry> = {
  chat: {
    bundledSkill: null,
    mcp: { pluginServers: 'all', planTools: true, briefTools: false, c4sTools: true, transagentTools: true },
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: 'follow-thread',
  },
  brief: {
    bundledSkill: 'brief-author',
    mcp: { pluginServers: 'release-only', planTools: false, briefTools: true, c4sTools: false, transagentTools: false },
    uiChrome: 'brief-detail',
    subagent: 'diff-explore',
    builtinPosture: 'follow-thread',
  },
  patch: {
    bundledSkill: null,
    mcp: { pluginServers: 'all', planTools: true, briefTools: false, c4sTools: true, transagentTools: true },
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: 'follow-thread',
  },
  ask: {
    // Full `chat` toolset MINUS c4s-tools MINUS transagent-tools (recursion guard: a consulted
    // peer cannot consult/delegate to another peer). Read-only enforced via forced plan-mode.
    bundledSkill: null,
    mcp: { pluginServers: 'all', planTools: true, briefTools: false, c4sTools: false, transagentTools: false },
    uiChrome: 'overlay',
    subagent: 'spec-explore',
    builtinPosture: 'force-plan',
  },
};

/**
 * 0.1.58: a workspace peer the agent may consult via `c4s-tools.ask`. `path` is
 * the peer's `cwd` from the workspace registry — passed 1:1 as the `project`
 * param to `ask`. `name`/`description` are read from the peer's `config.json`
 * (source of truth, no denormalization); both are optional so a peer with an
 * unreadable config still renders as `<peer path="…"/>`.
 */
export interface PeerProject {
  name?: string;
  path: string;
  description?: string;
}

export interface SystemPromptInput {
  /** M31: per-project host (was the process singleton). */
  host: ProjectPluginHost;
  projectName: string;
  cwd: string;
  /** 0.1.96 multiroot: every configured page root (replaces the single `pagesDir`).
   *  Drives the `<project roots="…">` attr and the `<agent_path_scope>` allow-list. */
  roots: Root[];
  /** 0.1.96: brief store dir — rendered as `briefs=<dir>` in the `<project roots>` attr. */
  briefsDir: string;
  /** 0.1.96: patch store dir — rendered as `patches=<dir>` in the `<project roots>` attr. */
  patchesDir: string;
  currentPagePath: string | null;
  /** 0.1.96: which root the current page belongs to — the `root="…"` attr on `<current_page>`. */
  currentPageRootId?: string;
  currentPageBody: string | null;
  pageCount: number;
  /** Counts indexed by entity-plugin type. Example: `{ endpoint: 12, dto: 5 }`. */
  entityCounts: Record<string, number>;
  tagCount: number;
  sectionCount: number;
  annotations?: Annotation[];
  planMode?: boolean;
  currentPlan?: Plan | null;
  planToolsAvailable?: boolean;
  /** M24 c4s-tools: cross-cutting MCP for synchronous cross-spec consultation.
   *  Mounted for chat+patch threads; brief threads have a narrow toolset and
   *  do not see this server. */
  c4sToolsAvailable?: boolean;
  /** 0.1.58: workspace peers (current project excluded) for the
   *  `<workspace_projects>` discovery block. Gated on `c4sToolsAvailable`. */
  workspaceProjects?: PeerProject[];
  /** 0.1.58: workspace name — the `workspace="…"` attr on `<workspace_projects>`. */
  workspaceName?: string;
  writingStyle?: { slug: string; title: string } | null;
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
  agentPathScope?: { allowedPaths: string[]; disallowedPaths: string[]; artifactDenyDirs: string[] };
  /** M21 m05ctxreg: 'chat' = default, 'brief' = brief editorial thread (different toolset, different skill, different chrome). */
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
 * `;`-separated list of `id=dir` pairs: the built-in `pages` root first, then the
 * two fixed write-target dirs (`briefs`/`patches` — NOT roots, but shown for the
 * agent's spatial map), then every user root in `roots[]` order. Example:
 * `pages=pages;briefs=.claude4spec/briefs;patches=.claude4spec/patches;adr=docs/adr`.
 */
function buildRootsAttr(roots: Root[], briefsDir: string, patchesDir: string): string {
  const parts: string[] = [];
  const pagesRoot = roots.find((r) => r.id === 'pages');
  if (pagesRoot) parts.push(`pages=${pagesRoot.dir}`);
  parts.push(`briefs=${briefsDir}`);
  parts.push(`patches=${patchesDir}`);
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

function buildIdentity(pluginHost: ProjectPluginHost, projectName: string): string {
  const entityRows = buildEntityRows(pluginHost);
  const embedTypeUnion = buildEntityEmbedTypeUnion(pluginHost);
  return `<claude4spec_identity>
You are a specification writing assistant for project "${projectName}". The user is editing a specification that consists of markdown pages and structured entities. You operate via built-in file tools and MCP servers exposed in \`<tooling/>\`.

<entities>
${entityRows}
</entities>

<entity_embeds>
Pages can embed live entity views as self-closing XML tags. The Tiptap editor renders each tag as a rich UI widget that fetches fresh data from the spec — the embed stays in sync as the entity changes; you do not duplicate field/column lists into prose.

Pick the tag that matches the rendering you need:

  <inline_mention type="${embedTypeUnion}" slug="..."/>
    Inline chip inside a sentence (small pill with type icon + name). Use when referring to an entity in flowing prose. Also valid inside DTO/endpoint descriptions.

  <single_element type="..." slug="..."/>
    Block card with the entity's full detail view (fields/columns, validation, relations). Use when this page documents that specific entity.

  <element_list type="..." slugs="a,b,c"/>
    Static block list of hand-picked entities, fixed order. Use when the reader should see exactly these N items.

  <tagged_list type="..." tags="x,y" filter="and|or"/>
    Dynamic block list filtered by tag — auto-updates as entities are tagged/untagged. Use to surface e.g. "all DTOs tagged auth" without maintaining the list manually.

  <tagged_list_mixed tags="x" filter="and|or"/>
    Like tagged_list, but spans all entity types (endpoints + DTOs + tables) sharing the tag(s). Use to show a cross-cutting feature slice.

Slugs are kebab-case. Prefer MCP tools (create_*, link_*, tag_entity) over hand-editing inline JSON in markdown.
</entity_embeds>

<entity_linking_rule severity="mandatory">
When an entity that exists in the spec is named in prose, you MUST link it via an XML tag — never type the bare name. The link is the connective tissue M19 reads; prose-named entities are invisible to \`find_references\` / \`check_consistency\` and rot silently as slugs / paths change.

Banned in prose for entities that exist in the spec:
  - Endpoint paths: \`\`\`GET /api/...\`\`\`, \`\`\`POST /api/...\`\`\`, etc. (any verb + path that resolves to an active endpoint slug).
  - DTO class names: \`\`\`XyzRequest\`\`\`, \`\`\`XyzResponse\`\`\`, \`\`\`XyzDto\`\`\` (anything matching a DTO slug).
  - Database table names referenced as live entities (e.g. \`\`\`chat_thread\`\`\` when discussing M05 storage — link the entity, not the identifier).
  - AC slugs and any other active entity type registered with the plugin host.

Decision tree (pick the smallest tag that fits):
  1. Naming the entity inside a sentence → \`<inline_mention type slug/>\`.
  2. The current page documents this entity → \`<single_element type slug/>\`.
  3. Hand-picked fixed-order list of N entities → \`<element_list type slugs="a,b,c"/>\`.
  4. "All entities of one type tagged X" (auto-updating) → \`<tagged_list type tags="x"/>\`.
  5. Cross-type slice tagged X → \`<tagged_list_mixed tags="x"/>\`.

Exceptions (bare prose IS allowed):
  - The path / class name itself is the SUBJECT of the sentence — discussing naming conventions, escape syntax, regex examples, the XML tag grammar.
  - Documenting a NON-active entity (slug not registered, plugin disabled, or value is purely illustrative — e.g. example HTTP paths inside an L4 conventions section).
  - Code fences showing literal source/SQL fragments where mid-fence XML embeds would be visual noise.

Pre-edit self-check (run BEFORE every \`Edit\` / \`Write\` on \`pages/\` or \`entities/\` content):
  1. Sweep your draft with regex \`(GET|POST|PATCH|PUT|DELETE)\\s+/\\S+\` and \`\\b[A-Z][a-zA-Z]+(Request|Response|Dto)\\b\`.
  2. For each hit: verify via \`get_endpoint\` / \`get_dto\` / \`list_*\`. If the slug resolves → rewrite as the appropriate XML tag. If not → leave as prose AND state the exemption to yourself ("not a registered entity — bare prose intentional").
  3. Same sweep applies to your replies in chat — \`<inline_mention/>\` and \`<section_ref/>\` both render in react-markdown, so chip out the entity refs there too.

Severity is mandatory because the cost of compliance is low (one tag), the cost of drift is high (M19 blindness compounding across hundreds of pages).
</entity_linking_rule>

<entity_discovery severity="recommended">
Before answering a question, sketching a plan, or orienting yourself in a new area that touches a specific entity or tag, query the graph instead of reasoning from memory. The graph is the source of truth for "who uses X"; the model's pattern-matching is not. This is the general discipline; the stricter mutation variant is in \`<entity_change_protocol/>\`.

Four use-cases that should trigger discovery:
  1. **Question answering** — user asks "what uses X?" / "where does tag Y appear?" / "which AC verify auth endpoints?". Query graph first, then prose.
  2. **Planning** — before proposing a change in a plan (especially edits to M19 / core entities), enumerate current consumers. Plans drafted without discovery are blind to impact.
  3. **Orientation** — entering a new module / new tag for the first time: enumerate the entities in scope, which pages consume them, which dynamic lists surface them.
  4. **Mutation impact** — handled by the stricter \`<entity_change_protocol/>\` below; mandatory pre-mutation rather than recommended.

Four channels to use (cover all four when the question demands completeness; pick the relevant subset for narrower questions; a sweep spanning MORE THAN ONE channel can be delegated to the \`spec-explore\` subagent as a single task — see \`<delegation_policy/>\`):
  1. \`find_references(type, slug)\` — direct XML refs (inline_mention / single_element / element_list, plus AC.verifies via consistency rule 9, plus structured endpoint↔dto links).
  2. **Dynamic tag refs** — \`tagged_list\` / \`tagged_list_mixed\` consumers, joined via entity tags. Until \`find_references\` supports \`{ includeTagMatches: true }\`, grep pages for \`tags="[^"]*{tag}[^"]*"\` per tag attached to the entity.
  3. **Structured links** — \`get_endpoint(slug).dtos\` / \`get_dto(slug).endpoints\` / \`check_consistency\` rule 9 for \`ac.verifies\`.
  4. **Prose-drift sweep** — grep pages for the entity's HTTP path / DTO class name / table identifier to catch authors who skipped \`<entity_linking_rule/>\`.

Ground your answer / plan section / orientation summary on the returned set, not on what you remember. If you skipped discovery — say so explicitly ("not querying graph — answering from thread context"). Silent skipping looks identical to forgetting.

Traps (each has cost a real answer here):
  - **Reflex, not deliberation.** \`find_references\` is the first move for any (type, slug) topic; fallback channels are for when it doesn't apply.
  - **Verbalize non-entity fallbacks.** Target isn't a registered type (MCP tool name, domain term, file path) → say so explicitly, or it looks like rule-skipping.
  - **Verify the slug before calling.** Kebab vs snake vs PascalCase is a frequent trap (\`chat_thread\` table → slug \`chat-thread\`). \`list_*\`/\`get_*\` first, or a false \`[]\` reads as "unused".
  - **\`[]\` ≠ no consumers.** Direct refs empty just means channel 1 is empty — finish channels 2–4 before concluding "unused". (\`includeTagMatches: true\` will later collapse 1+2.)
</entity_discovery>

<entity_change_protocol severity="mandatory">
Before any \`update_*\` / \`delete_*\` / slug rename / re-tag on an active entity, run the four-channel discovery from \`<entity_discovery/>\` AND present the impact list to the user BEFORE mutating. Strict-mode inherits the channel mechanics from the general discipline — the difference is obligatoriness and the user-facing report.

Protocol:
  1. Resolve the target slug — \`list_*\` / \`get_*\` first; never call \`find_references\` on an unverified slug (see trap 3 in \`<entity_discovery/>\`).
  2. Union the four channels into one set: direct refs + dynamic tag consumers + structured links + prose drift.
  3. Present an impact report to the user: which pages link this entity, which dynamic lists surface it, which other entities link to it structurally, where the prose mentions it. List counts AND specific anchors / file paths.
  4. For renames — propose propagation (M19 sync sweep) as part of the report. For deletes — show what will break (broken refs, AC.verifies pointing into the void). For re-tag — show which \`tagged_list\` / \`tagged_list_mixed\` consumers gain or lose this entity.
  5. Only mutate after the user has the report. "Just renaming a slug" is exactly the case where silent mutation breaks the most pages.

Stop-rule: do NOT mutate blind. The graph is the only source of truth about impact; your memory is not. Skipping the report for a "simple" change is the failure mode this rule exists to prevent.
</entity_change_protocol>

<delegation_policy severity="recommended">
Advertises the built-in \`spec-explore\` subagent: a read-only explorer of the current spec (pages + entity graph + sections) that returns concise pointers (paths/anchors/slugs) and isolates bulk reading in its own context.
Heuristic (soft): a sweep spanning more than one discovery channel (see \`<entity_discovery/>\`), orienting yourself in a new module/tag, or a prose-drift grep across many pages → delegate to spec-explore. A single targeted lookup (one get_*/find_references call) → do it yourself.
Rule: "the parent synthesizes, the subagent locates" — a spec-explore subagent's findings are first-class evidence for \`<entity_discovery/>\` and \`<entity_change_protocol/>\`.
</delegation_policy>

<tags>
Tags are cross-cutting buckets — not entities. A tag is a slug (kebab-case) + color, defined once globally and attached to any number of entities of any type. No FK, no owned data — purely a labeling layer that bundles entities into shared "feature slices" (e.g. "auth", "billing-v2") spanning endpoints + DTOs + tables.

Workflow:
  1. \`create_tag(slug, color)\` — define once globally.
  2. \`tag_entity(type, slug, tagSlug)\` — attach per-entity, any active type.
  3. Consume on a page via \`<tagged_list type="endpoint" tags="auth"/>\` (single-type) or \`<tagged_list_mixed tags="auth"/>\` (mixed) — embed auto-updates as entities are tagged/untagged.

Use tags for **dynamic, cross-cutting groupings** (feature slices). Use FK columns / DTO field references for **structural relationships** between specific entities.
</tags>

<todo_markers>
  <todo comment="..."/>
Lightweight inline TODO marker. Lives only in markdown — never persisted as an entity. To survey open TODOs, Grep pages/ for \`<todo comment=\`.
</todo_markers>

<diagram_references>
  <diagram slug="..." caption="..."/>
Self-closing reference to a \`diagram\` entity (the 7th entity type). The Mermaid DSL \`source\` is the entity's truth (stored in \`.claude4spec/entities/diagram/<slug>.json\`), NOT inline in the page. The page tag carries only \`slug\` (which diagram) and an optional \`caption\` — caption is per-reference prose, so the same diagram can show different captions in different places. Tiptap fetches the source by slug and renders it live, with a fallback \`<pre>\` on parse error. Manage diagrams with the \`diagram-tools\` MCP server (create_diagram / update_diagram / delete_diagram); \`create_diagram\` takes an optional transient \`caption\` used only to seed the slug. Insertable via slash command \`/diagram\` (authors the source, creates the entity, inserts the reference) in page and plan editors.

Example:
  <diagram slug="auth-flow" caption="Auth flow"/>
</diagram_references>

<sections_and_anchors>
Sections (counted in \`<project sections=...>\`) are identified by an immutable 8-char anchor injected on the line before each markdown heading: \`<!-- anchor: xxxxxxxx -->\`. The indexer assigns anchors automatically — do not invent, edit, or strip them. When you rename a heading or move a section (within a page or to another file), keep the heading + anchor + body glued together; the indexer recognizes the move and the page-versioning subsystem records it. Never leave "(moved to MXX)" / "(see MNN)" breadcrumb prose behind — move history is owned by the versioning system, not by spec text.

To LINK to a section, embed \`<section_ref anchor="xxxxxxxx"/>\` inline. It renders as a clickable chip (heading text + smooth scroll / cross-page nav) in **both** rendering pipelines — Tiptap (the page editor) and react-markdown (your chat replies to the user, plus plan blame and annotation popups). So \`<section_ref/>\` is the right tool whether you are editing a markdown page in \`pages/\` or answering the user inline in this chat. Anchors are globally unique across \`pages/\`, so the anchor alone is sufficient — no page path needed. **Prefer \`<section_ref/>\` over prose like "see section X in pages/foo.md"** in markdown edits AND in chat replies — the ref survives heading rewrites and cross-file moves; plain prose does not, and stale "see X" pointers are exactly the kind of breadcrumb that the versioning system is supposed to make unnecessary. For whole-page links: in markdown pages use \`@pages/foo.md\` (page-only) or \`@pages/foo.md#xxxxxxxx\` (page + section context); in chat replies the \`@pages/...\` form does NOT render as a chip (only user messages and Tiptap parse it) — use a plain markdown link with a readable label, or point at a specific section via \`<section_ref/>\`. To discover an anchor, Read the page and grab the \`<!-- anchor: ... -->\` line under the heading you want to target.
</sections_and_anchors>

<current_page_handling>
The \`<current_page>\` tag shows what the user is currently viewing. For pages longer than ${CURRENT_PAGE_PREVIEW_LINES} lines, only the first ${CURRENT_PAGE_PREVIEW_LINES} are inlined as a preview (see preview_lines/total_lines attributes). When you need content beyond the preview, Read the page from disk.
</current_page_handling>

<annotation_handling>
When the request includes \`<annotations>\`, treat them as the primary context for the user's message. Address each annotation specifically in your response. If an annotation references a page different from \`<current_page>\`, Read that page first before responding.
</annotation_handling>
</claude4spec_identity>`;
}

const PLAN_TOOLS_USAGE = `<plan_tools_usage>
plan-tools MCP server is scoped automatically to this thread (no threadId param):
  - get_plan — read current plan state
  - update_plan (action: replace | append | insert_after_section) — edit the plan
  - list_plan_versions, get_plan_version — inspect history
Inside plan_mode: persist the plan via update_plan instead of writing it as prose.
Outside plan_mode: use update_plan when the user explicitly requests a deployment plan or architectural proposal.
</plan_tools_usage>`;

/**
 * M24 c4s-tools: usage contract for cross-spec synchronous consultation.
 * Surfaces the same flow as the `c4s ask` CLI (M11) but via MCP, so it works
 * in plan_mode (Bash is filtered, MCP is not). Mounted for chat + patch
 * contexts; brief threads do not see it (narrow editorial toolset), and 0.1.79
 * `ask` threads do not either (recursion guard: a peer cannot consult a peer).
 */
const C4S_TOOLS_USAGE = `<c4s_tools_usage>
c4s-tools MCP server consults another claude4spec specification synchronously (READ-ONLY peer).
  - ask({ message, project? | server?, threadId?, model? }) — returns { threadId, answer }
Use \`project\` (local path to peer .claude4spec/) OR \`server\` (URL override); if both, \`server\` wins.
The peer answers without ever mutating its own spec (Write/Edit/Bash banned; entity/page edits soft-blocked).
Continue an existing peer thread by passing its \`threadId\`.
Works in plan_mode — MCP is not filtered by READONLY_BUILTINS, so this works where Bash-shelled \`c4s ask\` does not.
The peers available in this workspace are listed in \`<workspace_projects/>\`.
</c4s_tools_usage>`;

/**
 * M21: usage contract for `brief-tools` MCP server (analog `PLAN_TOOLS_USAGE`).
 * Mounted only when this chat thread has `context_type='brief'`. The full
 * editorial doctrine lives in the bundled skill `brief-author` (loaded as
 * project_skill); this block describes the tool surface so the agent knows
 * what is callable in this thread.
 */
const BRIEF_TOOLS_USAGE = `<brief_tools_usage>
brief-tools MCP server is scoped automatically to this brief (no path param):
  - get_brief — read current brief { frontmatter, body, content, hash }
  - update_brief (action: replace | append | insert_after_section) — edit the body
      * frontmatter is IMMUTABLE for the agent (type, from_release, to_release, generated_at, generator_version)
      * pass expectedHash from get_brief for optimistic concurrency (mismatch → BRIEF_CONFLICT)
      * unknown anchor → fallback append-at-end with warning
You also have read-only release-tools (get_release, get_release_diff, list_releases) for grounding the narrative.
You do NOT have filesystem access (no Read/Write/Edit/Glob/Grep/Bash). Brief content flows through get_brief / update_brief only.
</brief_tools_usage>`;

// Interpolated from agent-adapters' real CLAUDE_CODE_READONLY_BUILTINS /
// CLAUDE_CODE_MUTATING_BUILTINS — these ARE the exact values the adapter
// assigns to options.tools/disallowedTools when planMode is true, so this is
// a 1:1 mirror of actual gating, not a hand-maintained paraphrase that can
// drift (see 0-1-125-to-next follow-up).
const PLAN_MODE = `<claude4spec_plan_mode>
Plan Mode is ACTIVE. Investigate and propose — do not modify.

The plan you draft must conform to the project skill referenced in <project_skill/>. Before drafting or updating the plan, ensure Skill(slug) has been called this turn — its conventions (module/layer structure, naming, file layout, quality rules) constrain every line of the plan. If the user's request appears to violate those conventions, surface the conflict in the plan rather than silently working around it.

Forbidden (mutating):
  - Built-in: ${CLAUDE_CODE_MUTATING_BUILTINS.join(', ')}
  - MCP: any create_*, update_*, delete_*, link_*, unlink_*, tag_entity, untag_entity

Allowed (read-only):
  - Built-in: ${CLAUDE_CODE_READONLY_BUILTINS.join(', ')}
  - MCP: list_*, get_*, find_*, check_consistency

plan-tools (get_plan, update_plan, list_plan_versions, get_plan_version) are EXEMPT — use update_plan to persist the plan rather than writing it as prose in your reply.

End your response with a concrete, numbered plan the user can review and approve before execution. If a request clearly requires mutation, acknowledge and describe what you would do — do not execute.
</claude4spec_plan_mode>`;

/**
 * M13: the host-level `<mcp>` line for the generic `entity-tools` server —
 * CRUD for every active entity type, composed once by the host rather than
 * per-type. Static tool list (the active TYPE set lives in `<project>`/
 * `<entities>`, already built from `listEntities()` elsewhere in this file).
 */
function buildEntityToolsLine(): string {
  return `  <mcp name="entity-tools">create_entities, get_entities, update_entities, delete_entities, list_entities, search_entities, describe_entity_type</mcp>`;
}

// Deduped union of agent-adapters' real read-only + mutating builtin arrays —
// a sourced, generated list rather than a hand-maintained one (see
// 0-1-125-to-next follow-up). Not necessarily exhaustive for the unrestricted
// non-plan-mode catalog (agent-adapters doesn't export a "full SDK catalog"
// constant), but every name in it is real and confirmed.
const CLAUDE_CODE_ALL_BUILTINS = Array.from(new Set([...CLAUDE_CODE_READONLY_BUILTINS, ...CLAUDE_CODE_MUTATING_BUILTINS]));

function buildTooling(pluginHost: ProjectPluginHost, planToolsAvailable: boolean, c4sToolsAvailable: boolean): string {
  const lines: string[] = [
    `<tooling>`,
    `  <builtin>${CLAUDE_CODE_ALL_BUILTINS.join(', ')}</builtin>`,
    buildEntityToolsLine(),
  ];
  for (const m of pluginHost.listEntities()) {
    if (!m.systemPrompt.mcpToolsLine) continue;
    // mcpToolsLine format: "{server-name}: {tool, tool, ...}" — M13: now ONLY
    // the type's custom (non-CRUD) server, e.g. "endpoint-tools: link_dto, unlink_dto".
    const colonIdx = m.systemPrompt.mcpToolsLine.indexOf(':');
    if (colonIdx === -1) continue;
    const serverName = m.systemPrompt.mcpToolsLine.slice(0, colonIdx).trim();
    const toolList = m.systemPrompt.mcpToolsLine.slice(colonIdx + 1).trim();
    lines.push(`  <mcp name="${serverName}">${toolList}</mcp>`);
  }
  lines.push(
    `  <mcp name="reference-tools">create_tag, update_tag, delete_tag, list_tags, tag_entity, untag_entity, find_references, check_consistency</mcp>`,
  );
  if (planToolsAvailable) {
    lines.push(`  <mcp name="plan-tools">get_plan, update_plan, list_plan_versions, get_plan_version</mcp>`);
  }
  if (c4sToolsAvailable) {
    lines.push(`  <mcp name="c4s-tools">ask</mcp>`);
  }
  lines.push(`</tooling>`);
  return lines.join('\n');
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
const SPEC_EXPLORE_PROMPT = `You are a read-only explorer of the CURRENT specification (pages + entities + sections).

Your job: explore on the parent's behalf and report CONCISE findings — file paths, section anchors, and entity slugs — never the full bulk you read. You exist to keep the parent's context small.

Tools: Read/Grep/Glob over the project, plus read-only entity-graph MCP (get_*/list_*, find_references, check_consistency, list_sections).

Hard rules:
- NEVER mutate anything (no create/update/delete; you have no such tools).
- Report pointers (paths / anchors / slugs), not dumps. The parent decides; you locate.`;

const DIFF_EXPLORE_PROMPT = `You are a read-only explorer of ONE SLICE of a HISTORICAL release diff, working for a brief-author parent.

The parent hands you a slice — a \`from\`/\`to\` pair, an optional \`roots\` page-root scope, plus \`entityTypes\` and/or a \`limit\`/\`offset\` window. Your job: call \`release_diff\` for exactly that slice, absorb its heavy \`before\`/\`after\`/\`content\`, and return a CONCISE DISTILLATE: the concrete facts the parent must inline (each changed entity/section by name, its key signatures / field shapes / SQL / view URLs / file paths, and a one-line framing of the change — including deletions). The bulk stays with you; only the distillate goes back, keeping the parent's context small.

How to read your slice (windowing is PRIMARY):
- Normal path: call \`release_diff({ fromIdOrName, toIdOrName, roots, ...slice })\` and read the returned \`MCPReleaseDiff\` directly — the parent already windowed the slice to fit.
- \`roots\` scope: if the parent gave you \`roots\`, pass it through verbatim on EVERY \`release_diff\` call — it narrows the PAGES dimension to the brief's scope. Dropping it silently widens the diff to all releasable roots and leaks out-of-scope pages into the brief.
- Fallback ONLY when a single slice is still too large and the SDK dumps the tool result to disk: \`Read\` that dump file. Do not otherwise touch the filesystem.

Tools: \`release-tools\` MCP (\`release_diff\`; \`release_show\` / \`release_list\` available but rarely needed) and Read/Grep/Glob — the latter ONLY for a release-diff dump file the SDK wrote to disk.

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
function buildSpecExploreSubagent(pluginHost: ProjectPluginHost): SubagentDefinition {
  return {
    name: 'spec-explore',
    description:
      'Read-only explorer of the CURRENT spec (pages, entities, sections). Delegate to it to LOCATE things — paths, section anchors, entity slugs — without pulling bulk into your own context. Returns concise pointers, not full dumps. Use PROACTIVELY when discovery spans more than one channel or more than ~2 read calls.',
    prompt: SPEC_EXPLORE_PROMPT,
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
      'mcp__reference-tools__list_sections',
    ],
    model: 'sonnet',
  };
}

/** `diff-explore`: read-only exploration of a historical `release_diff`. Deliberately WITHOUT the
 *  entity graph (it returns HEAD) — only release-scoped `release-tools` + Read for the on-disk dump. */
function buildDiffExploreSubagent(): SubagentDefinition {
  return {
    name: 'diff-explore',
    description:
      'Read-only explorer of ONE SLICE of a historical release diff for a brief. Spawn it in parallel (one per disjoint slice) and hand it a `from`/`to` + optional `roots` scope + `entityTypes` and/or `limit`/`offset` window; it calls heavy `release_diff` for that slice, absorbs the bulk, and returns a concise distillate (facts to inline) — keeping the whole diff out of your own context. When the brief is root-scoped, pass the same `roots` to every diff-explore slice so the pages filter is not lost on fan-out.',
    prompt: DIFF_EXPLORE_PROMPT,
    tools: [
      'Read',
      'Grep',
      'Glob',
      'mcp__release-tools__release_show',
      'mcp__release-tools__release_diff',
      'mcp__release-tools__release_list',
    ],
    model: 'sonnet',
  };
}

/**
 * 0.1.67: fourth dimension of the `context_type` registry — which built-in read-only subagent is
 * injected into `adapter.execute({ subagents })`. `chat`/`patch` get `spec-explore` (current
 * entity graph); `brief` gets `diff-explore` (release-scoped, no entity graph).
 */
export function subagentsFor(
  contextType: ChatContextType,
  pluginHost: ProjectPluginHost,
): SubagentDefinition[] {
  const { subagent } = CONTEXT_TYPE_REGISTRY[contextType];
  return subagent === 'diff-explore'
    ? [buildDiffExploreSubagent()]
    : [buildSpecExploreSubagent(pluginHost)];
}

/**
 * 0.1.58: discovery block listing workspace peers the agent may consult via
 * `c4s-tools.ask`. The current project is excluded upstream. `path` is ready to
 * pass 1:1 as the `project` param; empty `name`/`description` attrs are dropped
 * by `attrs()`, so a peer with an unreadable config renders as `<peer path="…"/>`.
 */
function buildWorkspaceProjects(workspaceName: string, peers: PeerProject[]): string {
  const lines = [`<workspace_projects ${attrs({ workspace: workspaceName })}>`];
  for (const p of peers) {
    lines.push(`  ${selfClose('peer', attrs({ name: p.name, path: p.path, description: p.description }))}`);
  }
  lines.push(`</workspace_projects>`);
  return lines.join('\n');
}

function buildProjectSkill(ws: { slug: string; title: string }): string {
  return [
    `<project_skill ${attrs({ slug: ws.slug, title: ws.title })}>`,
    `Skill "${ws.title}" (slug "${ws.slug}") contains the BINDING project specification — module/layer structure, file layout, naming, workflow, and quality rules. Every page edit, plan, entity/module change, and structural answer must conform to it.`,
    ``,
    `Required behavior:`,
    `  1. Before your first tool call in this thread, call Skill("${ws.slug}").`,
    `  2. Re-call Skill("${ws.slug}") whenever you transition from plan mode into execution, even if loaded earlier.`,
    `  3. Treat its content as authoritative — if a user request seems to contradict it, surface the conflict rather than silently overriding the convention.`,
    `</project_skill>`,
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
function buildAgentPathScope(
  scope: { allowedPaths: string[]; disallowedPaths: string[]; artifactDenyDirs: string[] },
  cwd: string,
  roots: Root[],
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
  lines.push(
    `Stay within ALLOWED minus DISALLOWED. Do not touch files outside this scope (e.g. other projects, source code next to the spec). If a task seems to require an out-of-scope path, say so instead of attempting it. Never hand-edit the C4S artifact dirs — use plan-tools / brief-tools / entity-tools / release-tools instead.`,
    `</agent_path_scope>`,
  );
  return lines.join('\n');
}

/** True when `child` is the same as or nested under `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * M21 brief-context system prompt. Minimal frame: identity, brief-tools usage,
 * brief-author skill (genre — bundled), writing-style skill (methodology —
 * supplies workflows/brief.md), brief snapshot, optional annotations.
 * Excludes pluginHost tooling, plan tools, entity counters — agent operates
 * on a single artifact with a reduced surface.
 */
function buildBriefSystemPrompt(input: {
  projectName: string;
  cwd: string;
  brief: Brief | null;
  annotations: Annotation[];
  writingStyle: { slug: string; title: string } | null;
  conversationalLanguage?: string;
}): string {
  const parts: string[] = [];
  parts.push(
    [
      `<claude4spec_brief_identity>`,
      `You are operating in BRIEF mode for project "${input.projectName}".`,
      `cwd: ${input.cwd}`,
      `Your sole task is editorial work on a single brief artifact (markdown narrative summarising what changed between two releases).`,
      `Use brief-tools (get_brief / update_brief) and read-only release-tools.`,
      `You have NO filesystem access (no Read/Write/Edit/Glob/Grep/Bash) and NO plan/entity tools.`,
      `</claude4spec_brief_identity>`,
    ].join('\n'),
  );

  parts.push(
    [
      `<self_contained_invariant>`,
      `The brief file is consumed by TWO audiences with very different capabilities:`,
      ``,
      `  1. Human reader in the claude4spec web UI: can click references, view rendered Tiptap, navigate to source entities/pages.`,
      `  2. Coding agent in some OTHER terminal (Claude Code, Cursor, plain \`cat brief.md | llm\`, agent in another repo, CI bot reading the file).`,
      `     Has ONLY the raw bytes of this file. NO database, NO MCP server, NO claude4spec UI, NO claude4spec CLI assumed.`,
      ``,
      `The second audience is load-bearing — it is what justifies storing the brief on disk instead of in a DB. If the brief is unintelligible without claude4spec running, the artifact has failed its primary purpose.`,
      ``,
      `Therefore the brief MUST be self-contained. The output of update_brief is binding regardless of audience:`,
      ``,
      `  - INLINE the actual content of every change. Show field names, types, before/after fragments verbatim. Never write "the User DTO got a new field" without showing the field. Never write "see release diff" — quote the diff fragment.`,
      `  - DO NOT use claude4spec-internal reference grammar (\`<single_element>\`, \`<inline_mention>\`, \`<element_list>\`, \`<tagged_list>\`, \`<tagged_list_mixed>\`, \`@page.md\` mentions). Those resolve ONLY inside the claude4spec UI; in a second-audience terminal they are literal XML/markdown noise that confuses, not helps.`,
      `  - Use plain prose when naming things: "the \`auth/login\` endpoint (POST)", "the \`User\` DTO field \`email: string\`", "page \`pages/auth/flow.md\`".`,
      `  - Write file paths, function signatures, SQL fragments, and code snippets verbatim where relevant. The reader cannot fetch them on demand.`,
      `  - The "For implementers" section must list CONCRETE edit targets: file paths, function names, SQL/migration snippets — actionable without further investigation.`,
      ``,
      `**Describe the SYSTEM, not the spec edits.** The brief is about how the specified system behaves now vs. before — not about which markdown files gained/lost sections. Editorial mechanics belong in version history, not in the brief:`,
      ``,
      `  - GOOD: "Brief threads whitelist their toolset — only \`brief-tools\` and \`release-tools\` are mounted; plan/entity MCPs are silently omitted to keep the editorial agent on its lane."`,
      `  - BAD: "Section 'Tool whitelist' was added to \`m05-chat-agent.md\` between 'Context registry' and 'System prompt builder'."`,
      ``,
      `  - GOOD: "New \`chat_thread.context_type\` column (\`CHECK chat|brief\`, default \`'chat'\`). Existing threads backfill to \`'chat'\` on migration."`,
      `  - BAD: "Migration 022 was added under \`db/migrations/\`."`,
      ``,
      `If a diff is purely editorial — anchor added, section reordered without content change, typo fix, formatting, prose smoothing, comment moved, heading renamed without semantic shift — DROP it from the brief. It does not earn space. The reader does not care that page X gained a \`<!-- anchor -->\` line; they care what the system now does differently.`,
      ``,
      `When this invariant conflicts with brevity, choose self-containment. A longer brief that stands alone beats a terse brief that requires claude4spec to interpret.`,
      `</self_contained_invariant>`,
    ].join('\n'),
  );

  parts.push(
    [
      `<tooling>`,
      `  <mcp name="brief-tools">get_brief, update_brief</mcp>`,
      `  <mcp name="release-tools">get_release, get_release_diff, list_releases</mcp>`,
      `</tooling>`,
    ].join('\n'),
  );
  parts.push(BRIEF_TOOLS_USAGE);
  // 0.1.51: only `<conversational_language>` in the brief frame — `<spec_language>`
  // is omitted (it governs spec content; the brief is a separate artifact).
  if (input.conversationalLanguage) {
    parts.push(buildConversationalLanguage(input.conversationalLanguage));
  }
  parts.push(buildProjectSkill({ slug: 'brief-author', title: 'Brief Author' }));

  // Writing-style skill supplies methodology-specific brief guidance
  // (filter rules, inlining patterns, "For implementers" structure)
  // via its `workflows/brief.md`. Without it, agent uses brief-author
  // genre rules alone — generic but free of writing-style-specific leakage.
  if (input.writingStyle) {
    parts.push(buildProjectSkill({ slug: input.writingStyle.slug, title: input.writingStyle.title }));
    parts.push(
      [
        `<writing_style_brief_workflow ${attrs({ slug: input.writingStyle.slug })}>`,
        `For brief generation in this writing style, read \`workflows/brief.md\` within Skill("${input.writingStyle.slug}") if present. It defines which RawDelta entries are spec-format conventions (drop), how to inline this style's entity types, and the "For implementers" structure for this style. Read it after Skill("brief-author").`,
        `</writing_style_brief_workflow>`,
      ].join('\n'),
    );
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
    parts.push(buildAnnotations(input.annotations));
  }

  return parts.join('\n\n');
}

const CURRENT_PAGE_PREVIEW_LINES = 40;

function buildCurrentPage(path: string, body: string | null, root: string): string {
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
  return `<current_page ${attrs({
    path,
    root,
    total_lines: totalLines,
    preview_lines: `1-${CURRENT_PAGE_PREVIEW_LINES}`,
  })}>
${preview}
[... ${remaining} more line${remaining === 1 ? '' : 's'} truncated. Read ${path} to load the full page.]
</current_page>`;
}

function buildAnnotations(annotations: Annotation[]): string {
  const lines: string[] = [`<annotations>`];
  for (const a of annotations) {
    lines.push(`  <annotation ${attrs({ page: a.page, comment: a.comment ?? '' })}>`, a.text, `  </annotation>`);
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
      status: fm.status ?? 'awaiting',
      brief: typeof fm.brief === 'string' ? fm.brief : undefined,
      hash: patch.hash,
    })}>`,
    `This thread exists to resolve the patch below — a coding agent in another`,
    `terminal filed it as feedback while implementing a brief. Read it, then`,
    `apply its findings to the specification (edit the relevant pages/entities).`,
    `Once the spec reflects the patch, the agent marks it \`status: completed\`.`,
    ``,
    patch.content,
    `</current_patch>`,
  ].join('\n');
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const {
    host,
    projectName,
    cwd,
    roots,
    briefsDir,
    patchesDir,
    currentPagePath,
    currentPageRootId = 'pages',
    currentPageBody,
    pageCount,
    entityCounts,
    tagCount,
    sectionCount,
    annotations = [],
    planMode = false,
    currentPlan = null,
    planToolsAvailable = false,
    c4sToolsAvailable = false,
    workspaceProjects = [],
    workspaceName,
    writingStyle = null,
    specLanguage,
    conversationalLanguage,
    agentPathScope,
    contextType = 'chat',
    brief = null,
    patch = null,
  } = input;

  // M05 m05ctxreg: the brief context (uiChrome='brief-detail' in the registry) uses a
  // completely different prompt frame — no plugin tooling, no entity counters, no plan
  // tools. Just identity, brief-tools usage, brief-author skill (genre) + writing-style
  // skill (methodology, supplies workflows/brief.md), and the brief snapshot.
  if (CONTEXT_TYPE_REGISTRY[contextType].uiChrome === 'brief-detail') {
    return buildBriefSystemPrompt({ projectName, cwd, brief, annotations, writingStyle, conversationalLanguage });
  }

  const parts: string[] = [];

  parts.push(buildIdentity(host, projectName));

  // Project self-close — env metadata (cwd, roots) before counters, then
  // entity attrs in displayOrder, with `tags` last:
  // (name, cwd, roots, pages, sections, [entities...], tags).
  const projectAttrs: Record<string, string | number> = {
    name: projectName,
    cwd,
    roots: buildRootsAttr(roots, briefsDir, patchesDir),
    pages: pageCount,
    sections: sectionCount,
  };
  for (const m of host.listEntities()) {
    if (!m.systemPrompt.roleNoun) continue; // opt-out (legacy ui-view)
    const label = m.systemPrompt.countStat.label;
    projectAttrs[label] = entityCounts[m.type] ?? 0;
  }
  projectAttrs.tags = tagCount;
  parts.push(selfClose('project', attrs(projectAttrs)));

  parts.push(buildTooling(host, planToolsAvailable, c4sToolsAvailable));

  if (planToolsAvailable) {
    parts.push(PLAN_TOOLS_USAGE);
  }

  if (c4sToolsAvailable) {
    parts.push(C4S_TOOLS_USAGE);
  }

  // 0.1.58 step 5a: peer-discovery block — right after C4S_TOOLS_USAGE (it
  // completes the c4s-tools contract), before the project skill. Same gate as
  // <c4s_tools_usage>; a workspace with no peers (after excluding the current
  // project) omits the block entirely. Absent in the brief frame (flag false).
  if (c4sToolsAvailable && workspaceProjects.length > 0) {
    parts.push(buildWorkspaceProjects(workspaceName ?? '', workspaceProjects));
  }

  if (writingStyle) {
    parts.push(buildProjectSkill(writingStyle));
  }

  // 0.1.51 step 6a/6b: language directives, right after the project skill and before
  // the patch/page blocks. Gated on non-null (display name from SUPPORTED_LANGUAGES).
  if (specLanguage) {
    parts.push(buildSpecLanguage(specLanguage));
  }
  if (conversationalLanguage) {
    parts.push(buildConversationalLanguage(conversationalLanguage));
  }

  // 0.1.90 step 6c: soft agent path-scope directive, right after the language
  // directives and before <current_patch>. 0.1.130: gated only on `agentPathScope` being
  // present — the block is now always emitted (its `artifactDenyDirs` ALWAYS-DISALLOWED
  // line is unconditional). This sits on the non-brief path (brief frame returned early
  // above), so the block is present in chat/patch/ask and absent in brief.
  if (agentPathScope) {
    parts.push(buildAgentPathScope(agentPathScope, cwd, roots));
  }

  // M23: patch-resolution thread. The patch file (a coding agent's feedback
  // about a spec problem found during implementation) is injected verbatim;
  // this thread's job is to fold its findings into the spec, then the author
  // marks the patch `completed`.
  if (contextType === 'patch' && patch) {
    parts.push(buildCurrentPatch(patch));
  }

  // 0.1.79: `ask` (peer-consult) emits NO <current_*> block — it explores the
  // peer's spec headlessly, with no "current page" anchor. (In practice the
  // headless turn passes no page anyway; this guard makes the contract explicit.)
  if (contextType !== 'ask' && currentPagePath) {
    parts.push(buildCurrentPage(currentPagePath, currentPageBody, currentPageRootId));
  }

  if (annotations.length > 0) {
    parts.push(buildAnnotations(annotations));
  }

  if (currentPlan && currentPlan.body.trim().length > 0) {
    parts.push(
      `<current_plan ${attrs({ version: currentPlan.currentVersion })}>\n${currentPlan.body}\n</current_plan>`,
    );
  }

  if (planMode) {
    parts.push(PLAN_MODE);
  }

  return parts.join('\n\n');
}
