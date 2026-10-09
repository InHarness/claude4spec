# Brief workflow (release brief generation)

Use this when **the active context is a brief thread** and you have just been called via `load_skill_file("layered-vertical-slices")`.

The posture of a brief thread is the host's, and it is already in your window as `<interaction_context type="brief">`: the two audiences, the self-containment invariant, inline-never-refer, describe the system rather than the spec edits, drop editorial noise, the tools mounted, and the map-then-fan-out delegation with its binding on what enters your context. This file adds only what that block cannot know, because it is about a specification written in **this** style: what counts as feature substance here, how to partition this style's delta map so that modules stay whole, and how the findings are ordered into a narrative.

<!-- include: parts/brief-substance.md -->

## B. Partitioning the delta map so modules stay whole

The host's block says to probe, partition and fan out; this is how the `pages` dimension of the map is cut in this style. A module is one main file plus, once it is split, a directory of layer subpages — and a slice that carries half a module produces a brief that describes half a behaviour.

Classify each page path with the module main-file pattern the **cross-cutting reading protocol** sweeps with — its `pathInclude`:

<!-- include: module-path-pattern -->

A path that matches is a module's main file; a path under `modules/<dir>/` that does not match is one of that module's subpages. The pattern classifies, it does not group — nothing in a non-match names the module — so group by the path's directory afterwards: every entry under `modules/<dir>/` joins the slice of the main file that directory names. Layer files and `<index>` form their own slice. You take the **pattern, not the call**: `search_pages` describes the repository's current state, and in a brief thread the only ground is `release_diff`; grounding a historical brief in HEAD breaks its self-containment.

A module that is too large for one slice stays whole by being cut along its sections, not across modules: read the per-page `size` off the map, and for a page that alone outgrows a slice, take its `sectionMap` (`summaryOnly` with that one path) and hand out consecutive section windows (`sectionOffset` / `sectionLimit`) of that page, covering every position up to `total.sections`.

Entities partition by their own type; a deleted entity travels in the same slice as its type. Every slug and path lands in exactly one slice — a slice never handed out is a silently incomplete brief, and nothing downstream catches it.

**A map too large for one implementation pass.** This genre is the default, and it suits a change one implementer can carry in one pass. When the map, after the substance filter, touches **four or more modules**, or your partition needs **more than six slices**, write nothing yet: tell the user what the map holds (modules touched, entity count by type, the largest pages) and ask whether they want a **workflow brief** instead — a plan of work units implemented with the `c4s-workflow-implementer` skill, rather than an inlined narrative. Then end the turn. On "yes", load `workflows/brief-workflow.md` and follow it; on "no", continue here. A user who asked for a workflow brief in the first place never reaches this file.

**The window shapes the framing.** A closed window (`from_release` and `to_release` both set) is authored from the diff. An open `to` has no second release to diff against: do not run a diff, author from what the thread gives you. A `from_release` of `(initial)` covers everything from the beginning — every entry is a creation, so the brief describes what the system *is*, not what changed; open with `# Initial brief: <to_release>`, which the system pre-fills.

## C. Narrative order

1. Open with 2–4 sentences on the **intent** of the release — the user-job the changes enable. The reader learns *why* the release happened in the first paragraph.
2. Group by user-visible theme (new capabilities, breaking changes, internal refactors), not by entity type or by spec page. Module and layer references are anchors *within* themes, never the primary axis.
3. Per theme: what the system now does, in plain prose, with the change content inlined.
4. Close with `## For implementers` — edit targets ordered roughly by dependency (migrations before code that uses them, types before consumers), each anchored to its module and layer ("this lives in M03's L1 section") when that helps a reader find the spec's side of it; the path or snippet is what the agent acts on, not the module reference.

When the user asks for an edit to an existing brief: "shorter" tightens prose and never drops an inlined shape, path or signature — the second audience needs the facts intact; "add X" is an insertion after the section it belongs to; "reframe for a different audience" changes only the register. A fix to an inlined shape is a re-read of `release_diff` for that entity, never a paraphrase from memory. An empty diff (`from === to`) is a fact to report, not a prompt to invent changes. A question the window cannot answer — what the system looks like today, what a page says at HEAD — is answered by saying so and pointing the user at `c4s ask`, not by guessing.
