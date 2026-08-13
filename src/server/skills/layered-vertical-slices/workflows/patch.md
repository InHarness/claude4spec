# Patch workflow (folding a filed deviation back into the spec)

Use this when **the active context is a patch thread** and you have just been called via `Skill("layered-vertical-slices")`.

A patch is feedback a coding agent recorded in its own repository while implementing a brief: it found the specification diverged from reality and wrote down what it hit. The `<current_patch>` block carries it verbatim — that is *what* to fix. This file is *how*, for this specification's layout.

## A. Read the kind first

`patch_kind` sits in the `<current_patch>` attrs and frames the whole turn:

| `patch_kind` | What it means | Where the fix usually lands |
| --- | --- | --- |
| `drift` | The brief described X; the code already did Y when the implementer arrived. | Update the spec to Y — reality was ahead of the brief. |
| `missing` | The brief was silent on a detail the implementer had to decide alone. | Add the detail (entity field, endpoint behaviour, edge case) so the next brief does not reproduce the gap. |
| `incorrect` | The brief was factually wrong about existing code. | Correct the entity or module section describing that code. |
| `clarification` | The brief was ambiguous; the implementer guessed and flagged it. | Take a position and write it down. An ambiguity resolved in a chat reply is an ambiguity that returns. |

The body is `## What I found` (the implementer's own account) and `## Suggestion` (what they think should change). The account is authoritative — they were looking at the code. The suggestion is a starting point: you can see the whole current specification and they could not, so a better fix is allowed and frequently right. When you take a different route, say so.

## B. Where the fix goes in this specification

The patch names a behaviour; you have to find its home in the layered layout before editing:

1. **Entity or prose?** A change to a DTO field, an endpoint signature, a table column or a UI view is an ENTITY mutation (`update_entities` / `create_entities`) — never a hand-edit of the markdown that embeds it. A change to how the system behaves, why, or under what constraint is a module-section edit.
2. **Which module, which layer?** Locate the module that owns the behaviour, then the layer section within it (L1 database, L3 API, L5 UI, …). A patch touching one behaviour across layers touches one module in several sections, not several modules.
3. **Does it belong in a layer file instead?** Only if the patch is about how the spec itself is written — a rule every module must now follow. That is rare; the default is a module.
4. **Acceptance criteria.** If the patch establishes behaviour that a test could pin, check whether an AC exists for it. A `missing` patch is often an AC that was never written.

Read the current content before you edit it. The patch tells you what is wrong, not what is around it.

## C. Verification

- Re-read what you changed, in the file, after writing it. `update_entities` returning success means the write landed, not that it said what you meant.
- When checking a claim means sweeping more of the spec than fits in this turn — "is this documented anywhere else?", "does any other module assume the old behaviour?" — delegate to `spec-explore` rather than guessing or skimming.
- If the `## Suggestion` assumed something the current spec contradicts, follow the spec and say which assumption failed.

## D. Reporting

Close the turn with what changed, page by page and entity by entity — and, explicitly, with anything the patch asked for that you did NOT do, and why. A patch half-applied in silence is worse than one openly declined: the next reader cannot tell which half.

If the patch needs no change at all — already fixed by an earlier one, or the account does not hold up on inspection — say that plainly. Do not manufacture an edit to have something to report.

Marking the patch `completed` is the user's action in the UI. There is no tool for it here; do not claim you did it.
