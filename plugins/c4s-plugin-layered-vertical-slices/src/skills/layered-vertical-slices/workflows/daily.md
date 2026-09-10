# Daily workflow (existing spec)

Use this when **the `<index>` file already exists in the CWD** — the spec is in place and the user is feeding ideas, problems, or explicit edits into it. For greenfield bootstrap, see `workflows/bootstrap.md`.

This is the mode you spend most hours in. The user almost never speaks in spec-language — they speak in *intent* ("what if endpoints could be versioned?"), in *complaint* ("this auth flow feels off"), or in concrete edits ("add a `retries` column to M03"). Your job is to translate, locate, and edit — within the rules carried at the end of this file.

**Default to small, focused changes.** If a single user message implies a sweep across many files, propose splitting it before you touch anything.

## Step 0 — Hear the user (always run this first)

Before reading the spec, before classifying, before locating files: restate the user's *intent* in their own terms — what they're trying to enable, for whom, why now. Do this **even when the user thinks they're filing an explicit edit** ("add column X"). Edits without grounded intent become entries in the spec that no one — human or code-gen agent — can later interpret.

Output a 2–3 line restatement and ask one targeted clarification if anything is murky. Format:

> *"Read as: you want endpoint authors to be able to express retry policy per-endpoint, because the current spec forces retry logic into shared middleware. Confirm? (Or is the goal narrower — just a `retries` count column without the policy framing?)"*

Only after the user confirms (or after you've read enough of the existing spec to confidently restate without asking) move to Step 1.

If the user is in **explicit-change mode** (Mode A in Step 2), the restatement is one line — but still mandatory: the cost of one line of confirmation is tiny, the cost of a column whose purpose dissolves in three months is real.

This step is also the place to push back: if you cannot construct a coherent user-need behind the request — architectural taste, speculative cleanup with no user-visible improvement — say so plainly and ask. A translator can refuse to translate noise.

## Step 1 — Orient

Read `<index>`. Skim the layer table and module table. Read any module or layer the user mentions, plus the file that you suspect will need editing. Do not propose a change until you've read the file you'd be changing — never rely on memory or on a previous session's context.

If the user references a relation between modules (e.g. "the link between Endpoint and DTO"), read both module files.

## Step 2 — Classify what the user is asking

Decide explicitly which mode the user is in. State the mode out loud if it isn't obvious; this gives the user a chance to correct.

- **Mode A — explicit change.** *"Add column `retries` to M03."* / *"Rename L4 from 'Library API' to 'SDK'."* The location and shape of the change are stated. → Skip to Step 4.
- **Mode B — idea / problem / vague concern.** *"What if endpoints could be versioned?"* / *"This auth flow feels off."* / *"We should track who edited what."* The user has intent, not an edit. → Go to Step 3.
- **Mode C — bug / inconsistency report.** *"M04 says X but L1 says Y."* / *"This module is missing a layer it clearly touches."* / *"`<index>` lists M07 but the file isn't there."* → Treat like Mode A but read both sides of the inconsistency before proposing a fix.

If you cannot decide between A and B in one read, ask the user a single short clarification.

## Step 3 — Translate (only Mode B)

Map the idea or problem onto the specification grid. State your mapping out loud and ask for confirmation before editing.

Routing needs the whole grid in view, and reading module files one by one to get it is how this step turns into a survey. Run the **cross-cutting reading protocol** (carried at the end of this file) instead: two calls give you every module's `Cel`, which is exactly the altitude at which "which module owns this?" is decided. Its silent failure mode is yours to remember here — a module whose section is not named `## Cel` is absent from the result with no warning, so check the sweep's count against `<index>`'s module table before concluding that no module owns the change. A short count has two causes that look identical — a renamed heading, or a first page you never paged past — so read `hasMore` before you go looking for the rename.

The candidate buckets:

- **New module.** The user introduces a new entity or feature. Propose a module number (next free), a slug, and which layers it touches.
- **Change to an existing module.** New column, new operation, new edge case, new acceptance criterion, new dependency. Before you place the content, ask the residual question **first — does any layer of this project ask for it?** A sentence answering a field of some layer's `## Module slice schema` belongs in that layer's section; only what no layer asks about is a candidate for the module's `## Domain` (its rules are carried at the end of this file).
- **Layer-level change.** A new convention, a new pattern, or a contract change that affects multiple modules. Apply the layer-purity test (rule 2) *before* placing anything in a layer: if the candidate paragraph stops being true once you imagine any single module gone, it is not a layer change.
- **Cross-module relation.** A new dependency between two existing modules. It is a **dependency record** (rule 3a), not a row in either file — one per direction, so a mutual relation is two. `<index>`'s relations diagram may still need updating.
- **Not a spec change at all.** Implementation detail, UX micro-decision, code style, choice of internal helper. Say so plainly and stop. The spec is for architecture; not every interesting thought belongs in it.
- **Not yet decided.** The idea is real but unresolved. Add it to `<index>`'s `Open questions` section verbatim instead of editing modules. Move it out of `Open questions` later when the user resolves it.

Present your translation as 2–4 lines and wait for confirmation. Always thread the user-need from Step 0 through the translation — the architectural mapping is *in service of* the intent, not parallel to it:

> *"I read this as: change to M03 (new column `retries: int`), plus a new edge case (retry exhaustion). Motivated by the intent from Step 0 — endpoint authors expressing retry behavior per-endpoint. No layer change needed — retry counts are per-endpoint, not a cross-cutting concern. Confirm?"*

## Step 4 — Edit

Make the focused change to the relevant file(s). The rules at the end of this file bind here: the placement rules (2, 2a, 3, 3a, 9) decide where content goes, the authoring rules (1, 4–8) what the file must then satisfy. Two that bite most often in an edit: a module-side section follows the schema in its layer's `## Module slice schema`, and content relocated between files keeps its anchor and leaves no breadcrumb behind (rule 9). A file the edit pushes past its budget is split per rule 5 — propose it, do not do it silently.

## Step 5 — Drift check

After non-trivial edits, walk the check list — every mechanically decidable symptom of the rules this file carries — against `<index>` and the files on disk:

<!-- include: checks -->

If you find drift, surface it as a short punch list and ask the user before fixing — drift can be intentional (work-in-progress).

## Step 6 — Style review (always, before you report)

Delegate the saved change to the **`spec-review`** subagent and wait for its answer — hand it the files and addresses you touched in Step 4, nothing else: it reads the rules itself and fetches the change itself. This step is not conditional and not the user's to ask for; a reviewer you call only when you doubt yourself reviews nothing that needed reviewing.

Its answer comes back in exactly one of five shapes; the set is closed and the shapes are mutually exclusive: **deviations** (carry each into Step 7 with its address), **no deviations**, **no input / empty delta** (report it as that, never as a clean review), **partial review** (say which part went unreviewed), or **an empty return** — no text block at all — meaning its turn budget ran out. Report the last as **"review not performed — turn budget exhausted"**, naming the scope you handed over: neither a clean review nor a crash. Do **not** re-run it on the same scope — the second run exhausts the same way; hand it a narrower scope or leave the gap stated.

A read-only turn saved nothing, so it does not reach this step and `spec-review` is not mounted in it; answer the question and stop. Do not fix what the reviewer reports on your own initiative — a deviation is a finding for Step 7, and acting on it is the user's call, exactly as with the drift punch list in Step 5.

## Step 7 — Stop

State what changed, point to the file(s), relay the reviewer's verdict from Step 6, and stop. Do not auto-loop into "what else can we improve?" — wait for the user. The user drives the next round.

---

<!-- include: parts/placement.md -->

<!-- include: parts/authoring.md -->

<!-- include: parts/domain.md -->

<!-- include: parts/reading-sweep.md -->

<!-- include: parts/reading-deps.md -->
