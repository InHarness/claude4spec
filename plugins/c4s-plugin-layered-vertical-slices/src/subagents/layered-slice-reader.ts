import type { PluginSubagentContribution } from '@c4s/plugin-runtime';
import { composePart } from '../skills/layered-vertical-slices.js';

/**
 * The style's slice reader — the second of the three subagents
 * `workflows/read.md` delegates to.
 *
 * One reader, one module. The scout has already said WHERE a topic lives; a
 * reader says WHAT one of those modules says about it, together with the edges
 * one step out. The parent spawns one per module, in parallel, and assembles
 * the reports — the readers cannot do that themselves, because the host frame
 * forbids a subagent to delegate further.
 *
 * The scope is by TOPIC, never "the whole module", and that is a measured
 * constraint rather than a preference. In `app-spec` (52 modules) the median
 * module is 39k characters, the p90 97k, and `m05-chat-agent` is 370k across 14
 * files and 121 headings. A reader told to read its module whole would spend its
 * budget on the first two files of the largest ones and come back empty, and an
 * empty return is what the host delivers when a turn budget runs out — no partial
 * answer, no trace. So a reader reads the fixed minimum (`Cel`, `Domain`), the
 * sections the scout's anchors point at, and the sections of the layers the
 * topic touches, each against its layer's schema — and reports as it goes.
 *
 * The dependency protocol is spliced from `parts/reading-deps.md` at load, the
 * same bytes `workflows/patch.md` carries. On the far side of an edge the reader
 * stops at `Cel` and the section the record points at: a neighbour read whole is
 * a second module, and a second module is a second reader's job.
 *
 * `promptBody` carries ORIENTATION and the reading scope. The mechanics — the
 * read-only posture, pointers-not-dumps, the ban on delegating, the truncation
 * protocol — are the host frame's, prepended to this body and not rewritable
 * from here.
 */
export const layeredSliceReader: PluginSubagentContribution = {
  name: 'layered-slice-reader',
  description:
    'Read-only reader of ONE module of a specification organised as LAYERED VERTICAL SLICES — modules `MXX-slug`, layers `LY-slug`, addresses `MXX-slug/LY-slug`. Give it one module, the topic, and the glossary and hit anchors the scout returned: it reads how that module realises the topic — `Cel`, `Domain`, the anchored sections and the sections of the layers the topic touches, each against its layer\'s `## Module slice schema` — traces the module\'s dependency edges one step out in both directions, and reports facts with addresses, gaps in the schema, and the edges it found. Spawn one per module, in parallel; it does not search for modules (the scout does) and does not judge a saved change (a reviewer does). Do NOT use it if this specification is not organised as `MXX-slug` modules with `LY-slug` layers.',
  promptBody: `You are reading ONE module of a specification written in the LAYERED VERTICAL SLICES style, on ONE topic. Your parent spawned you with the module, the topic, a glossary mapping the user's words to the specification's, and the anchors where a scout found the topic in this module. Other readers are reading other modules at the same time; the parent puts the reports together. Stay inside your module and your topic.

## The organisation

A **module** is a vertical slice of the product, addressed \`MXX-slug\`. A **layer** is a convention several modules share, addressed \`LY-slug\`. The layer's own file, \`layers/LY-slug\`, holds no module content: in \`## Module slice schema\` it fixes the fields in which every module describes its use of the layer. What your module says about a layer is a SECTION of its page — or, once the module has grown into a directory \`modules/MXX-slug/\`, a file \`LY-slug\` inside it. An address \`MXX-slug/LY-slug\` is that section.

The same schema is answered in two modes. A **consumer module** (the common case) answers its fields with what it declares. An **implementor module** — the one named in the layer file's \`Implementor module:\` slot — answers the same fields in **how-mode**: how the mechanism works, what others may rely on. Know which one your module is for each layer you read.

Where a section is an embed of entities, the entities are the content and the prose beside them says why.

## What you read — by topic, never the whole module

Modules here run to hundreds of thousands of characters. You cannot read yours whole and you are not asked to. Read, in this order:

1. **\`get_page_outline\`** of the module page. It shows which layers the module carries and where the scout's anchors sit. In a module split into a directory, it shows the subpages: you open only the subpages of the layers the topic touches.
2. **\`Cel\` and \`Domain\`** — always, both. \`Cel\` says why the module exists, which is the frame for everything else you report; \`Domain\` holds what no layer asks about.
3. **The anchored sections** — every anchor the scout handed you.
4. **The sections of the layers the topic touches**, including any the scout did not anchor. Read each one **against \`## Module slice schema\` in its layer file**: the schema names the fields the section is supposed to answer, so it tells you both what the section says about the topic and what it is silent about.
5. **The entities those sections embed**, through \`get_entities\` — the fields that bear on the topic, not the whole record.

Recognise the topic by the right-hand side of the glossary — the specification's words, not the user's.

## Edges — one step, both directions

Trace the module's dependencies with protocol 2 below; its step 1 has already been done for you — the scout identified the module. On the far side of an edge, read only that module's \`Cel\` and the section the record points at, if it points at one. **Never read a neighbour whole**: if the topic lives there too, it is a module the parent should hand to its own reader, and you say so.

## What the parent gets back — as you go, not at the end

Your turn budget ending does not cut your report short: it returns NOTHING, and the parent cannot tell that silence from a module with nothing to say. So report incrementally — state each fact as soon as you have read it, and keep adding. Four kinds of line:

- **Fact**: the address (\`MXX-slug/LY-slug\`, page path plus anchor, or entity slug), then one sentence quoted or closely paraphrased from what is written there. One fact, one address.
- **Gap**: a field of a layer's \`## Module slice schema\` that the module's section leaves unanswered for this topic — the layer, the field by the name the schema gives it, and the section that should have answered it. A gap is a finding, not a failure.
- **Edge**: the direction (\`→\` this module depends on, \`←\` depends on this module), the other module, the record's slug, and what the far side's \`Cel\` or pointed-at section says in one sentence. Say explicitly when the incoming half was unreachable.
- **Not read**: when the budget is running short, stop reading and list what you did not open — sections, subpages, neighbours. A partial report that arrives beats a complete one that does not.

If the module turns out not to carry the topic at all, say that in one line with the sections you checked; the scout's anchors were a lead, not a verdict.

---

${composePart('parts/reading-deps.md')}`,
  /** The same contexts the scout serves: every one that reads the current spec. */
  contextTypes: ['chat', 'patch', 'ask'],
  /**
   * Pages and entities for reading, `load_skill_file` for the style. No
   * `search_pages` over the corpus and no `list_pages`: finding modules is the
   * scout's job, and a reader that can search widely is a reader that wanders.
   */
  tools: [
    'mcp__reference-tools__get_page_outline',
    'mcp__reference-tools__get_sections',
    'mcp__reference-tools__get_page',
    'mcp__reference-tools__find_references',
    'mcp__entity-tools__get_entities',
    'mcp__entity-tools__list_entities',
    'mcp__entity-tools__describe_entity_type',
    'mcp__skill-tools__load_skill_file',
  ],
  attachInternalSkills: ['layered-vertical-slices'],
  model: 'sonnet',
  /**
   * Forty, declared EXPLICITLY although it equals the host's default — for the
   * reviewer's reason: exhaustion reaches the parent as EMPTINESS rather than as
   * a report, so the number is a stated decision, not a default leaned on. The
   * reading scope above (by topic, one step on the edges) is what has to keep a
   * reader of `m05` inside it; the incremental report is what saves the rest
   * when it does not.
   */
  maxTurns: 40,
};
