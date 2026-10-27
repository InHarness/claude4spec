import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import { INTERACTION_RULES } from '../../interaction-rules.js';
import { diagramSystemPrompt } from '../../../entities/diagram/system-prompt.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import type { PatchDetail, PatchService } from '../../patch.js';
import type { CapturedMcpServer } from '../../../plugin-runtime/index.js';
import { buildC4sToolsServer } from '../../../mcp/c4s-tools.js';
import { buildPatchToolsServer } from '../../../mcp/patch-tools.js';

/**
 * 2.1.57 (u12) — the prompt-block templates (`szablon-*` code snippets, L15)
 * asserted against the blocks that render them.
 *
 * The window changed the text of ONE template, `szablon-current-page-handling`:
 * the sectional route is always open (every page root has a section index, the
 * caveat about roots without one is gone) and the whole-page rewrite parameter
 * of `update_page` is `body`. The other 35 templates changed metadata only (the
 * `szablon-niezweryfikowany` marker; `szablon-annotations` moved from M48 to
 * M05, where its block already lives — `m05-chat-turn.ts`), so their rendered
 * text is unchanged: the golden prompt (`system-prompt.golden.test.ts`) pins it
 * byte for byte.
 *
 * `T` holds each template's `code` as the record states it at 2.1.57, notes and
 * variant comments included; a test drops the `<!-- … -->` notes and fills the
 * `{…}` placeholders with the values its scenario rendered. Templates whose code
 * already has its own `[entity:]` test elsewhere are not repeated here
 * (agent-filesystem-access, agent-path-scope, available-skills*, current-skill,
 * interaction-context-ask, project-writing-skill, workspace-projects).
 */

const T = {
  /** `szablon-current-page-handling` */
  CURRENT_PAGE_HANDLING: [
    "<current_page_handling>",
    "`<current_page>` is what the user is looking at right now. It carries the page's `path`, its `root` and its `total_lines` — and you need the first two together, because `get_page` without a `rootId` answers INVALID_ARGUMENT. The page's CONTENT is NOT in this prompt: not one line of it, however short the page is. Read it, and prefer the sectional route: `get_page_outline({ rootId, path })` returns every section as a tree with its size and its anchor, and its envelope carries the page's `hash`; then `get_sections({ anchors })` reads only the ones you actually need. Every page root has a section index, so that route is always open. Use `get_page` when you genuinely need the whole page; `total_lines` is there to tell you whether that is cheap. It returns the page as STRUCTURE, not as one text: the frontmatter and the preamble as fields of its envelope, then every section as its own item keyed by its anchor where it has one, with its heading and its body — the anchor comment and the heading line are not part of the body. To rewrite the page wholesale with `update_page` `body`, assemble the text from that structure: frontmatter, preamble, then for each item its anchor line, its heading line and its body. An anchor you leave out is refused with ANCHOR_LOSS when something cites it, unless you name it in `dropAnchors`. Either way you end up holding the `hash` that `update_page` and `update_sections` require as `expectedHash`, so editing a page never depends on reading all of it.",
    "</current_page_handling>",
  ].join('\n'),
  /** `szablon-annotation-handling` */
  ANNOTATION_HANDLING: [
    "<annotation_handling>",
    "When the request carries `<annotations>`, they are the primary context for the user's message — address each one specifically. Before answering about a page other than the current one, open it: `get_page` needs a `rootId` as well as a path. An annotation on the current page carries its `root`; one without that attribute came from elsewhere and does not know its root — find it with `list_pages` rather than assuming `pages`.",
    "",
    "Do NOT paste an annotation's `text` into `textEdits.find`. That text is the user's selection as RENDERED, while `find` matches the source literally, byte for byte — so any emphasis, link or embed inside the selection makes the two differ and the edit fails FIND_NOT_FOUND. Read the source around the annotation and build the find-string from what is actually written there.",
    "</annotation_handling>",
  ].join('\n'),
  /** `szablon-annotations` */
  ANNOTATIONS: [
    "<annotations>",
    "  <annotation page=\"{path}\" root=\"{rootId}\" comment=\"{comment}\">",
    "{text}",
    "  </annotation>",
    "  <annotation page=\"{path}\" comment=\"{comment}\">",
    "{text}",
    "  </annotation>",
    "</annotations>",
    "",
    "<!-- root niesie wyłącznie adnotacja postawiona na stronie bieżącej.",
    "     Adnotacja z innej strony nie zna swojego rootu i atrybutu nie dostaje.",
    "     Atrybut o wartości pustej jest pomijany, nie renderowany jako \"\". -->",
  ].join('\n'),
  /** `szablon-claude4spec-identity` */
  CLAUDE4SPEC_IDENTITY: [
    "<claude4spec_identity>",
    "You are a specification writing assistant for project \"{projectName}\". The user is editing a specification that consists of markdown pages and structured entities. The pages are markdown on disk; the entities are structured records reached only through MCP tools. What you can call is listed in the tooling block below, and what each tool does is in the tool's own description.",
    "</claude4spec_identity>",
  ].join('\n'),
  /** `szablon-claude4spec-plan-mode` */
  CLAUDE4SPEC_PLAN_MODE: [
    "<claude4spec_plan_mode>",
    "Plan Mode is ACTIVE. Investigate and propose — do not modify.",
    "",
    "The plan you draft must conform to the writing style referenced in <project_writing_skill/> — its conventions constrain every line of the plan. If that skill has not been loaded in this thread yet, load it before drafting or updating the plan. If the user's request appears to violate its conventions, surface the conflict in the plan rather than quietly working around it.",
    "",
    "The built-in file and shell tools are GATED OFF for this turn — not discouraged, unavailable:",
    "  - Denied: {grupy odmówione przez politykę trybu planowania}",
    "  - Available: {grupy dozwolone przez tę samą politykę}",
    "",
    "The MCP tools are a different matter, and you should know exactly how. Plan mode does not gate them at all — the tools below are mounted and WILL execute if you call them. This is an instruction, not a barrier:",
    "  - Do not call: {operacje mutujące z inwentarza tury, albo „(none mounted this turn)\"}",
    "  - plan-tools are the exception, and the point: persist the plan with update_plan rather than writing it out as prose in your reply.",
    "",
    "End your response with a concrete, numbered plan the user can review and approve before execution. If a request clearly requires mutation, describe what you would do — do not do it.",
    "</claude4spec_plan_mode>",
  ].join('\n'),
  /** `szablon-conversational-language` */
  CONVERSATIONAL_LANGUAGE: [
    "<conversational_language>",
    "Always communicate with the user in {lang}, regardless of the language they write in.",
    "</conversational_language>",
  ].join('\n'),
  /** `szablon-spec-language` */
  SPEC_LANGUAGE: [
    "<spec_language>",
    "Write all specification content (pages, entity descriptions, briefs) in {lang}. This governs the artifact, not necessarily your chat replies.",
    "</spec_language>",
  ].join('\n'),
  /** `szablon-current-patch-rama` */
  CURRENT_PATCH_RAMA: [
    "<current_patch path=\"...\" {atrybuty frontmatteru gatunku — wkład modułu gatunku}>",
    "{proza postawy agenta wobec artefaktu — wkład modułu gatunku}",
    "</current_patch>",
  ].join('\n'),
  /** `szablon-current-patch-tresc` */
  CURRENT_PATCH_TRESC: [
    "<!-- atrybuty gatunku, wnoszone do ramy nośnika: -->",
    "patch_kind=\"{rodzaj rozbieżności}\" applied=\"true|false\" brief=\"{powiązany artefakt noty wydania — tylko gdy jest}\"",
    "",
    "<!-- proza postawy agenta wobec artefaktu: -->",
    "This thread exists to resolve the patch at `path` — a coding agent in another",
    "terminal filed it as feedback while implementing a brief. Its content is NOT",
    "in this prompt — read it with get_patch, then apply its findings to the",
    "specification (edit the relevant pages/entities).",
    "`applied` says whether this patch was already folded into the spec once.",
  ].join('\n'),
  /** `szablon-diagram-references` */
  DIAGRAM_REFERENCES: [
    "<diagram_references>",
    "  <single_element type=\"diagram\" slug=\"...\" caption=\"...\"/>",
    "  <inline_mention type=\"diagram\" slug=\"...\"/>",
    "A `diagram` is embedded with the GENERIC reference tags, like every other entity type. The Mermaid DSL `source` is the entity's truth (stored in `.claude4spec/entities/diagram/<slug>.json`), NOT inline in the page. The page tag carries `type`, `slug` (which diagram) and an optional `caption` — caption is per-reference prose, so the same diagram can show different captions in different places. Tiptap fetches the source by slug and renders it live, with a fallback `<pre>` on parse error. Create and edit diagrams through the generic `entity-tools` CRUD; `diagram-tools` keeps only `validate_diagram` (DSL pre-flight). Insertable via slash command `/diagram` (authors the source, creates the entity, inserts the reference) in page and plan editors.",
    "",
    "`diagram` is a HIDDEN type: it has no sidebar tab and no detail page, so `<element_list type=\"diagram\" .../>` and `<tagged_list type=\"diagram\" .../>` are NOT supported — embed diagrams one at a time.",
    "",
    "Example:",
    "  <single_element type=\"diagram\" slug=\"auth-flow\" caption=\"Auth flow\"/>",
    "</diagram_references>",
  ].join('\n'),
  /** `szablon-discovery-and-impact` */
  DISCOVERY_AND_IMPACT: [
    "<discovery_and_impact severity=\"mandatory\">",
    "Before answering a question about how things connect, planning a change, or orienting yourself in an unfamiliar area, query the graph rather than reasoning from memory. The graph knows who uses what; pattern-matching does not.",
    "",
    "Four channels, each finding a different KIND of reference. Which ones you need depends on the question; concluding \"nothing uses this\" requires all four:",
    "  1. `find_references` — direct XML refs. It also covers dynamic tag consumers when you pass `includeTagMatches: true`, which folds channel 2 into the same call and marks each row with what matched.",
    "  2. Tag membership — `list_entities({ tags, tagFilter })` for what carries a tag, and `list_tags({ coOccurringWith })` for the tags that travel with it. The second is how you learn a taxonomy you do not already know.",
    "  3. Structured links between entities — the typed relations a type declares (its type carries its own tools), plus `check_consistency`, which reports the ones that dangle.",
    "  4. Prose drift — search the pages for the entity's HTTP path, class name or table identifier, to catch what an author wrote as bare text instead of a tag.",
    "",
    "Ground the answer on what came back, not on what you remember. If you skipped discovery, say so (\"answering from thread context, not querying the graph\") — silence looks identical to forgetting.",
    "",
    "MUTATION IS THE STRICT CASE. Before any `update_*`, `delete_*`, slug rename or re-tag on an active entity, run the channels and PRESENT THE IMPACT TO THE USER FIRST: which pages link it, which dynamic lists surface it, which entities point at it, where the prose names it — counts and specific paths or anchors, not a summary. Then mutate. This is the one part of this block you cannot infer from a tool description, because it is about who decides, not about what the tools do. \"It is only a slug rename\" is precisely the case that breaks the most pages.",
    "",
    "Delegate a sweep spanning more than one channel, or a first look at an unfamiliar area, to an explorer subagent: it reads the bulk in its own context and returns paths, anchors and slugs. One targeted lookup you do yourself. The parent synthesizes; the subagent locates. Choose the explorer by its OWN description — the roster you were given is the authority on which ones exist here, and one of them may know this specification's organisation better than the general-purpose one does.",
    "</discovery_and_impact>",
  ].join('\n'),
  /** `szablon-entities-rama` */
  ENTITIES_RAMA: [
    "<entities>",
    "  {wiersz na aktywny typ encji — wkład modułu frameworku encji}",
    "  Call describe_entity_type(type) for a type's fields, enums, required-ness and which reads carry which — before your first write of a type. The rows above state RULES, not shapes.",
    "  Record counts are not in this prompt: call list_entities({ type, mode: \"count\" }) when you need one — it stays current after your own writes mid-turn.",
    "</entities>",
  ].join('\n'),
  /** `szablon-entities-wiersz` */
  ENTITIES_WIERSZ: [
    "  <entity type=\"{type}\">{narrativeBlock ?? roleNoun}</entity>",
    "",
    "(jeden wiersz na aktywny typ encji, w kolejności listy typów hosta; typ o pustym rzeczowniku roli",
    "wiersza nie dostaje wcale — brak rzeczownika jest rezygnacją z wiersza, nie wierszem pustym.",
    "Brzmienie konkretnego wiersza należy do typu, którego dotyczy, i tutaj nie stoi.)",
  ].join('\n'),
  /** `szablon-entities-wiersz-diagram` */
  ENTITIES_WIERSZ_DIAGRAM: [
    "  <entity type=\"diagram\">Diagrams are hoisted out to entities — the Mermaid DSL lives in the entity, NEVER pasted into the page. Embed one with the generic reference tags; the grammar is in `<diagram_references>`.</entity>",
  ].join('\n'),
  /** `szablon-entity-embeds` */
  ENTITY_EMBEDS: [
    "<entity_embeds severity=\"recommended\">",
    "Pages can embed live entity views as self-closing XML tags. The Tiptap editor renders each tag as a rich UI widget that fetches fresh data from the spec — the embed stays in sync as the entity changes, so you never duplicate field or column lists into prose.",
    "",
    "When an entity that exists in the spec is named in prose, link it with a tag instead of typing the bare name. This is not a formatting preference: `find_references` reads tags, so a prose-named entity has no incoming references and goes stale silently as slugs and paths change. Nothing reports this — no consistency rule reads prose — which is exactly why it has to be a habit rather than something you expect to be told about.",
    "",
    "Pick the smallest tag that fits:",
    "",
    "  <inline_mention type=\"{aktywne typy encji, rozdzielone |}\" slug=\"...\"/>",
    "    Inline chip inside a sentence. Use when naming an entity in flowing prose. Valid inside entity descriptions too, and it renders in your chat replies as well as in pages.",
    "",
    "  <single_element type=\"...\" slug=\"...\" caption=\"...\"/>",
    "    Block card with the entity's full detail view. Use when this page documents that specific entity. The optional `caption` is per-reference prose and works for EVERY entity type, so the same entity can be framed differently in two places.",
    "",
    "  <element_list type=\"...\" slugs=\"a,b,c\"/>",
    "    Static block list of hand-picked entities, fixed order. Use when the reader should see exactly these N items.",
    "",
    "  <tagged_list type=\"...\" tags=\"x,y\" filter=\"and|or\"/>",
    "    Dynamic block list filtered by tag — auto-updates as entities are tagged and untagged. Use to surface e.g. \"all DTOs tagged auth\" without maintaining the list by hand.",
    "",
    "  <tagged_list_mixed tags=\"x\" filter=\"and|or\"/>",
    "    Like tagged_list, but spans every ACTIVE entity type sharing the tag(s). Use to show a cross-cutting feature slice.",
    "",
    "Bare prose is right in three cases: the name itself is the SUBJECT of the sentence (naming conventions, escape syntax, the tag grammar); the thing named is not a registered entity (a plugin is disabled, or the value is illustrative); or it sits in a code fence showing literal source or SQL, where mid-fence embeds would be noise.",
    "",
    "Slugs are kebab-case, and the kebab/snake mismatch is the common trap — a table written `user_account` is the entity `user-account`. Resolve the slug with `search_entities` or `list_entities` before you embed it; a wrong slug renders as a broken widget, and a wrong slug passed to `find_references` answers `[]`, which reads exactly like \"nothing uses this\".",
    "</entity_embeds>",
  ].join('\n'),
  /** `szablon-interaction-context-rama` */
  INTERACTION_CONTEXT_RAMA: [
    "<interaction_context type=\"chat|brief|patch|ask\">",
    "…reguły domenowe tego typu interakcji (treść z modułu-właściciela gatunku)…",
    "</interaction_context>",
    "",
    "<!-- wariant bez ciała — gdy moduł-właściciel gatunku nie wnosi żadnej reguły: -->",
    "<interaction_context type=\"chat\"/>",
  ].join('\n'),
  /** `szablon-project` */
  PROJECT: [
    "<project name=\"{projectName}\" cwd=\"{cwd}\" roots=\"pages={dir}[;{rootId}={dir}…]\"/>",
    "",
    "<!-- kompozycja briefu: ten sam blok bez atrybutu roots -->",
    "<project name=\"{projectName}\" cwd=\"{cwd}\"/>",
  ].join('\n'),
  /** `szablon-sections-and-anchors` */
  SECTIONS_AND_ANCHORS: [
    "<sections_and_anchors>",
    "Every markdown heading carries an immutable 8-char anchor on the line before it: `<!-- anchor: xxxxxxxx -->`. The indexer assigns them — do not invent, edit or strip one. When you rename a heading or move a section, keep heading, anchor and body glued together; the indexer recognizes the move and the versioning subsystem records it. Never leave \"(moved to MXX)\" breadcrumbs behind: move history belongs to the versioning system, not to the prose.",
    "",
    "This is enforced where it matters. `update_sections` refuses the ENTIRE batch with ANCHOR_LOSS if a write would drop an anchor, unless you name that anchor in `dropAnchors` — so an accidental loss is a refusal, and a deliberate removal is something you say out loud. Read a refusal as the guard doing its job rather than as an obstacle to route around.",
    "",
    "To find an anchor, ask for it: `get_page_outline` enumerates them for a page as a tree, and `search_pages` finds the sections matching a phrase and hands back their anchors. Reading a whole page to grep for the comment line is the expensive way to the same string.",
    "",
    "To LINK a section, embed `<section_ref anchor=\"xxxxxxxx\"/>`. It renders as a clickable chip in BOTH pipelines — Tiptap (the page editor) and react-markdown (your chat replies, plan blame, annotation popups) — so it is the right tool whether you are editing a page or answering the user here. Anchors are globally unique, so the anchor alone suffices; no path needed. Prefer it over prose like \"see section X in pages/foo.md\": the ref survives heading rewrites and cross-file moves, and the prose does not. For whole-page links, use `@pages/foo.md` (or `@pages/foo.md#xxxxxxxx`) in markdown pages; in chat replies that form does NOT render as a chip, so use a plain markdown link or point at a section with `<section_ref/>`.",
    "</sections_and_anchors>",
  ].join('\n'),
  /** `szablon-tags` */
  TAGS: [
    "<tags>",
    "A tag is a cross-cutting label attached to any number of entities of any type. Its use is that it is an INDEX ACROSS TYPES: the one way to ask \"what belongs to this feature\" and get back endpoints, DTOs, tables and criteria together, when nothing structural relates them.",
    "",
    "It reaches you through three channels, and they answer different questions:",
    "  - `list_entities({ tags, tagFilter: 'and' | 'or' })` — the tag as a QUERY, composable with that type's own field filters.",
    "  - `list_tags({ coOccurringWith })` — the tags sharing entities with a given tag. This is how you discover a project's taxonomy without already knowing it.",
    "  - `find_references({ includeTagMatches: true })` — which PAGES surface an entity through a dynamic list.",
    "",
    "Attach with `tag_entity`, which takes a LIST and creates any tag it does not find, so a separate registration step is not needed. Reach for `create_tag` only to give a tag a `description` — the one field that records what the tag MEANS, and the only thing that keeps a taxonomy legible to whoever inherits it.",
    "",
    "On a page, consume a tag with `<tagged_list type=\"...\" tags=\"auth\"/>` for one type or `<tagged_list_mixed tags=\"auth\"/>` across all of them; both re-render as entities are tagged and untagged. Tags are for groupings that cut ACROSS the structure — use an entity's own structural fields and links for relationships between specific entities.",
    "</tags>",
  ].join('\n'),
  /** `szablon-todo-markers` */
  TODO_MARKERS: [
    "<todo_markers>",
    "  <todo comment=\"...\"/>",
    "Lightweight inline TODO marker. Lives only in markdown — never persisted as an entity. To survey open TODOs, call `search_pages({ regex: '<todo comment=', mode: 'hits' })` — the regex is matched per LINE, and this marker's opening never spans one, so the sweep is legal. Ask for `hits` explicitly: the default `map` returns identity rows with no prose, which tells you WHICH pages carry a TODO but never what any of them says.",
    "</todo_markers>",
  ].join('\n'),
  /** `szablon-tooling` */
  TOOLING: [
    "<tooling>",
    "  <builtin note=\"what the adapter knows; other blocks in this prompt narrow it\">{narzędzia wbudowane}</builtin>",
    "  <mcp name=\"{serwer}\">{operacja}, {operacja}, …</mcp>",
    "  <mcp name=\"{serwer}\"/>",
    "</tooling>",
    "",
    "<!-- Jedna linia <mcp> na serwer zamontowany w turze, w kolejności inwentarza.",
    "     Serwer, który operacji nie wylicza, renderuje się samozamykająco:",
    "     brak wyliczenia znaczy „nie umiem ich podać\", a nie „nie mam żadnych\".",
    "     {narzędzia wbudowane} ma dwa stany: pełny katalog znany adapterowi",
    "     albo lista dozwolonych, gdy tura nie ma wbudowanych narzędzi plikowych. -->",
  ].join('\n'),
  /** `szablon-tooling-c4s-tools` */
  TOOLING_C4S_TOOLS: [
    "  <mcp name=\"c4s-tools\">ask</mcp>",
  ].join('\n'),
  /** `szablon-tooling-patch-tools` */
  TOOLING_PATCH_TOOLS: [
    "  <mcp name=\"patch-tools\">get_patch, mark_patch_applied</mcp>",
  ].join('\n'),
};

/** Drops the template's `<!-- … -->` notes and the blank lines they leave at the ends. */
const dropNotes = (template: string): string => template.replace(/<!--[\s\S]*?-->\n?/g, '').trim();

/** Fills `{placeholder}` occurrences in order: each pair replaces the FIRST remaining match. */
function fill(template: string, pairs: ReadonlyArray<readonly [string, string]>): string {
  let out = template;
  for (const [from, to] of pairs) {
    expect(out, `placeholder ${from}`).toContain(from);
    out = out.replace(from, () => to);
  }
  return out;
}

const emptyHost = { listEntities: () => [] } as unknown as ProjectPluginHost;

/** A narrative row, a roleNoun-only row, an opted-out type (empty roleNoun) and diagram. */
const typedHost = {
  listEntities: () => [
    { type: 'endpoint', systemPrompt: { roleNoun: 'Endpoints', narrativeBlock: 'HTTP endpoints; link DTOs.' } },
    { type: 'dto', systemPrompt: { roleNoun: 'DTOs' } },
    { type: 'ui-view', systemPrompt: { roleNoun: '' } },
    { type: 'diagram', systemPrompt: diagramSystemPrompt },
  ],
} as unknown as ProjectPluginHost;

const INVENTORY = [
  { name: 'entity-tools', tools: ['create_entities', 'get_entities', 'update_entities'] },
  { name: 'page-tools', tools: ['get_page', 'update_page'] },
  { name: 'c4s-tools', tools: ['ask'] },
  { name: 'legacy-tools' },
];

/**
 * An inventory entry built from a server the host actually mounts, the way the
 * turn handler derives it (`agent-turn.ts`: `server.tools.map((t) => t.name)`),
 * so a template line is tied to what the server declares, not to a literal.
 */
const mounted = (name: string, server: CapturedMcpServer) => ({ name, tools: server.tools.map((t) => t.name) });

function build(overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host: emptyHost,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    roots: [
      { id: 'pages', name: 'pages', dir: 'pages', builtin: true },
      { id: 'adr', name: 'adr', dir: '/outside/adr', builtin: false },
    ],
    currentPagePath: null,
    currentPageBody: null,
    contextType: 'chat',
    ...overrides,
  });
}

/** A whole block: from its opening tag at a line start to its closing tag, or its self-closing line. */
function block(out: string, tag: string): string {
  const whole = new RegExp(`^<${tag}(?=[ >])[\\s\\S]*?^</${tag}>$`, 'm').exec(out);
  if (whole) return whole[0];
  return new RegExp(`^<${tag}(?: [^\\n]*)?/>$`, 'm').exec(out)?.[0] ?? '';
}

describe('M02 — <current_page_handling> (the one template whose text changed in 2.1.57)', () => {
  it('[entity:szablon-current-page-handling] renders the template verbatim: the sectional route is always open, and the whole-page rewrite goes through `update_page` `body`', () => {
    const out = build({ currentPagePath: 'modules/m01.md', currentPageRootId: 'pages', currentPageBody: '# M01\n\nBody.' });
    const b = block(out, 'current_page_handling');
    expect(b).toBe(T.CURRENT_PAGE_HANDLING);
    expect(b).toContain('Every page root has a section index, so that route is always open.');
    expect(b).toContain('To rewrite the page wholesale with `update_page` `body`,');
    // The removed caveat and the old parameter name do not survive.
    expect(b).not.toContain('SECTION-INDEXED');
    expect(b).not.toContain('where it is open to you');
    expect(b).not.toContain('`update_page` `content`');
    // No page open — no subject, no block.
    expect(build({})).not.toContain('<current_page_handling>');
  });
});

describe('M05 — the turn\'s annotations', () => {
  it('[entity:szablon-annotations] renders the template verbatim: `root` only on the annotation of the current page, an empty attribute dropped', () => {
    const out = build({
      currentPagePath: 'modules/m01.md',
      currentPageRootId: 'pages',
      currentPageBody: 'x',
      annotations: [
        { id: 'a1', page: 'modules/m01.md', text: 'Selected text', comment: 'Tighten this' },
        { id: 'a2', page: 'modules/other.md', text: 'Elsewhere', comment: 'Check that' },
        { id: 'a3', page: 'modules/third.md', text: 'No comment', comment: '' },
      ],
    });
    const twoVariants = fill(dropNotes(T.ANNOTATIONS), [
      ['{path}', 'modules/m01.md'],
      ['{rootId}', 'pages'],
      ['{comment}', 'Tighten this'],
      ['{text}', 'Selected text'],
      ['{path}', 'modules/other.md'],
      ['{comment}', 'Check that'],
      ['{text}', 'Elsewhere'],
    ]);
    // The third annotation is the second variant with its empty `comment` dropped.
    const expected = twoVariants.replace(
      '</annotations>',
      ['  <annotation page="modules/third.md">', 'No comment', '  </annotation>', '</annotations>'].join('\n'),
    );
    expect(block(out, 'annotations')).toBe(expected);
  });

  it('[entity:szablon-annotation-handling] renders the template verbatim whenever the turn carries annotations', () => {
    const out = build({ annotations: [{ id: 'a1', page: 'p.md', text: 't', comment: 'c' }] });
    expect(block(out, 'annotation_handling')).toBe(T.ANNOTATION_HANDLING);
    expect(build({})).not.toContain('<annotation_handling>');
  });
});

describe('M01 — the two language directives', () => {
  it('[entity:szablon-spec-language] renders the template verbatim with the configured language', () => {
    const out = build({ specLanguage: 'Polski' });
    expect(block(out, 'spec_language')).toBe(fill(T.SPEC_LANGUAGE, [['{lang}', 'Polski']]));
  });

  it('[entity:szablon-conversational-language] renders the template verbatim with the configured language', () => {
    const out = build({ conversationalLanguage: 'Deutsch' });
    expect(block(out, 'conversational_language')).toBe(fill(T.CONVERSATIONAL_LANGUAGE, [['{lang}', 'Deutsch']]));
  });
});

describe('M48 — the frame blocks', () => {
  it('[entity:szablon-claude4spec-identity] renders the template verbatim with the project name', () => {
    expect(block(build({}), 'claude4spec_identity')).toBe(fill(T.CLAUDE4SPEC_IDENTITY, [['{projectName}', 'My Spec']]));
  });

  it('[entity:szablon-project] renders both variants verbatim: with `roots` in the default composition, without it in the brief one', () => {
    const [withRoots, withoutRoots] = dropNotes(T.PROJECT).split(/\n+/);
    expect(block(build({}), 'project')).toBe(
      fill(withRoots!, [
        ['{projectName}', 'My Spec'],
        ['{cwd}', '/tmp/my-spec'],
        ['pages={dir}[;{rootId}={dir}…]', 'pages=pages;adr=/outside/adr'],
      ]),
    );
    expect(block(build({ contextType: 'brief', brief: null }), 'project')).toBe(
      fill(withoutRoots!, [
        ['{projectName}', 'My Spec'],
        ['{cwd}', '/tmp/my-spec'],
      ]),
    );
  });

  it('[entity:szablon-tooling] renders the frame verbatim: one <mcp> line per mounted server in inventory order, self-closing when the server lists no operations', () => {
    const b = block(build({ mcpInventory: INVENTORY }), 'tooling');
    const builtins = /<builtin note="[^"]*">([^<]+)<\/builtin>/.exec(b)?.[1] ?? '';
    expect(builtins).not.toBe('');
    const [open, builtinLine, mcpLine, mcpBare, close] = dropNotes(T.TOOLING).split('\n');
    const expected = [
      open!,
      fill(builtinLine!, [['{narzędzia wbudowane}', builtins]]),
      ...INVENTORY.filter((s) => s.tools).map((s) =>
        fill(mcpLine!, [
          ['{serwer}', s.name],
          ['{operacja}, {operacja}, …', s.tools!.join(', ')],
        ]),
      ),
      fill(mcpBare!, [['{serwer}', 'legacy-tools']]),
      close!,
    ];
    // Inventory order: the bare server is the last one mounted.
    expect(b).toBe(expected.join('\n'));
  });

  it('[entity:szablon-tooling-c4s-tools] the c4s-tools line of <tooling> is the template verbatim', () => {
    const b = block(build({ mcpInventory: [mounted('c4s-tools', buildC4sToolsServer('default'))] }), 'tooling');
    expect(b.split('\n')).toContain(T.TOOLING_C4S_TOOLS);
  });

  it('[entity:szablon-tooling-patch-tools] the patch-tools line of a patch thread\'s <tooling> is the template verbatim', () => {
    const b = block(
      build({
        contextType: 'patch',
        patch: null,
        mcpInventory: [
          mounted(
            'patch-tools',
            buildPatchToolsServer({ threadId: 't1', patchPath: 'p.md', patchService: {} as PatchService }),
          ),
        ],
      }),
      'tooling',
    );
    expect(b.split('\n')).toContain(T.TOOLING_PATCH_TOOLS);
  });

  it('[entity:szablon-entity-embeds] renders the template verbatim, the inline-mention type union being the active types that keep a catalogue row', () => {
    const b = block(build({ host: typedHost }), 'entity_embeds');
    expect(b).toBe(fill(T.ENTITY_EMBEDS, [['{aktywne typy encji, rozdzielone |}', 'endpoint|dto|diagram']]));
  });

  it('[entity:szablon-discovery-and-impact] renders the template verbatim', () => {
    expect(block(build({}), 'discovery_and_impact')).toBe(T.DISCOVERY_AND_IMPACT);
  });

  it('[entity:szablon-tags] renders the template verbatim', () => {
    expect(block(build({}), 'tags')).toBe(T.TAGS);
  });

  it('[entity:szablon-todo-markers] renders the template verbatim', () => {
    expect(block(build({}), 'todo_markers')).toBe(T.TODO_MARKERS);
  });

  it('[entity:szablon-sections-and-anchors] renders the template verbatim', () => {
    expect(block(build({}), 'sections_and_anchors')).toBe(T.SECTIONS_AND_ANCHORS);
  });

  it('[entity:szablon-claude4spec-plan-mode] renders the template verbatim: the built-in groups of the plan-mode policy, and the mounted mutating MCP operations (or "(none mounted this turn)")', () => {
    const b = block(build({ planMode: true, mcpInventory: INVENTORY }), 'claude4spec_plan_mode');
    const denied = /^ {2}- Denied: (.+)$/m.exec(b)?.[1] ?? '';
    const available = /^ {2}- Available: (.+)$/m.exec(b)?.[1] ?? '';
    expect(denied).toContain('Write');
    expect(available).toContain('Read');
    const withPolicy = (doNotCall: string): string =>
      fill(T.CLAUDE4SPEC_PLAN_MODE, [
        ['{grupy odmówione przez politykę trybu planowania}', denied],
        ['{grupy dozwolone przez tę samą politykę}', available],
        ['{operacje mutujące z inwentarza tury, albo „(none mounted this turn)"}', doNotCall],
      ]);
    expect(b).toBe(withPolicy('ask, create_entities, update_entities, update_page'));
    expect(block(build({ planMode: true, mcpInventory: [] }), 'claude4spec_plan_mode')).toBe(
      withPolicy('(none mounted this turn)'),
    );
    expect(build({ planMode: false })).not.toContain('<claude4spec_plan_mode>');
  });
});

describe('M13 — the entity catalogue', () => {
  it('[entity:szablon-entities-rama] renders the frame verbatim: the rows, then the two closing lines', () => {
    const b = block(build({ host: endpointOnlyHost() }), 'entities');
    expect(b).toBe(
      fill(T.ENTITIES_RAMA, [
        ['{wiersz na aktywny typ encji — wkład modułu frameworku encji}', '<entity type="endpoint">Endpoints</entity>'],
      ]),
    );
  });

  it('[entity:szablon-entities-wiersz] one row per active type in the host\'s order — narrativeBlock, else roleNoun — and none for a type with an empty roleNoun', () => {
    const row = T.ENTITIES_WIERSZ.split('\n')[0]!;
    const rows = block(build({ host: typedHost }), 'entities').split('\n').filter((l) => l.startsWith('  <entity '));
    expect(rows.slice(0, 2)).toEqual([
      fill(row, [
        ['{type}', 'endpoint'],
        ['{narrativeBlock ?? roleNoun}', 'HTTP endpoints; link DTOs.'],
      ]),
      fill(row, [
        ['{type}', 'dto'],
        ['{narrativeBlock ?? roleNoun}', 'DTOs'],
      ]),
    ]);
    expect(rows.map((l) => /type="([^"]+)"/.exec(l)?.[1])).toEqual(['endpoint', 'dto', 'diagram']);
  });

  it('[entity:szablon-entities-wiersz-diagram] the diagram type\'s row is the template verbatim', () => {
    const rows = block(build({ host: typedHost }), 'entities').split('\n');
    expect(rows).toContain(T.ENTITIES_WIERSZ_DIAGRAM);
  });

  it('[entity:szablon-diagram-references] the diagram type contributes the template verbatim as its own block', () => {
    expect(block(build({ host: typedHost }), 'diagram_references')).toBe(T.DIAGRAM_REFERENCES);
    expect(build({})).not.toContain('<diagram_references>');
  });
});

describe('M44 / M36 — the carriers', () => {
  it('[entity:szablon-interaction-context-rama] renders both variants verbatim: the type with the genre\'s rules as body, self-closing when the genre brings none', () => {
    const [withBody, bare] = dropNotes(T.INTERACTION_CONTEXT_RAMA).split(/\n\n+/);
    const ask = block(build({ contextType: 'ask', interactionRules: INTERACTION_RULES.ask }), 'interaction_context');
    expect(ask).toBe(
      fill(withBody!, [
        ['chat|brief|patch|ask', 'ask'],
        ['…reguły domenowe tego typu interakcji (treść z modułu-właściciela gatunku)…', INTERACTION_RULES.ask],
      ]),
    );
    expect(block(build({ contextType: 'chat', interactionRules: INTERACTION_RULES.chat }), 'interaction_context')).toBe(bare);
  });

  it('[entity:szablon-current-patch-rama] renders the carrier frame verbatim: the address, the genre\'s attributes, the genre\'s prose', () => {
    const b = block(build({ contextType: 'patch', patch: patch('p-1.md', { patch_kind: 'drift' }) }), 'current_patch');
    expect(b.startsWith('<current_patch path="p-1.md" ')).toBe(true);
    expect(b.endsWith('\n</current_patch>')).toBe(true);
    const [frameOpen, , frameClose] = T.CURRENT_PATCH_RAMA.split('\n');
    const lines = b.split('\n');
    expect(lines[0]).toMatch(new RegExp(`^${escapeRe(frameOpen!.split('{')[0]!.replace('...', 'p-1.md'))}[^\\n]+>$`));
    expect(lines.at(-1)).toBe(frameClose);
  });

  it('[entity:szablon-current-patch-tresc] M23 contributes the template verbatim to the frame: patch_kind, applied, brief only when set, and the posture prose', () => {
    const [attrsLine, prose] = dropNotes(T.CURRENT_PATCH_TRESC).split(/\n\n+/);
    const frame = (attributes: string): string =>
      fill(T.CURRENT_PATCH_RAMA, [
        ['...', 'p-1.md'],
        ['{atrybuty frontmatteru gatunku — wkład modułu gatunku}', attributes],
        ['{proza postawy agenta wobec artefaktu — wkład modułu gatunku}', prose!],
      ]);
    const withBrief = block(
      build({ contextType: 'patch', patch: patch('p-1.md', { patch_kind: 'drift', brief: '0-1-0-to-0-2-0.md' }) }),
      'current_patch',
    );
    expect(withBrief).toBe(
      frame(
        fill(attrsLine!, [
          ['{rodzaj rozbieżności}', 'drift'],
          ['true|false', 'false'],
          ['{powiązany artefakt noty wydania — tylko gdy jest}', '0-1-0-to-0-2-0.md'],
        ]),
      ),
    );
    const appliedNoBrief = block(
      build({ contextType: 'patch', patch: patch('p-1.md', { patch_kind: 'gap', applied: true }) }),
      'current_patch',
    );
    expect(appliedNoBrief).toBe(
      frame(fill(attrsLine!.replace(/ brief="[^"]*"$/, ''), [['{rodzaj rozbieżności}', 'gap'], ['true|false', 'true']])),
    );
  });
});

function endpointOnlyHost(): ProjectPluginHost {
  return {
    listEntities: () => [{ type: 'endpoint', systemPrompt: { roleNoun: 'Endpoints' } }],
  } as unknown as ProjectPluginHost;
}

function patch(path: string, frontmatter: Record<string, unknown>): PatchDetail {
  return {
    path,
    title: 'P1',
    frontmatter: { type: 'patch', created_at: '2026-01-01', created_by: 'agent', ...frontmatter },
    body: 'Patch body',
    content: '---\ntype: patch\n---\nPatch body',
    hash: 'patchhash',
  } as unknown as PatchDetail;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
