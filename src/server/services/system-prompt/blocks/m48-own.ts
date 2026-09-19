import { PLAN_MODE_DENY_GROUPS, type ToolGroup } from '@inharness-ai/agent-adapters';
import { buildClaudeCodeToolPolicy, claudeCodeKnownBuiltins } from '@inharness-ai/agent-adapters/claude-code';
import type { Annotation } from '../../../../shared/entities.js';
import type { Root } from '../../../../shared/types.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import { CATALOG } from '../../../operations/catalog.js';
import { registerCoreOperations } from '../../../operations/core-operations.js';
import { DIRECT_FILESYSTEM_DENY_GROUPS } from '../../agent-tool-posture.js';
import { attrs, selfClose } from '../glue.js';
import type { McpInventoryEntry, PromptBlock } from '../types.js';

/*
 * M48 — the blocks no module contributes: the composer's own. They talk about
 * the prompt itself, the agent's identity and the posture it works in, and the
 * writing conventions no single module owns.
 *
 * `<claude4spec_plan_mode>` classifies each mounted tool by its catalog
 * `opClass`, and on an unseeded catalog every tool looks alike — so the catalog
 * is seeded here too. Idempotent.
 */
registerCoreOperations();

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
 * They are separate builders now, assigned to layers by the default composition
 * (`compositions/default.ts`), so that a block sits next to what it talks about
 * and the order is a value you can read rather than a history you have to
 * reconstruct. `identity` keeps the four sentences that are actually identity.
 */
function buildIdentity(projectName: string): string {
  return `<claude4spec_identity>
You are a specification writing assistant for project "${projectName}". The user is editing a specification that consists of markdown pages and structured entities. The pages are markdown on disk; the entities are structured records reached only through MCP tools. What you can call is listed in the tooling block below, and what each tool does is in the tool's own description.
</claude4spec_identity>`;
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
Lightweight inline TODO marker. Lives only in markdown — never persisted as an entity. To survey open TODOs, call \`search_pages({ regex: '<todo comment=', mode: 'hits' })\` — the regex is matched per LINE, and this marker's opening never spans one, so the sweep is legal. Ask for \`hits\` explicitly: the default \`map\` returns identity rows with no prose, which tells you WHICH pages carry a TODO but never what any of them says.
</todo_markers>`;

/**
 * 0.2.65 — the block that makes task tracking OURS rather than the preset's.
 *
 * A project with `agent.claudeUsePreset: false` REPLACES the Claude Code preset
 * rather than appending to it, and the preset carried the only "keep a task
 * list" instruction the model ever saw. This project has run with the preset off
 * since 2026-07-04, so for two months the agent was asked to track nothing —
 * which is why it did so less and less consistently. Stated here, the behaviour
 * stops being a function of that flag.
 *
 * WHY IT LEADS WITH `TodoWrite`, and not with the `TaskCreate`/`TaskUpdate` pair
 * the reporting brief prescribed: against the version this repo actually pins
 * (`agent-adapters` ^0.9.9, published), those two are precisely the calls that do
 * not persist. `mergeTaskToolInputIntoSnapshot` there merges only when the raw
 * input carries a top-level `subject`/`description`/`activeForm`/`status`, so a
 * batch `TaskCreate({ tasks: [...] })` returns nothing and a `TaskUpdate` keyed on
 * `state` is a silent no-op. `TodoWrite` takes a different route entirely —
 * `todoItemsFromTodoWriteInput`, a full-list replace with no such guard — and
 * reaches `chat_thread.current_todo_items` TODAY. Naming only the pair would have
 * steered the model off the one path that still works, and made the panel less
 * likely to fill rather than more. The pair is named as an equal because it is
 * the right shape once the library fix (unreleased at time of writing, commit
 * `287d2cc`) ships; nothing here has to change then.
 *
 * The tools themselves are opted into explicitly in `agent-turn.ts` — see
 * `autoApproveTools` there. Instruction and capability are separate things.
 *
 * Omitted from the `ask` frame. That turn is a headless read-only peer consult
 * with no viewer, so its list would be written for nobody — and the block's whole
 * premise, that someone is watching it advance, would be a false statement.
 */
const TASK_TRACKING = `<task_tracking>
Work that takes more than a couple of steps gets a TASK LIST, and the user watches it advance while you work — the list is rendered live beside your reply, so it is a channel to them, not a private scratchpad.

Keep it with \`TodoWrite\`, which takes the WHOLE list every time: send it as soon as the shape of the work is clear, BEFORE the first substantive step rather than after it, and resend it with updated statuses as you go. A list published at the end documents what you did, which your reply already does. (\`TaskCreate\` / \`TaskUpdate\` express the same thing one task at a time and are equally welcome.)

Name each task as the outcome it produces, not as the tool you will reach for. Mark a task in progress when you start it and completed the moment it is done, with exactly one in progress at a time — a list that jumps from all-pending to all-completed in one burst told the user nothing while they were waiting.

Skip the list for single-step work and for a question you can simply answer. A one-item list is noise.
</task_tracking>`;

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

The plan you draft must conform to the writing style referenced in <project_writing_skill/> — its conventions constrain every line of the plan. If that skill has not been loaded in this thread yet, load it before drafting or updating the plan. If the user's request appears to violate its conventions, surface the conflict in the plan rather than quietly working around it.

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
export const CLAUDE_CODE_ALL_BUILTINS = claudeCodeKnownBuiltins();

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

export const M48_PROMPT_BLOCKS: readonly PromptBlock[] = [
  { name: 'claude4spec_identity', render: (c) => buildIdentity(c.projectName) },
  {
    name: 'project',
    /**
     * Option `roots: false` — the brief composition's `<project/>`, which names
     * the project and its cwd only: a brief thread has no page tools to pass a
     * root identifier to.
     */
    render: (c, options) => {
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
        ...(options?.roots === false ? {} : { roots: buildRootsAttr(c.roots) }),
      };
      return selfClose('project', attrs(projectAttrs));
    },
  },
  { name: 'tooling', render: (c) => buildTooling(c.mcpInventory, c.agentFilesystemAccess?.enabled ?? false) },
  { name: 'entity_embeds', render: (c) => buildEntityEmbeds(c.host) },
  { name: 'discovery_and_impact', render: () => buildDiscoveryAndImpact() },
  { name: 'tags', render: () => buildTags() },
  { name: 'todo_markers', render: () => TODO_MARKERS },
  { name: 'task_tracking', render: (c) => (c.contextType === 'ask' ? null : TASK_TRACKING) },
  { name: 'sections_and_anchors', render: () => SECTIONS_AND_ANCHORS },
  {
    name: 'annotations',
    /**
     * Option `pageRoot: false` — for a composition with no `<current_page>`, so
     * that no annotation borrows a root from a page the prompt does not show.
     */
    render: (c, options) =>
      c.annotations.length > 0
        ? options?.pageRoot === false
          ? buildAnnotations(c.annotations, null, 'pages')
          : buildAnnotations(c.annotations, c.currentPagePath, c.currentPageRootId)
        : null,
  },
  { name: 'annotation_handling', render: (c) => (c.annotations.length > 0 ? ANNOTATION_HANDLING : null) },
  { name: 'claude4spec_plan_mode', render: (c) => (c.planMode ? buildPlanMode(c.mcpInventory) : null) },
];
