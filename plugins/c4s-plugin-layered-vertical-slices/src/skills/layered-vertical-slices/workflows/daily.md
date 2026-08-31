# Daily workflow (existing spec)

Use this when **the `<index>` file already exists in the CWD** — the spec is in place and the user is feeding ideas, problems, or explicit edits into it. For greenfield bootstrap, see `workflows/bootstrap.md`.

This is the mode you spend most hours in. The user almost never speaks in spec-language — they speak in *intent* ("what if endpoints could be versioned?"), in *complaint* ("this auth flow feels off"), or in concrete edits ("add a `retries` column to M03"). Your job is to translate, locate, and edit — without breaking the rules in SKILL.md §6.

**Default to small, focused changes.** If a single user message implies a sweep across many files, propose splitting it before you touch anything.

## Step 0 — Hear the user (always run this first)

Before reading the spec, before classifying, before locating files: restate the user's *intent* in their own terms — what they're trying to enable, for whom, why now. Do this **even when the user thinks they're filing an explicit edit** ("add column X"). Edits without grounded intent become entries in the spec that no one — human or code-gen agent — can later interpret.

Output a 2–3 line restatement and ask one targeted clarification if anything is murky. Format:

> *"Read as: you want endpoint authors to be able to express retry policy per-endpoint, because the current spec forces retry logic into shared middleware. Confirm? (Or is the goal narrower — just a `retries` count column without the policy framing?)"*

Only after the user confirms (or after you've read enough of the existing spec to confidently restate without asking) move to Step 1.

If the user is in **explicit-change mode** (Mode A in Step 2), the restatement is shorter — one line — but still mandatory. Routine edits still benefit from verifying the *why*; tautological "yes please add the column" is the cheap case, not a reason to skip. The cost of one extra line of confirmation is tiny; the cost of writing a column whose purpose dissolves in three months is real.

This step is also the place to push back: if you cannot construct a coherent user-need behind the request — if the request reads as architectural taste or speculative cleanup with no user-visible improvement — say so plainly and ask. The skill is not a stenographer; it's a translator, and a translator can refuse to translate noise.

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

Map the idea or problem onto the specification grid. State your mapping out loud and ask for confirmation before editing. The candidate buckets:

- **New module.** The user introduces a new entity or feature. Propose a module number (next free), a slug, and which layers it touches.
- **Change to an existing module.** New column, new operation, new edge case, new acceptance criterion, new dependency.
- **Layer-level change.** A new convention, a new pattern, or a contract change that affects multiple modules. Apply the layer-purity rule (SKILL.md §6) *before* placing anything in a layer: if the candidate paragraph stops being true once you imagine any single module gone, it is not a layer change.
- **Cross-module relation.** A new dependency between two existing modules. The change goes in *both* module files' `Dependencies` tables and possibly in `<index>`'s relations diagram.
- **Not a spec change at all.** Implementation detail, UX micro-decision, code style, choice of internal helper. Say so plainly and stop. The spec is for architecture; not every interesting thought belongs in it.
- **Not yet decided.** The idea is real but unresolved. Add it to `<index>`'s `Open questions` section verbatim instead of editing modules. Move it out of `Open questions` later when the user resolves it.

Present your translation as 2–4 lines and wait for confirmation. Always thread the user-need from Step 0 through the translation — the architectural mapping is *in service of* the intent, not parallel to it:

> *"I read this as: change to M03 (new column `retries: int`), plus a new edge case (retry exhaustion). Motivated by the intent from Step 0 — endpoint authors expressing retry behavior per-endpoint. No layer change needed — retry counts are per-endpoint, not a cross-cutting concern. Confirm?"*

## Step 4 — Edit

Make the focused change to the relevant file(s). Apply *all* of SKILL.md §6, especially:
- Module-specific details stay in the module, not in the layer (layer-purity rule).
- Each module-side section follows the schema declared in its layer's `## Module slice schema`.
- The module lists every layer it actually touches.
- When you relocate content between files (module → module, section → layer, sub-layer split-out), preserve the anchor and just move the content. Do **not** leave a "moved to MXX" line in the source file.

If the change makes a module file head past ~250 lines, propose splitting it: convert `modules/MXX-<slug>.md` into `modules/MXX-<slug>/`, keep the module's own substance in `MXX-<slug>.md`, and move the dominant layer slice to `LY-<slug>.md` (filename matches `layers/LY-<slug>.md`).

## Step 5 — Drift check

After non-trivial edits, scan `<index>` against files-on-disk:

- Every entry in the module table has a file? Every module file has a row?
- Every layer touched by any module appears in the layer table?
- Every relation declared in a module's `Dependencies` table appears in the index's relations diagram?
- If something was removed, is it marked retired rather than silently deleted?

If you find drift, surface it as a short punch list and ask the user before fixing — drift can be intentional (work-in-progress).

## Step 6 — Stop

State what changed, point to the file(s), and stop. Do not auto-loop into "what else can we improve?" — wait for the user. The user drives the next round.
