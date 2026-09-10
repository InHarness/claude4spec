# Patch workflow (folding a filed deviation back into the spec)

Use this when **the active context is a patch thread** and you have just been called via `load_skill_file("layered-vertical-slices")`.

The `<current_patch>` block carries the implementer's account verbatim — that is *what* to fix — and its `patch_kind` attr says what kind of gap the fix closes: `drift` (reality was ahead of the brief — update the spec to what the code does), `missing` (a detail the implementer had to decide alone — add it so the next brief does not reproduce the gap), `incorrect` (the brief was wrong about existing code — correct the entity or section describing it), `clarification` (the implementer guessed — take a position and write it down; an ambiguity resolved in a chat reply is one that returns). The posture of the turn — implement what the patch establishes, say what you did not do and why, verify before you claim — is the host's `<interaction_context type="patch">` block. This file is only *where* a fix lands in this specification's layout.

The `## What I found` account is authoritative — they were looking at the code. The `## Suggestion` is a starting point: you can see the whole current specification and they could not, so a better fix is allowed and frequently right; when you take a different route, say so.

## Where the fix goes in this specification

1. **Entity or prose?** A change to a DTO field, an endpoint signature, a table column or a UI view is an ENTITY mutation — never a hand-edit of the markdown that embeds it. A change to how the system behaves, why, or under what constraint is a module-section edit.
2. **Which module, which layer?** Locate the module that owns the behaviour, then the layer section within it. A patch touching one behaviour across layers touches one module in several sections, not several modules. When the owning module is not obvious from the patch's own words, locate it with the **cross-cutting reading protocol** (carried at the end of this file) rather than by opening module files in turn: it puts every module's `Cel` in front of you, which is the level the ownership question is settled at. Mind its silent failure mode — a module whose section is not named `## Cel` never appears in the sweep, so a module missing from the result is not proof that none owns the behaviour.
3. **Does it belong in a layer file instead?** Only if the patch is about how the spec itself is written — a rule every module must now follow. That is rare; the default is a module.
4. **A dependency the implementer hit that the spec never recorded** is a `module-dependency` record, one per direction, tagged by the module that requires — not a sentence in either module's prose. Check the incoming side too (protocol 2 below): a `drift` patch about a coupling often means the far side's record is the one that is stale.
5. **Acceptance criteria.** If the patch establishes behaviour that a test could pin, check whether the owning module's `## Acceptance criteria` section already covers it — read the section; only where this project backs that section with an entity type is the check a query rather than a read. A `missing` patch is often a criterion that was never written.

Read the current content before you edit it. The patch tells you what is wrong, not what is around it.

If the patch needs no change at all — already fixed by an earlier one, or the account does not hold up on inspection — say that plainly. Marking the patch `completed` is the user's action in the UI; there is no tool for it here.

---

<!-- include: parts/placement.md -->

<!-- include: parts/reading-sweep.md -->

<!-- include: parts/reading-deps.md -->
