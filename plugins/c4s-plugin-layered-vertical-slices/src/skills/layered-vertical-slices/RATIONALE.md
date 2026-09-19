# Why the package is shaped this way

This file is not shipped: it is outside the `files` map and no `load_skill_file` reaches it. It holds the reasoning behind the package's shape, so that the shipped documents can hold only instructions.

## Four owners, one style

The agent's window already contains, from other sources, the contract of every MCP tool it can call (the tool description), the posture of the thread it is in (`<interaction_context>` — `BRIEF_RULES`, `PATCH_RULES`), the semantics of every active entity type (the type's system-prompt block — for this envelope, `module-dependency`), and the report shapes of every subagent it can delegate to (the subagent's own prompt). Every sentence of the style that restated one of these was a second home for a norm, and the second home is the one that drifts: `search_pages`' default page size and `get_sections`' anchor ceiling were both written into the style as literals, and the brief workflow carried a table of nine error codes of which one (`BRIEF_ARCHIVED`) existed nowhere in the host. The rule is therefore: *a tool description documents the contract; interaction rules document the thread's posture; an entity block documents the record; a subagent prompt documents its own reports; the style documents only the decisions of this style.* The test: a sentence that would be true in another writing style is not content of this one. A guard test in the host imports the live constants and the error-code catalogue and fails the build on a re-created copy.

## One home in source, N deliveries

An earlier shape split the package into more files loaded at the point of use. It moved the cost from tokens to discipline — a rule not loaded is a rule not in force — and the risk fell on the agent. Composition removes that trade: a rule is written once in `parts/` and spliced by the module, at import, into every document whose steps depend on it. The agent loads exactly what it loads today; the source holds one copy. The duplication that returns is in the registry's memory, where it is free; the duplication that leaves is in the source, where it drifted seven times over.

The core (`SKILL.md`) is only what is needed before a route is chosen. The test for a sentence of the core: every thread type needs it before choosing a route, **and** it is true only in this style. Everything else — the rules, the steps, what a tool or the thread's posture already says — travels with a workflow or stays with its owner. This is also why the route table sends even a question to `workflows/read.md`: a question about the rules gets nothing for free from the core.

## Read → plan → apply

A thread on an existing spec passes through up to three phases with different questions — what the spec says **today**, **where and what** to change, **how** to write it — and different reading widths: wide in read (a scout, then readers), wide where the impact reaches in plan, narrow in apply (the section and its layer's schema, just before the write). One `daily.md` served all three and paid for all three in every turn. Four principles shape the split:

1. **A file is loaded at most once per thread, and no part is spliced into two files loaded in the same thread.** A `tool_result` stays in the transcript, so `read.md` loaded at the start serves planning and execution alike. That is why reading is a file of its own rather than a paste into `plan.md` and `apply.md`: the typical thread is plan → apply, and a paste would ride it twice. A test pins it.
2. **The rules split along the seam the package already had.** Rules of judgement — where and what: placement, the `Domain` membership test, module-vs-layer — go with `plan.md`. Rules settled on the text — the ones carrying `*Symptom:*` markers: authoring, `Cel`, the `Domain` form, and the check list projected from them — go with `apply.md`.
3. **A tool documents its contract; the style documents the decision.** `runTransagent`, `mark_plan_applied`, `release_create`, the host's discovery and task-tracking blocks each describe themselves; the workflows say only *when* to use them and *how to cut along the grid* — a plan split by modules, a layer or `<index>` change decided before the children that depend on it. Naming the argument that carries one of those decisions — `planPath` to bind a child to the plan, the top-level `planMode` to open it read-only — is part of the decision, not a copy of the contract; restating what the argument validates, or the codes it fails with, would be.
4. **The bridge from plan to apply is the plan entry's contract** — address, the layer schema's fields it answers, entity operations, the consequences the rules attach. Apply takes the plan as settled and stops on a mismatch rather than re-planning: a plan quietly improved during execution is a plan nobody approved.

An `ask` thread — the receiving side of a peer consult from another spec — loads this style too and is always read-only. It gets no route of its own: it is a thread that ends at `read.md`.

`apply.md`'s Close step carries content that would otherwise be the host's: marking the plan applied, the follow-ups list, proposing a release. The host has no plan-execution block while its prompt is frozen, so for now the style says it; when the host gains one, those lines leave for it.

## Why read is a scout and readers

The first shape of `read.md` had the main agent find a topic's owners with the purpose sweep and read the modules itself, delegating only as a fourth step. It failed four ways. The sweep answers *which module should own this*, not *where does the specification talk about it* — a different question, and the one a reader has. There was no way in from an entity, a convention or a phrase. Delegation sat behind reading in the order of steps, so it came too late to save anything. And the main agent's context filled with module bodies.

Now a **scout** translates the user's words into the specification's vocabulary, searches pages and entities with them, and returns a selected list; **readers**, one per module and in parallel, read how that module realises the topic together with its first-degree edges; the main agent dispatches and assembles. The sweep has not gone: it is the scout's fallback when searching finds nothing, and it moved to `plan.md`, where "where *should* this live" is the question actually asked.

A reader reads **by topic**, never the whole module, and that is measured, not stylistic. In `app-spec` (52 modules) the median module is 39k characters, the p90 97k; `m05-chat-agent` is 370k across 14 files and 121 headings, then `m13` at 200k and `m17` at 155k. A subagent's turn budget is 40 by default and its exhaustion returns nothing at all — no partial answer. A reader told to read `m05` whole would come back empty. So it reads a fixed minimum (`Cel`, `Domain`), the scout's anchors and the sections of the layers the topic touches, each against its layer's schema; on the far side of an edge it reads `Cel` and the pointed-at section only; and it reports incrementally, so what it has read survives what it has not.

The main agent does the dispatching because nobody else can: the host frame forbids a subagent to delegate further. A scout that spawned its own readers would be the obvious shape, and it is not available.

Looking beyond the specification stays the main agent's decision too. `ask` to another project exists in `chat` and `patch` threads and not in an `ask` thread, and whether a thin result means "not covered" or "covered elsewhere" is a judgement about the workspace, which only the main agent sees (`<workspace_projects>`).

## Why rule 2a exists

Rule 2's layer-purity test asks whether a sentence would survive deleting a module. As a judgement it came back from review as an opinion rather than a deviation. 2a is the same rule restated so it can be settled on a file's text alone — no `[Mm]\d+` token, no `section_ref`, the slot not paraphrased — because a rule without a named symptom cannot be applied by a reader who does not already know the answer. The same reasoning gives every decidable rule its *Symptom:* marker, and the checks projection is extracted from those markers rather than maintained as a second list.

## Why budgets measure one heading's text

A budget for a whole section grows with the number of things the module has to say and so says nothing; a long run of text under one heading says that a heading is missing. That is why `Domain` has no section budget and a 2500-character budget per heading's own text, with nesting allowed down to `######`: the repair is division, not shortening. A module file has no line budget for the same reason — its length follows the number of layers it carries, so a line count would flag a module for being complete; what warrants a split is one slice dominating the rest, a judgement no count makes. A fenced block in `Domain` has no length threshold either: it is a shape written out by hand, and the three-line one belongs in prose or in an entity as much as the thirty-line one.

`Cel` keeps its 1200 characters: it is one heading's text by construction, so the two rules agree.

## Why `Cel` is scoped so tightly

`Cel` answers *why the module exists* and nothing else. Every relational boundary already has a home — a module on the other side is a dependency record, a layer on the other side is that layer's section — so the prohibition on identifiers and embeds costs nothing: nothing it forbids has nowhere else to go. It narrows the host's referential convention rather than fulfilling it: the convention says "an embed rather than bare prose"; `Cel` closes both exits, and reading the prohibition as a licence for untagged prose reads it backwards. The 1200-character budget is a number, not a suggestion, because "keep it short" is the sentence this criterion exists to refuse.

## Why the reading protocols are protocols

Dropping the path filter from the sweep does not slow it down; it answers a different question (the purpose of a *file*). Dropping map mode does not slow it down; it fills the window with bodies before the addresses exist. Skipping the incoming-edge step of the dependency trace does not give a smaller answer; it gives a directed answer that looks undirected. Each is therefore written as a step, and the text says so, because "optimization" is the word under which a step gets dropped.

## Why "Domain" is not a layer

A layer's content must survive the deletion of any single module. A "Domain" layer collapses to one paragraph per module, each of which dies with its module, and it has no slice schema because every module's domain is unique. The category mistake is stable enough to name in the core. What the prohibition costs is nothing, because the content has an address: the module file's own `## Domain` section, third H2, whose membership test is a residuum — what no layer of *this* project asks about. That makes the test relative rather than topical, and makes the section's budgets a detector: the same shape recurring in several modules' `Domain` sections is a shared convention, which is what a layer is.
