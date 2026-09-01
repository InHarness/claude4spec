import type { PluginSubagentContribution } from '@c4s/plugin-runtime';

/**
 * The style's own spec explorer.
 *
 * It ships in the same envelope as the style, and the coupling is real rather
 * than convenient: this subagent's `promptBody` REPLACES the parent's prompt
 * wholesale, so without the style's conventions it would not know what it is
 * moving through — and the style without it leaves the parent grepping a
 * specification whose organisation it was never told about.
 *
 * It does NOT replace the host's built-in `spec-explore`; no such field exists
 * and none is planned. Both stand in the turn and the model routes between them
 * on `description` alone — which is why the host's own prompt names neither.
 * The built-in is the FLOOR, for a project with no writing style at all; this
 * one wins in a project organised the way it describes, because it can say so
 * more sharply.
 *
 * Nothing binds it to the style being ACTIVE, and nothing should: a contribution
 * is filtered on `contextTypes` and name, never on `config.writingStyle`, so this
 * envelope being built-in means every project sees it in the roster — including a
 * flat one. The guard is therefore in the `description` itself, which says both
 * when to pick it and when not to. Routing runs on descriptions; a description
 * that only advertises is half-written.
 *
 * `promptBody` carries ORIENTATION only. Everything mechanical — the read-only
 * posture, the ban on delegating further, the findings format, the truncation
 * protocol — is the host frame's, prepended to this body and not rewritable
 * from here. Restating any of it would be duplication that drifts.
 */
export const layeredSpecExplore: PluginSubagentContribution = {
  name: 'layered-spec-explore',
  description:
    'Read-only explorer of a specification organised as LAYERED VERTICAL SLICES — modules `MXX-slug`, layers `LY-slug` inside them, and addresses written `MXX-slug/LY-slug`. Delegate to it to locate a module, a layer, the slice that owns a behaviour, or the page and anchor behind an address, without pulling the bulk into your own context. Prefer it over a generic explorer whenever the question is about WHERE something lives in this structure. Do NOT use it if this specification is not organised that way — if its pages carry no `MXX-slug` modules, a generic explorer is the right one and this one would be looking for a structure that is not there.',
  promptBody: `You are exploring a specification written in the LAYERED VERTICAL SLICES style. What follows is how that specification is organised — the mechanics of exploring it are above and are not yours to restate.

## The organisation

A **module** is a vertical slice of the product: one coherent capability, addressed \`MXX-slug\` — a two-digit number and a kebab-case name, e.g. \`M15-writing-styles\`. The number is an identity, not an ordering to reason from: modules are not steps and \`M15\` does not follow \`M14\` in any sense that matters.

A **layer** is a horizontal cut INSIDE one module, addressed \`LY-slug\` — a single-digit number and a kebab-case name, e.g. \`L3-api\`. The layer numbers repeat across modules and mean the same thing in each: the same \`LY-slug\` in two modules is the same kind of concern, seen from two slices. A layer never spans modules.

The full address of a slice is therefore \`MXX-slug/LY-slug\` — read it as "this concern, inside this capability". An address with no layer part names the whole module.

## Turning an address into something you can read

Module pages live under the specification's module root; the page for \`MXX-slug\` is that address as a file name. Layers are SECTIONS of their module's page, not files of their own — so \`MXX-slug/LY-slug\` resolves to a page plus an anchor, and \`get_page_outline\` on the module page is the cheapest way to see which layers it actually carries. Do not assume a module has every layer; a slice carries the layers its capability needs and no more.

When an address in your assignment does not resolve, say so with the address you were given rather than substituting the nearest match — a wrong module is worse than a missing one, because the parent cannot tell it apart from a right one.

## Where the conventions themselves live

The style's own package is reachable through \`load_skill_file\`: \`SKILL.md\` for the conventions (naming, structure, quality rules), \`workflows/\` for the methodology of a genre, \`templates/\` for the shape a new module, layer or index page takes. Open one only when the parent's question is actually about a convention. A question about WHERE something is answers from the specification, not from the style.

## What the parent gets back

Addresses first — \`MXX-slug/LY-slug\`, page paths, section anchors, entity slugs — then the few facts it must inline. Where a behaviour is split across slices, name every slice that carries a piece of it and say which piece; a single address for a cross-cutting behaviour is a wrong answer that reads like a right one.`,
  /**
   * Every context the parent can be asking a "where does this live" question
   * in. `brief` is deliberately absent: a brief turn explores a historical
   * release diff, not the current spec, and that is `diff-explore`'s job.
   */
  contextTypes: ['chat', 'patch', 'ask'],
  /**
   * A SELECTION over the host's delegable set, not a grant — the host subtracts
   * whatever is not delegable or not read-only. Mirrors the generic explorer's
   * spec-reading half; the entity-graph tools a given project mounts are not
   * knowable from here, so this asks for the ones the host always has.
   */
  tools: [
    'mcp__reference-tools__list_pages',
    'mcp__reference-tools__search_pages',
    'mcp__reference-tools__get_page_outline',
    'mcp__reference-tools__get_sections',
    'mcp__reference-tools__get_page',
    'mcp__reference-tools__find_references',
    'mcp__reference-tools__check_consistency',
    'mcp__entity-tools__get_entities',
    'mcp__entity-tools__list_entities',
    'mcp__entity-tools__search_entities',
    'mcp__entity-tools__describe_entity_type',
    'mcp__skill-tools__load_skill_file',
  ],
  /**
   * The style this envelope contributes, by slug — so the explorer can open the
   * conventions it is oriented by. The host verifies the slug exists and drops
   * it silently if not; here it cannot fail, because the same envelope
   * contributes it.
   */
  attachInternalSkills: ['layered-vertical-slices'],
  model: 'sonnet',
};
