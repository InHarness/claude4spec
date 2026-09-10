# Why the package is shaped this way

This file is not shipped: it is outside the `files` map and no `load_skill_file` reaches it. It holds the reasoning behind the package's shape, so that the shipped documents can hold only instructions.

## Four owners, one style

The agent's window already contains, from other sources, the contract of every MCP tool it can call (the tool description), the posture of the thread it is in (`<interaction_context>` — `BRIEF_RULES`, `PATCH_RULES`), the semantics of every active entity type (the type's system-prompt block — for this envelope, `module-dependency`), and the report shapes of every subagent it can delegate to (the subagent's own prompt). Every sentence of the style that restated one of these was a second home for a norm, and the second home is the one that drifts: `search_pages`' default page size and `get_sections`' anchor ceiling were both written into the style as literals, and the brief workflow carried a table of nine error codes of which one (`BRIEF_ARCHIVED`) existed nowhere in the host. The rule is therefore: *a tool description documents the contract; interaction rules document the thread's posture; an entity block documents the record; a subagent prompt documents its own reports; the style documents only the decisions of this style.* The test: a sentence that would be true in another writing style is not content of this one. A guard test in the host imports the live constants and the error-code catalogue and fails the build on a re-created copy.

## One home in source, N deliveries

An earlier shape split the package into more files loaded at the point of use. It moved the cost from tokens to discipline — a rule not loaded is a rule not in force — and the risk fell on the agent. Composition removes that trade: a rule is written once in `parts/` and spliced by the module, at import, into every document whose steps depend on it. The agent loads exactly what it loads today; the source holds one copy. The duplication that returns is in the registry's memory, where it is free; the duplication that leaves is in the source, where it drifted seven times over.

The core (`SKILL.md`) is only what is needed before a route is chosen. This is also why §4 tells a read-only turn to load its workflow: after the move, a question about the rules gets nothing for free from the core.

## Why rule 2a exists

Rule 2's layer-purity test asks whether a sentence would survive deleting a module. As a judgement it came back from review as an opinion rather than a deviation. 2a is the same rule restated so it can be settled on a file's text alone — no `[Mm]\d+` token, no `section_ref`, the slot not paraphrased — because a rule without a named symptom cannot be applied by a reader who does not already know the answer. The same reasoning gives every decidable rule its *Symptom:* marker, and the checks projection is extracted from those markers rather than maintained as a second list.

## Why `Cel` is scoped so tightly

`Cel` answers *why the module exists* and nothing else. Every relational boundary already has a home — a module on the other side is a dependency record, a layer on the other side is that layer's section — so the prohibition on identifiers and embeds costs nothing: nothing it forbids has nowhere else to go. It narrows the host's referential convention rather than fulfilling it: the convention says "an embed rather than bare prose"; `Cel` closes both exits, and reading the prohibition as a licence for untagged prose reads it backwards. The 1200-character budget is a number, not a suggestion, because "keep it short" is the sentence this criterion exists to refuse.

## Why the reading protocols are protocols

Dropping the path filter from the sweep does not slow it down; it answers a different question (the purpose of a *file*). Dropping map mode does not slow it down; it fills the window with bodies before the addresses exist. Skipping the incoming-edge step of the dependency trace does not give a smaller answer; it gives a directed answer that looks undirected. Each is therefore written as a step, and the text says so, because "optimization" is the word under which a step gets dropped.

## Why "Domain" is not a layer

A layer's content must survive the deletion of any single module. A "Domain" layer collapses to one paragraph per module, each of which dies with its module, and it has no slice schema because every module's domain is unique. The category mistake is stable enough to name in the core. What the prohibition costs is nothing, because the content has an address: the module file's own `## Domain` section, third H2, whose membership test is a residuum — what no layer of *this* project asks about. That makes the test relative rather than topical, and makes the section's budgets a detector: the same shape recurring in several modules' `Domain` sections is a shared convention, which is what a layer is.
