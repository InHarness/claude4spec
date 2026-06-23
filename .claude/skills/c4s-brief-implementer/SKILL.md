---
name: c4s-brief-implementer
description: Implement features described in claude4spec briefs (markdown files in .claude4spec/briefs/). Briefs are self-contained — they include all context needed for implementation (entity snapshots, section diffs, narrative). After implementation, if you discover drift between the brief and reality (missing details, incorrect assumptions, edge cases not covered), generate a patch file in .claude4spec/patches/ as feedback for the specification author. Use when implementing changes in a code repository that has a .claude4spec/briefs/ directory.
---

# c4s-brief-implementer

This skill describes how to implement a release brief in **your code repository**
(not the spec repo). A brief is a self-contained markdown file under
`.claude4spec/briefs/` that captures everything you need to ship the change:
entity snapshots, section diffs, narrative, acceptance criteria.

Briefs are self-contained, so you do **not** need the `c4s` CLI installed, and
you do **not** read the main specification or query the entity database. If a
brief references something you cannot find in its body, treat that as drift and
file a patch (step 6).

## Workflow

### 1. Discover

```sh
ls .claude4spec/briefs/        # list available briefs
cat .claude4spec/briefs/<slug>.md
```

If `.claude4spec/` is not in your current directory, walk up the directory tree
until you find it (like git finds `.git/`).

### 2. Read the brief

Every brief has YAML frontmatter:

```yaml
---
type: brief
from_release: v0.1.16
to_release: v0.1.17
generator_version: brief-author@0.1
implemented: false
---
```

The body has everything you need — entity snapshots, section diffs, narrative,
and acceptance criteria.

If the brief is unclear (missing detail, ambiguous wording, a decision you'd
otherwise guess), you have two paths:

**Synchronous (preferred when available).** Ask the spec agent and continue once
you have an answer. The CLAUDE 4 SPEC spec lives at `.claude/skills/specyfikacja`
(a symlink), not at the repo root — always point to it with `--project`; do
**not** `cd` into it, or `c4s` reports `PROJECT_NOT_FOUND`.

```bash
c4s ask "Brief doesn't specify X — is it A or B?" --ct brief --brief <brief-slug>.md --project .claude/skills/specyfikacja
```

Continue the same thread with `c4s ask "..." --thread <threadId>` (the
`threadId` is printed with the answer). This requires `c4s` installed *and* a
running `npx claude4spec` server; skip it when either is unavailable.

**Asynchronous (always available).** If you cannot ask synchronously, proceed
with your best judgement and file a patch afterwards (step 6) so the spec-author
can fold the clarification into the next brief.

### 3. Isolate work (worktree + fresh branch)

Never implement a brief on top of your current checkout. Branch from a **fresh
`main`** and work in a dedicated git worktree under **`./.worktrees/<brief-slug>`**
(that directory is git-ignored, so the nested checkout never shows up in the
main repo's `git status`):

```bash
git fetch origin
git worktree add .worktrees/<brief-slug> -b brief/<brief-slug> origin/main
cd .worktrees/<brief-slug>
```

- Branch name `brief/<brief-slug>` mirrors the repo's `feat/…` convention.
- If `origin` is not configured, branch from local `main`: `git checkout main &&
  git pull`, then `git worktree add .worktrees/<brief-slug> -b brief/<brief-slug> main`.

### 4. Implement

Standard code flow: read existing code, plan, edit, test. Stay focused on what
the brief specifies. Commit your work on the `brief/<brief-slug>` branch.

### 5. Smoke-test locally

Before opening the PR, launch the app and exercise the change — don't hand off on
green unit tests alone.

```bash
# Run the CLI via `npx tsx` (NOT `npm run dev:sandbox`, which uses `tsx watch`).
# In a worktree whose node_modules symlinks OUTSIDE the worktree, `tsx watch`
# follows the symlink, sees Vite's .vite-temp/*.timestamp churn, and restarts in
# an infinite loop. Plain `npx tsx` (no watch) avoids it.
npx tsx src/bin/claude4spec.ts --mode dev --cwd .claude/skills/specyfikacja --pages . --port 5555
```

- **Port 5555 is our test convention.** If it's taken (`EADDRINUSE`), increment —
  `--port 5556`, `5557`, … — until one is free.
- Open the printed URL, verify the brief's behaviour, then stop the server
  (Ctrl-C). If the smoke test reveals drift, file a patch (step 6).

### 6. Feedback loop (patches)

When the brief diverges from reality — a missing detail, an incorrect assumption,
an edge case not covered, or anything else the spec-author should know — write a
patch file `.claude4spec/patches/<brief-slug>-<short-desc>.md`:

```markdown
---
type: patch
brief: v0-1-16-to-v0-1-17.md      # path relative to briefs/
patch_kind: drift
created_at: 2026-05-11T17:32:00Z
created_by: claude-code            # or "cursor", "aider", ...
---

# Patch — short title

## What I found

…description of the drift / missing detail / incorrect assumption…

## Suggestion

…what the spec-author should consider in a follow-up brief or entity edits…
```

`patch_kind` values:

- `drift` — the brief described behavior X, but the codebase already does Y.
- `missing` — the brief is silent on a detail you had to decide yourself.
- `incorrect` — the brief is factually wrong about existing code.
- `clarification` — the brief is ambiguous; you guessed but it should be made
  explicit next time.

Create `.claude4spec/patches/` lazily — only when you file your first patch
(`mkdir -p .claude4spec/patches`). The claude4spec server does NOT create it.

### 7. Open a draft PR and STOP

Push the branch and open a **draft** PR against `main`, then hand off:

```bash
git push -u origin brief/<brief-slug>
gh pr create --draft --base main \
  --title "<brief-slug>: <short title>" \
  --body "Implements brief .claude4spec/briefs/<brief-slug>.md

<one-paragraph summary of what changed + how it was tested>"
```

**Do NOT run `gh pr merge`.** Review and merge are the human's call. Stop here and
report the PR URL.

### 8. Mark brief as implemented

`implemented: true` is a **declaration**, set ONLY after the draft PR is reviewed
and merged to main (or otherwise accepted) — never at PR-open time, never
proactively, and a later revert on main does NOT roll it back. When implementation
is genuinely done (code merged, tests green), flip the frontmatter:

```bash
# Option A — Edit tool: change `implemented: false` → `implemented: true`.
# Option B — yq (idempotent; adds the field to legacy briefs that lack it):
yq -i '.implemented = true' .claude4spec/briefs/<brief-slug>.md
```

### 9. Hand-off

The spec-author reads patches manually (`ls .claude4spec/patches/`, `cat`) and
folds them into the next brief or entity edits. There is no UI listing in this
release — patches are raw markdown.

## Notes

This is a **base skill** generated by claude4spec, customized for this project.
The base copy covers reading briefs and asking the c4s agent questions; this copy
under `.claude/skills/` additionally pins our git/PR flow (worktree → fresh branch
→ draft PR → stop). It is **yours to edit** — nothing overwrites it. (The
`.claude4spec/skills/` copy *is* refreshed on server start; this one is not.)
