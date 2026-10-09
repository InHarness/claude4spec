## A. Spec-format vs feature substance

This is the most consequential filter in this workflow. In `layered-vertical-slices` the spec contains **two kinds of content** that look superficially similar in a delta map:

1. **Feature substance** — what the *system* does, has, constrains. Lives mostly in `modules/MXX-*.md` per-layer sections, in entity records (DTO, Endpoint, Database Table, UI View), and in the `## Modules` row of `<index>` when a new module appears.
2. **Spec-format conventions** — rules about *how to write the spec itself*. Lives in `layers/LX-*.md` files (`## Module slice schema` defines the *shape* a consumer module's section takes; `Implementor module:` slot names which module backs this layer; `## Role in the system` is orientational prose).

A coding agent in another terminal cannot act on (2). Telling them "L3 API uses `<tagged_list type="endpoint" tags="MXX"/>` to embed live endpoint lists" is a rule for the *spec author*, not for the implementer. If a brief inlines such content as if it were a requirement, the implementer wastes effort matching the spec's authoring grammar instead of building the system.

**Recognition table:**

| Delta entry | Classification | Action in brief |
| --- | --- | --- |
| Diff inside `layers/LX-*.md` § `## Module slice schema` | spec-format | **Drop.** Exception: if the schema change implies new runtime behavior (e.g. a new required field that any module must now declare → the system must validate it somewhere), describe the *runtime consequence*, not the schema text. |
| Diff inside `layers/LX-*.md` § `Implementor module:` slot | spec-format | **Drop.** This only renames who-implements-what in the spec; the system is unchanged. |
| Diff inside `layers/LX-*.md` § `## Role in the system` | spec-format | **Drop.** Orientational prose for spec readers. |
| New `layers/LX-*.md` file (whole file added) | mostly spec-format | Mention briefly that "the spec gained a new layer LX — \<name\> — which structures how modules describe \<topic\>" and stop. Do not transcribe the schema. The implementer cares only when modules start using this layer. |
| Diff inside `modules/MXX-*.md` § per-layer (e.g. `## Database (L1)`, `## API (L3)`) | substantive | **Translate** to a system-level statement; inline the entities/fields/endpoints. |
| Diff inside `modules/MXX-*.md` § `Cel` / `Edge cases` / `Acceptance criteria` | substantive | **Translate** to system behavior. |
| Diff inside `modules/MXX-*.md` § `Domain` | substantive | **Translate** to system behavior, exactly as a `Cel` diff — it is the module's own substance (model, invariants, owned lifecycle, boundary), not a rule about writing the spec. |
| Diff inside `modules/MXX-*.md` § `Zależności` | usually drop | A dependency record says what one module needs from another; it becomes brief material only when the *system* gained or lost a coupling an implementer must wire. |
| New `modules/MXX-*.md` file | substantive | Open with the module's purpose in one sentence, then walk its per-layer sections. |
| Entity changes (DTO/Endpoint/Database Table/UI View — create/update/delete) | substantive | **Inline with full content** — the field table, the method and path with its DTOs and status codes, the SQL fragment, the route and what it loads. |
| Diff in `<index>` § `## Modules` table (new row) | substantive | New module appeared — name it, give purpose. |
| Diff in `<index>` § `## Layers` table (new row) | mostly spec-format | Same as "new layer file" — one-line mention. |
| Diff in `<index>` § `## Open questions` | usually drop | Open questions are workshop notes, not commitments. Include only if the user explicitly asks for "spec status" framing. |
| Diff in `<index>` § `## Tech stack` | substantive | A real change to runtime/dependencies — translate to "the system now runs on \<X\>". |
| Diff in `<index>` § `## Acceptance criteria` (project-level) | substantive | Translate to observable behavior. |

**Heuristic in one question:** *"Could a coding agent in another repo, with only this brief, do something concrete in response to this?"* If no — drop it.

If after filtering nothing substantive remains in a release, say so explicitly: *"This release contains only editorial cleanup of the specification — no system behaviour changes."* Do not pad.
