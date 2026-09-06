<!--
Template for a module file (`modules/MXX-<slug>.md`) in a layered-vertical-slices spec.
Copy this file, rename it, and replace placeholders. See SKILL.md §5 and §6 for guidance,
and §7 for the rules the `## Cel` section below must satisfy.

Nothing goes between the H1 and `## Cel` — no hook, no blockquote, no table. Content placed
there carries no anchor of its own, so it is invisible to the section index and to every
cross-cutting read.
-->

# MXX — <Module Name>

## Cel

<First sentence: name the user job this module enables — who does what, to what end. Avoid tautology ("M03 manages endpoints"); name the value ("Endpoint authors can describe HTTP contracts once and have them stay consistent across docs, code, and the running system"). If you cannot write this sentence without circularity, the module is premature — defer it to `<index>`'s "Open questions" until the user job is clear.>

<2–4 more sentences: how this module realizes that job — entity shape, scope boundary, what it explicitly does NOT do. Prose only, and no entity embed, no `section_ref`, no module or layer identifier — not even this module's own. Relational boundaries belong to the sections below: module-to-module ones to `## Zależności`, layer ones to that layer's own section. Whole section: 1200 characters.>

## Zależności

<!--
The second H2, and its heading is literal — `## Zależności`, with the diacritic.

This section holds the EMBED and one sentence of prose. No markdown table: a
module-to-module dependency is a `module-dependency` entity, one per ordered
pair, and a mutual relation is therefore TWO entities rather than one row read
in both directions. The entity carries the tag of the module that REQUIRES, so
this embed shows this module's OUTGOING edges.

Incoming edges are deliberately not here and cannot be embedded: they carry the
other module's tag. Read them with
`list_entities({ type: "module-dependency", filters: { provider: "MXX" } })`.

Relations with LAYERS are not dependencies in this sense and do not belong in
this section — each one lives in that layer's own section below.
-->

<tagged_list type="module-dependency" tags="mXX"/>

<One sentence: why this module leans outward at all — the shape of what it takes
from others, not a restatement of the list above.>

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

     Tag slugs are LOWER-CASE, as SKILL.md §6.8 writes them, while the prose spells a module `MXX`.
     Both spellings are correct in their own place; an embed written with the prose spelling selects
     on a tag nothing carries and renders empty, with no error to say why. -->
<tagged_list type="ac" tags="mXX"/>

<!-- Fallback — only when the project does not model AC as entities. Inline observable checklist:
- [ ] <criterion 1>
- [ ] <criterion 2>
-->
