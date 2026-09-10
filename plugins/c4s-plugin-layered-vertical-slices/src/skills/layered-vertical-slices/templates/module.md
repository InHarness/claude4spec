<!--
Template for a module file (`modules/MXX-<slug>.md`) in a layered-vertical-slices spec.
Copy this file, rename it, and replace placeholders. `## Cel` must satisfy the Cel rules,
`## Zależności` rule 3a, `## Domain` the Domain rules — all three travel with the workflow you
are running.

Nothing goes between the H1 and `## Cel` — no hook, no blockquote, no table. Content placed
there carries no anchor of its own, so it is invisible to the section index and to every
cross-cutting read.
-->

# MXX — <Module Name>

## Cel

<First sentence: name the user job this module enables — who does what, to what end. Avoid tautology ("M03 manages endpoints"); name the value ("Endpoint authors can describe HTTP contracts once and have them stay consistent across docs, code, and the running system"). If you cannot write this sentence without circularity, the module is premature — defer it to `<index>`'s "Open questions" until the user job is clear.>

<2–4 more sentences: how this module realizes that job — entity shape, scope boundary, what it explicitly does NOT do. Prose only, and no entity embed, no `section_ref`, no module or layer identifier — not even this module's own. Relational boundaries belong to the sections below: module-to-module ones to `## Zależności`, layer ones to that layer's own section. Whole section: 1200 characters.>

## Zależności

<!-- The second H2, heading literal with the diacritic. The embed and one sentence, nothing
     else — no table (rule 3a). What a record is belongs to the `module-dependency` type. -->

<tagged_list type="module-dependency" tags="mXX"/>

<One sentence: why this module leans outward at all — the shape of what it takes
from others, not a restatement of the list above.>

## Domain

<!-- The third H2, literal — no layer number, no suffix. This is the module's own substance:
     what NO layer of this project asks about — its model, the rules its operations obey, the
     process it owns end to end, what it deliberately does not do. Test each paragraph against
     the layer files: an answer to a field of some layer's `## Module slice schema` belongs in
     that layer's section, not here.

     Content lives only under `###` headings YOU name (these two are placeholders, not a fixed
     set); `####` does not occur, and at most one paragraph stands directly under this heading.
     Budget: 3500 characters per subsection, 12000 for the section — past them, look for the
     same shape in other modules' `Domain` sections and propose a layer instead.

     A module with no substance of its own DELETES this section: there is no `n/d` variant. -->

### <Subsection the module names — e.g. the shape of the thing it owns>

<What the concepts are, how they are identified, which states they move through.>

### <Second subsection the module names — e.g. the rules its operations obey>

<Invariants and decisions with their reason, negative scope included; or the lifecycle this
module owns from beginning to end, one line per step, a step owned elsewhere being a sentence
and a pointer.>

## <Layer 1 name> (L1)

<Only include sections for layers this module touches.>

**If this module is a *consumer* of the layer** (the common case): fill the section using the layer's `## Module slice schema` — declare *what* this module contributes (tables, endpoints, entities, fields).

**If this module is the *implementor* of the layer** (named in the layer file's `Implementor module:` slot): use this section to document *how* the layer is backed — runtime, registry, hooks, cross-cutting conventions (naming, error handling, structure), patterns consumers copy, the "what consumers can rely on" half of the contract, and any shared utilities. Everything that does not depend on a specific consumer module living lives here.

<Content for how this module realizes L1. Example for a consumer:
- Tables / file layout / schema link (e.g. "See `modules/M03-endpoint/L1-db.md` for full schema")
- Key columns / fields
- Constraints and indexes>

## <Layer 2 name> (L2)

<E.g. operations, lifecycle, validation rules, edge cases during operations.>

## <Layer N name> (LN)

…

## Edge cases

- <edge case 1: situation → expected behavior>
- <edge case 2>

## Acceptance criteria

<!-- Preferred when the project models AC entities: the criteria live as `ac` entities tagged mXX
     (edge cases under mXX-edge), created via the project's MCP tools. Embed them live and add one
     sentence of prose explaining why; the list updates itself.

     Tag slugs are LOWER-CASE (rule 8), while the prose spells a module `MXX`.
     Both spellings are correct in their own place; an embed written with the prose spelling selects
     on a tag nothing carries and renders empty, with no error to say why. -->
<tagged_list type="ac" tags="mXX"/>

<!-- Fallback — only when the project does not model AC as entities. Inline observable checklist:
- [ ] <criterion 1>
- [ ] <criterion 2>
-->
