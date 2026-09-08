# Brief workflow (release brief generation)

Use this when **the active context is a brief thread** and you have just been called via `load_skill_file("layered-vertical-slices")`.

The posture of a brief thread is the host's, and it is already in your window as `<interaction_context type="brief">`: the two audiences, the self-containment invariant, inline-never-refer, describe the system rather than the spec edits, drop editorial noise, the tools mounted, and the map-then-fan-out delegation with its binding on what enters your context. This file adds only what that block cannot know, because it is about a specification written in **this** style: what counts as feature substance here, how to partition this style's delta map so that modules stay whole, and how the findings are ordered into a narrative.

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

## B. Partitioning the delta map so modules stay whole

The host's block says to probe, partition and fan out; this is how the `pages` dimension of the map is cut in this style. A module is one main file plus, once it is split, a directory of layer subpages — and a slice that carries half a module produces a brief that describes half a behaviour.

Classify each page path with the module main-file pattern the **cross-cutting reading protocol** sweeps with — its `pathInclude`:

<!-- include: module-path-pattern -->

A path that matches is a module's main file; a path under `modules/<dir>/` that does not match is one of that module's subpages. The pattern classifies, it does not group — nothing in a non-match names the module — so group by the path's directory afterwards: every entry under `modules/<dir>/` joins the slice of the main file that directory names. Layer files and `<index>` form their own slice. You take the **pattern, not the call**: `search_pages` describes the repository's current state, and in a brief thread the only ground is `release_diff`; grounding a historical brief in HEAD breaks its self-containment.

Entities partition by their own type; a deleted entity travels in the same slice as its type. Every slug and path lands in exactly one slice — a slice never handed out is a silently incomplete brief, and nothing downstream catches it.

**The window shapes the framing.** A closed window (`from_release` and `to_release` both set) is authored from the diff. An open `to` has no second release to diff against: do not run a diff, author from what the thread gives you. A `from_release` of `(initial)` covers everything from the beginning — every entry is a creation, so the brief describes what the system *is*, not what changed; open with `# Initial brief: <to_release>`, which the system pre-fills.

## C. Narrative order

1. Open with 2–4 sentences on the **intent** of the release — the user-job the changes enable. The reader learns *why* the release happened in the first paragraph.
2. Group by user-visible theme (new capabilities, breaking changes, internal refactors), not by entity type or by spec page. Module and layer references are anchors *within* themes, never the primary axis.
3. Per theme: what the system now does, in plain prose, with the change content inlined.
4. Close with `## For implementers` — edit targets ordered roughly by dependency (migrations before code that uses them, types before consumers), each anchored to its module and layer ("this lives in M03's L1 section") when that helps a reader find the spec's side of it; the path or snippet is what the agent acts on, not the module reference.

When the user asks for an edit to an existing brief: "shorter" tightens prose and never drops an inlined shape, path or signature — the second audience needs the facts intact; "add X" is an insertion after the section it belongs to; "reframe for a different audience" changes only the register. A fix to an inlined shape is a re-read of `release_diff` for that entity, never a paraphrase from memory. An empty diff (`from === to`) is a fact to report, not a prompt to invent changes. A question the window cannot answer — what the system looks like today, what a page says at HEAD — is answered by saying so and pointing the user at `c4s ask`, not by guessing.
