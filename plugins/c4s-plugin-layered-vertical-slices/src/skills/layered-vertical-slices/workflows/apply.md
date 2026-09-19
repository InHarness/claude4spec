# Apply workflow (changing the spec)

Use this when the turn changes the specification: an approved plan to execute, or an edit whose place is already stated (*"add column `retries` to M03"*). In a thread that has not run `workflows/read.md`, run it first — a fresh thread executing someone else's plan knows nothing about the pages it is about to edit.

## Step 1 — Take the plan as settled

The intent and the placement were decided in planning and approved by the user: do not reopen them. What you check is that the plan still meets reality — every address resolves, every target section is what the plan says it is. **A mismatch is a stop, not a detour:** an address that no longer resolves, a schema asking for a field the plan never anticipated, an entry that would give a fact a second home → report it and leave re-planning to the user. A plan quietly improved during execution is a plan nobody approved.

An edit with no plan behind it gets **one line** of restated intent before you touch anything — the cost of one line is tiny, the cost of a column whose purpose dissolves in three months is real. If its stated place looks wrong to you — a module's fact headed into a layer file, a second list of something — that is a placement question: go through `workflows/plan.md`.

## Step 2 — Edit, entry by entry

Read the target section immediately before you change it — never from memory, never from the plan's paraphrase. For a layer section, re-read that layer's `## Module slice schema` and **fill it literally**: its headings, its fields, its form. The plan names the fields; the text you write answers them.

A new file starts from its template — `templates/module.md`, `templates/layer.md`, `templates/index.md`: copy it and replace placeholders only. Content relocated between files keeps its anchor and leaves no breadcrumb behind (rule 9). A module file one layer slice has come to dominate is split per rule 5 — propose it, do not do it silently.

## Step 3 — Drift check

After non-trivial edits, walk the check list — every mechanically decidable symptom of the style's rules — against `<index>` and the pages you touched:

<!-- include: checks -->

Surface drift as a short punch list and ask before fixing — drift can be intentional (work in progress).

## Step 4 — Style review (always)

Delegate the saved change to the **`spec-review`** subagent and wait for its answer — hand it the files and addresses you touched, nothing else: it reads the rules itself and fetches the change itself. This step is not conditional and not the user's to ask for; a reviewer you call only when you doubt yourself reviews nothing that needed reviewing.

Its answer comes back in exactly one of five shapes; the set is closed and the shapes are mutually exclusive: **deviations**, **no deviations**, **no input / empty delta** (report it as that, never as a clean review), **partial review** (say which part went unreviewed), or **an empty return** — no text block at all — meaning its turn budget ran out. Report the last as **"review not performed — turn budget exhausted"**, naming the scope you handed over. Do **not** re-run it on the same scope — the second run exhausts the same way; hand it a narrower scope or leave the gap stated.

Do not fix what the reviewer reports on your own initiative: a deviation is a finding, and acting on it is the user's call.

## Step 5 — Close

In this order:

1. **Mark the plan applied** — when a plan was executed and every entry is done. An entry you stopped on or declined means the plan is not applied: say which, and leave the flag alone.
2. **Report** what changed, by address; the reviewer's verdict, in the shape it came in; what you did not do, and why.
3. **Follow-ups** — a list under that name, apart from the report: the plan's *Seen, not planned* entries; drift from Step 3 left for the user; the reviewer's deviations, pre-existing ones included; places you met while editing that carry the same problem this change fixed. One line each, with an address. A follow-up is an offer — do not start one.
4. **Propose a release** — say the change is ready to be released and what the release would carry. Proposing is the whole step: a release is cut on the user's word.

Then stop. Do not loop into "what else can we improve?" — the user drives the next round.

## A plan too large for one thread

Execute it through children **in series**: `runTransagent`, a `chat` child attached to **this same plan**, whose message names the entries it executes and says — apply those entries only, by Steps 1–4 of this workflow; do not mark the plan applied and do not propose a release; end with what changed by address, the reviewer's verdict, and follow-ups. The binding to the plan is `payload.planPath`, set to the path `<current_plan>` carries (or `get_plan` returns). Leave `planMode` unset: these children write. Order the children as the plan orders its entries. Each child rebuilds its own context from nothing, and that overhead is the price: pay it for a plan that would not fit in one thread, not for one that would. After the last child, Step 5 is yours, over the summaries you collected.

---

<!-- include: parts/authoring.md -->

<!-- include: parts/domain-form.md -->
