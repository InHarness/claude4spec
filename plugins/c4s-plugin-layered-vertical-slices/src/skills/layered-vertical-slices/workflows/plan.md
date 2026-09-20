# Plan workflow (from intent to a placed change)

Use this after `workflows/read.md`, when the turn must produce a **change placed on the grid**: in plan mode, or whenever the user brings an idea, a complaint or a concern rather than an edit with an address. You edit nothing here; the output is a plan.

The user almost never speaks in spec-language — they speak in *intent* ("what if endpoints could be versioned?"), in *complaint* ("this auth flow feels off"), or in concrete edits ("add a `retries` column to M03"). Planning is two understandings joined: what the user needs, and what that need does to the specification as it stands.

## Step 1 — Hear the user

Restate the user's *intent* in their own terms — what they are trying to enable, for whom, why now — in 2–3 lines, and ask one targeted clarification if anything is murky:

> *"Read as: you want endpoint authors to be able to express retry policy per-endpoint, because the current spec forces retry logic into shared middleware. Confirm? (Or is the goal narrower — just a `retries` count column without the policy framing?)"*

Do this even when the user thinks they are filing an explicit edit: edits without grounded intent become entries no one — human or code-gen agent — can later interpret. This is also the place to push back: if you cannot construct a coherent user-need behind the request — architectural taste, speculative cleanup with no user-visible improvement — say so plainly and ask. A translator can refuse to translate noise.

## Step 2 — Measure the impact

Hold the intent against the picture from `read.md`: which sections would have to say something different, which entities change shape, which dependency edges appear or disappear, which modules that lean on the topic are touched by it. Where the impact reaches modules you have not read, widen it the way `read.md` does: the scout for where, readers for what. Do not plan over a module you have not read.

## Step 3 — Classify

State the mode out loud if it is not obvious; it gives the user a chance to correct.

- **Explicit change.** *"Rename L4 from 'Library API' to 'SDK'."* Location and shape are stated — check them against the placement rules and go to Step 5.
- **Idea, problem, vague concern.** *"We should track who edited what."* Intent, not an edit → Step 4.
- **Inconsistency report.** *"M04 says X but L1 says Y."* Read both sides before proposing which one moves.

## Step 4 — Place

Map the change onto the grid; the rules at the end of this file decide. Where something *should* live is a different question from where the specification already talks about it — the scout answers the second. For the first, run the purpose sweep (protocol 1 at the end of this file): it puts every module's `Cel` in front of you, which is the altitude at which "which module owns this?" is decided by substance rather than by name. The candidate buckets:

- **New module.** A new entity or feature. Propose the next free number, a slug, and the layers it touches — after the module-vs-layer test.
- **Change to an existing module.** New column, operation, edge case, criterion, dependency. Ask the residual question **first — does any layer of this project ask for it?** A sentence answering a field of some layer's `## Module slice schema` belongs in that layer's section; only what no layer asks about is a candidate for the module's `## Domain`.
- **Layer-level change.** A new convention, or a contract change that affects several modules. Apply the layer-purity test (rule 2) *before* placing anything in a layer: if the candidate paragraph stops being true once you imagine any single module gone, it is not a layer change.
- **Cross-module relation.** A **dependency record** (rule 3a), one per direction — not a row in either file, and not a drawing in `<index>` either: the record IS where that edge lives.
- **Not a spec change at all.** Implementation detail, UX micro-decision, code style. Say so plainly and stop.
- **Not yet decided.** Real but unresolved → `<index>`'s `Open questions`, verbatim.

For every layer the change touches, read that layer's `## Module slice schema` **now**: the plan names the fields the change answers, so that whoever executes it fills the schema instead of rediscovering it.

## Step 5 — Write the plan

One entry per change, each carrying:

- **the address** — page and section (anchor), or the new file and the template it starts from;
- **the schema fields it answers**, for a layer section — by the names the layer file gives them;
- **the entity operations** — create, update, retag, delete, by type and slug;
- **the consequences the rules attach** — the `<index>` row, the dependency record (both deletions when a module retires), the retired number;
- **the rule number**, where a rule decided the placement.

Order entries the way they must be executed: layer files and `<index>` before the modules that fill them, a provider before the module that depends on it. Thread the intent from Step 1 through the plan — the mapping is in service of the need, not parallel to it.

Close the plan with **Seen, not planned**: places you met during the read that carry the same problem or a neighbouring one and are outside this intent. One line each, with an address. They become follow-ups when the plan is applied; they are not silently folded in.

In plan mode the plan is persisted with `update_plan`. Outside it, a small change is 2–4 lines and a confirmation:

> *"I read this as: change to M03 (new column `retries: int`), plus a new edge case (retry exhaustion). No layer change — retry counts are per-endpoint, not a cross-cutting concern. Confirm?"*

Then stop. Execution is `workflows/apply.md`, on the user's word.

## A plan too large for one thread

Split it, do not compress it. Hand a scope to a child thread with `runTransagent` — a `chat` child opened **in plan mode** — whose message carries the intent from Step 1, the current picture you already hold for that scope, and the scope itself in grid terms; ask it to plan that scope by this workflow and to end with the path of the plan it wrote. Plan mode is the top-level `planMode: true`, not a `payload` key, and a child does not inherit yours; give it no `planPath`: it writes a plan of its own, and its summary names that plan's path. **Cut along module boundaries**, so that a module is planned whole by one thread. A change to a layer file or to `<index>` that several scopes depend on stays in your own plan and is decided first — the children are told its outcome, not asked to reach it. Your plan then lists the child plans in execution order instead of repeating their entries.

---

<!-- include: parts/placement.md -->

<!-- include: parts/domain-test.md -->

<!-- include: parts/module-vs-layer.md -->

<!-- include: parts/reading-sweep.md -->
