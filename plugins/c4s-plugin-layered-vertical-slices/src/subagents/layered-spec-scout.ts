import type { PluginSubagentContribution } from '@c4s/plugin-runtime';
import { composePart } from '../skills/layered-vertical-slices.js';

/**
 * The style's scout — the first of the three subagents `workflows/read.md`
 * delegates to.
 *
 * It answers WHERE and only that: it turns the user's words into the
 * specification's vocabulary, searches text and entities with it, and returns a
 * selected list of modules. What a module SAYS about the topic is the reader's
 * question (`layered-slice-reader`), one module per reader, in parallel; the
 * parent only dispatches and assembles. The split exists because a module is too
 * large to read whole — `m05-chat-agent` in `app-spec` is 370k characters — so
 * nobody can afford to read "the modules that might be involved"; someone first
 * has to say which ones are, and why.
 *
 * It replaces the explorer (`layered-spec-explore`) rather than standing beside
 * it: the explorer located AND read, and the two jobs pulled its budget in
 * opposite directions. The built-in `spec-explore` is untouched — it is the
 * FLOOR for a project with no writing style, and this one still routes against
 * it on `description` alone.
 *
 * Nothing binds it to the style being ACTIVE, and nothing should: a contribution
 * is filtered on `contextTypes` and name, never on `config.writingStyle`, so every
 * project sees it in the roster — including a flat one. The guard is therefore in
 * the `description` itself, which says both when to pick it and when not to.
 *
 * `promptBody` carries ORIENTATION and the search procedure. The mechanics — the
 * read-only posture, the ban on delegating further, pointers-not-dumps, the
 * truncation protocol, the turn budget — are the host frame's, prepended to this
 * body and not rewritable from here. The one protocol it carries in full, the
 * purpose sweep, is spliced from `parts/reading-sweep.md` at load, so the scout
 * and `workflows/plan.md` read the same bytes.
 */
export const layeredSpecScout: PluginSubagentContribution = {
  name: 'layered-spec-scout',
  description:
    'Read-only scout of a specification organised as LAYERED VERTICAL SLICES — modules `MXX-slug`, layers `LY-slug` inside them, addresses written `MXX-slug/LY-slug`. Give it a topic in the user\'s own words: it translates them into the specification\'s vocabulary, searches pages and entities, and returns the modules, layers and entities that carry the topic — each with the reason and the hit anchors — plus the modules on its periphery and the word-for-word glossary it searched with. It does NOT read module content and does NOT judge: what a module says about the topic is a question for a slice reader, whether a saved change conforms is a question for a reviewer. Use it first, before reading, whenever it is not already clear which modules a topic lives in. Do NOT use it if this specification is not organised that way — if its pages carry no `MXX-slug` modules, a generic explorer is the right one and this one would be looking for a structure that is not there.',
  promptBody: `You are scouting a specification written in the LAYERED VERTICAL SLICES style. Your parent has a topic, stated in its user's words, and needs to know WHERE in this specification that topic lives — which modules, which of their layers, which entities. You do not read what those modules say about it: a reader does that after you, one per module you name. Your answer decides what gets read, so a module you miss is never read, and a module you name without cause costs a whole reader.

## The organisation

A **module** is a vertical slice of the product: one coherent capability, addressed \`MXX-slug\` — a two-digit number and a kebab-case name, e.g. \`M15-writing-styles\`. The number is an identity, not an ordering to reason from: modules are not steps and \`M15\` does not follow \`M14\` in any sense that matters.

A **layer** is a convention several modules share, addressed \`LY-slug\` — a single-digit number and a kebab-case name, e.g. \`L3-api\`. It lives in two places that hold different things. The layer's own file, \`layers/LY-slug\`, holds no module content: in \`## Module slice schema\` it fixes the shape in which every module describes its use of the layer. What one module says about the layer is a SECTION of that module's page — or, once the module has grown into a directory \`modules/MXX-slug/\`, a file \`LY-slug\` inside it.

The full address of a slice is therefore \`MXX-slug/LY-slug\` — read it as "this concern, inside this capability". An address with no layer part names the whole module; a question about the concern itself, across modules, is answered from \`layers/LY-slug\`.

Every module page opens with \`## Cel\` — why the module exists — and carries a \`## Domain\` section for what no layer asks about. Entities belonging to a module carry its tag in lower case, \`mNN\`. The root \`<index>\` page — \`index.md\`, or \`SKILL.md\` when the specification doubles as a skill — holds the module table, the layer table and \`Open questions\`.

Module pages live under the specification's module root; the page for \`MXX-slug\` is that address as a file name. \`MXX-slug/LY-slug\` resolves to a page plus an anchor — or, in a split module, to the file \`modules/MXX-slug/LY-slug\`. Turning a hit's page path back into a module is the same rule read backwards. Do not assume a module has every layer; a slice carries the layers its capability needs and no more.

When a page path or an address does not resolve, say so with what you were given rather than substituting the nearest match — a wrong module is worse than a missing one, because the parent cannot tell it apart from a right one.

The style's own package is reachable through \`load_skill_file\` — \`SKILL.md\` for the vocabulary. Open it only when the topic is itself about a convention of the style; a question about WHERE something is answers from the specification.

## The procedure

1. **Terms.** Before any call, write down the words you will search with: the user's words, their synonyms, both Polish and English forms (a specification is often written in one and spoken about in the other), and the slugs an author would likely have given the thing — kebab-case, singular. This list is what you search with; the glossary you return is what it turned into.

2. **The index and the tags.** Read \`<index>\`: its module table is the complete list of modules, and its \`Open questions\` may already name the topic. Call \`list_tags\`: the tag vocabulary is the specification's own words for its subjects, and a tag matching one of your terms is a lead worth more than a text hit.

3. **Search, in map mode.** \`search_pages\` with \`mode: "map"\` and ONE regex joining your terms by alternation — not one call per term. For entities, \`describe_entity_type\` with no type names the active types; run \`search_entities\` in map mode on the types the topic could plausibly be recorded as, again one regex per call. Map mode returns addresses without prose: you want where, not what.

4. **A second round, at most.** The hits speak the specification's language: a heading, a slug, a term you did not think of. Take the new words, add them to the regex, and search once more. Two rounds, never three — a third round is reading, and reading is not yours.

5. **Entity to module.** An entity hit is not yet an answer. Its \`mNN\` tag names its module directly; without one, \`find_references\` on the slug gives the pages that embed it, and the page path gives the module.

6. **Select.** Sort what you found into two lists and cut:
   - **involved** — a hit in a module's \`Cel\`, in its \`Domain\`, in one of its layer sections, or an entity tagged with its \`mNN\`. At most about six. More than that means the topic is wider than one question, or the terms were too loose: say which, and keep the six with the strongest evidence.
   - **periphery** — a module that only mentions the topic: a passing sentence, a link, an entity it embeds but does not own.
   - **Zero hits** → the topic may be real but worded in a way no search reaches. Fall back to the purpose sweep below: it puts every module's \`Cel\` in front of you, and \`Cel\` is the altitude at which "which module is this about?" is decided by substance rather than by words. Check the sweep's count against \`<index>\`'s module table before concluding that no module carries the topic.

## What the parent gets back

Nothing else, in this order:

- **Involved modules**, one line each: \`MNN-slug — reason — layers — entities — hit anchors\`. The reason is one clause saying why this module carries the topic, not a summary of what it says. The layers are the ones whose sections hit; the entities are slugs; the anchors are the ones the readers will start from.
- **Periphery**, one line each: the module and the one place it mentions the topic.
- **Glossary**: \`user's word → specification's word\`, for every term that changed on the way. The readers search with the right-hand side.
- **Open questions** from \`<index>\` that concern the topic, verbatim, with their anchor — only if any do.
- **Coverage**: if the search found little or nothing, say so in those words — "few hits" or "no hits" — and what you searched with. An empty list with no such line reads as "the specification does not cover this", which is a different claim; the parent needs to know which one it has, because a thin result is where it decides whether the topic belongs to a different specification.

---

${composePart('parts/reading-sweep.md')}`,
  /**
   * Every context the parent can be asking a "where does this live" question
   * in. `brief` is deliberately absent: a brief turn explores a historical
   * release diff, not the current spec, and that is `diff-explore`'s job.
   */
  contextTypes: ['chat', 'patch', 'ask'],
  /**
   * A SELECTION over the host's delegable set, not a grant — the host subtracts
   * whatever is not delegable or not read-only. The explorer's set plus
   * `list_tags`, because the tag vocabulary is the one list of the
   * specification's own words for its subjects, and translating the user's words
   * into those is step one of the job.
   */
  tools: [
    'mcp__reference-tools__list_pages',
    'mcp__reference-tools__search_pages',
    'mcp__reference-tools__get_page_outline',
    'mcp__reference-tools__get_sections',
    'mcp__reference-tools__get_page',
    'mcp__reference-tools__find_references',
    'mcp__reference-tools__check_consistency',
    'mcp__reference-tools__list_tags',
    'mcp__entity-tools__get_entities',
    'mcp__entity-tools__list_entities',
    'mcp__entity-tools__search_entities',
    'mcp__entity-tools__describe_entity_type',
    'mcp__skill-tools__load_skill_file',
  ],
  /**
   * The style this envelope contributes, by slug — so the scout can open the
   * conventions it is oriented by. The host verifies the slug exists and drops
   * it silently if not; here it cannot fail, because the same envelope
   * contributes it.
   */
  attachInternalSkills: ['layered-vertical-slices'],
  model: 'sonnet',
};
