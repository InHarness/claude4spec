<!--
Template for a module file (`modules/MXX-<slug>.md`) in a layered-vertical-slices spec.
Copy this file, rename it, and replace placeholders. See SKILL.md §5 and §6 for guidance.
-->

# MXX — <Module Name>

> <1-sentence hook — what is this module, in the voice of the spec.>

## Purpose

<First sentence: name the user job this module enables — who does what, to what end. Avoid tautology ("M03 manages endpoints"); name the value ("Endpoint authors can describe HTTP contracts once and have them stay consistent across docs, code, and the running system"). If you cannot write this sentence without circularity, the module is premature — defer it to `<index>`'s "Open questions" until the user job is clear.>

<2–4 more sentences: how this module realizes that job — entity shape, scope boundary, what it explicitly does NOT do.>

## Dependencies

| Module / Layer | Relation |
| --- | --- |
| L<X> | <what this module takes from the layer> |
| M<YY> | <what this module relates to in another module> |

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

<!-- Preferred when the project models AC entities: the criteria live as `ac` entities tagged MXX
     (edge cases under MXX-edge), created via the project's MCP tools. Embed them live and add one
     sentence of prose explaining why; the list updates itself. -->
<tagged_list type="ac" tags="MXX"/>

<!-- Fallback — only when the project does not model AC as entities. Inline observable checklist:
- [ ] <criterion 1>
- [ ] <criterion 2>
-->
