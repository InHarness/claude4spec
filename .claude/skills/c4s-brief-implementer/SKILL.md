---
name: c4s-brief-implementer
description: Implement features described in claude4spec briefs. Briefs are self-contained markdown files (entity snapshots, section diffs, narrative) that live in the companion specification repository, reached from your code repo via the c4s CLI (c4s list-briefs / read-brief, with --project and --workspace baked in). After implementation, if you discover drift between the brief and reality (missing details, incorrect assumptions, edge cases not covered), file a patch via c4s file-patch as feedback for the specification author. Use when implementing a claude4spec brief in a code repository.
---

# c4s-brief-implementer

This skill describes how to implement a release brief in **your code repository** (not the spec repo). A brief is a self-contained markdown file that captures everything you need to ship the change: entity snapshots, section diffs, narrative, acceptance criteria. Briefs live in the **spec** repository, a different repo from the one you are working in — you never touch it directly; the `c4s` CLI reaches everything for you.

**Reaching the briefs.** This skill is **CLI-only**: it reaches the briefs and writes patches solely through the `c4s` CLI, with the spec project's identity baked into this skill (`--project 'app-spec' --workspace 'default'`) — `c4s list-briefs` / `c4s read-brief` / `c4s file-patch` work from any directory, without a running server (they are filesystem-scoped). If `c4s` is not installed, **stop** and ask the user to install it — do not read or write the spec repo's files by hand.

**The brief is self-contained.** You do not need to read the main specification or query the entity database — everything is in the brief body. If the brief references something you cannot find in its body, treat that as drift and file a patch (step 4 below).

**Don't conflate the claude4spec server with the env-runner sandbox.** The **claude4spec server** is one always-on local process hosting every registered spec project, including `app-spec` (this brief) and `env-runner`; it is never created or destroyed as part of a brief's workflow. `c4s agent`/`c4s ask` calls in this skill (the optional spec-check in step 2, the env-runner order in step 5) and `c4s mark-brief-implemented` (step 9) all talk to it — `c4s read-brief`/`list-briefs`/`file-patch` do not (see filesystem-scoped note above). The **env-runner sandbox** is a different thing entirely: an ephemeral, per-brief Docker environment that `env-runner`'s operator agent stands up on order (step 5) and tears down on request (step 8) — its mechanics live in the shared **`c4s-env-runner` skill**, not in this file. The operator only manages that sandbox's lifecycle per your order text — it does not run tests and knows nothing about your branch, PR, or the brief's `implemented` status beyond what you put in the order. **You** exercise the change at the URL it hands back; marking the brief `implemented: true` (step 9) is a separate `app-spec` call that has nothing to do with env-runner.

## Workflow

### 1. Discover

List the briefs through `c4s` (paginated — briefs accumulate over time, so filter and page rather than dumping everything):

```sh
c4s list-briefs --status pending --limit 10 --project 'app-spec' --workspace 'default'
```

`--status pending` hides briefs already marked `implemented: true`; drop it to see all. Use `--offset` to page. Output lists each brief's `path` (which you pass to `read-brief`) and whether it is already implemented.

**Which brief do I implement?** If the user named a brief, use it. If not — and `list-briefs` returns more than one pending brief — **ask the user which one**; do NOT guess. Picking the wrong brief wastes an implementation pass. Only proceed automatically when there is exactly one obvious candidate (a single pending brief, or the user pointed at one).

### 2. Read the brief as self-contained input

Read the full brief by the `path` printed by `list-briefs`:

```sh
c4s read-brief <brief-path> --project 'app-spec' --workspace 'default'
```

The body contains everything you need — entity snapshots, section diffs, the narrative of what changes, and acceptance criteria. Read it and implement it; you do not need to understand how the brief was produced. **Do not read the main specification.**

If the brief is unclear — a missing detail, an ambiguous wording, a decision you'd otherwise have to guess — **never ask the user an open content question about it.** Check the spec first, always, whenever the channel below is available; the user only ever gets a non-blocking FYI notice after the fact, never a question to answer.

**1. Check the spec (mandatory first attempt when available).** Ask the specification agent in the same terminal and continue once you have an answer. Two distinct commands, by what context you need.

Preferred — context of THIS brief plus its release diff (the agent sees only the change window of the brief you are implementing):

```bash
c4s agent "Brief nie precyzuje X — czy chodzi o A czy B?" --ct brief --brief <brief-path> --project 'app-spec' --workspace 'default'
```

Alternative — read-only peer-consult of the CURRENT spec state (may be ahead of the brief you are implementing); no brief context, no `--ct`/`--brief`:

```bash
c4s ask "Jak dziala Y w aktualnej specce?" --project 'app-spec' --workspace 'default'
```

Continue the brief thread with `c4s agent "..." --thread <threadId> --project 'app-spec' --workspace 'default'` (the `threadId` is printed with the answer). This path requires `c4s` installed *and* a running `npx @inharness-ai/claude4spec` server. Only skip it when one of those is genuinely unavailable.

**2. Fall back to best judgment (self-contained — still not a question to the user).** When the spec channel is unavailable, proceed with your best judgement and file a patch afterwards (step 6) so the spec-author can fold the clarification into the next brief. Do not ask the user instead — this path resolves the ambiguity on its own.

**3. Surface the resolution, don't ask it.** Once resolved — whether the spec answered it or you used best judgment — state the resolution to the user as a one-line FYI while you keep working, e.g. "Brief doesn't specify X — spec says Y, proceeding with that" or "Brief doesn't specify X — no spec answer available, proceeding with Y, will file a patch." This never blocks on a reply.

### 3. Isolate work (worktree + fresh branch)

Never implement a brief on top of your current checkout. Branch from a **fresh `main`** and work in a dedicated git worktree.

The `path` printed by `list-briefs`/`read-brief` is not branch-safe as-is — it always carries the `.md` extension and may contain `/` subdirectory segments. Derive a slug first:

```bash
brief_slug=$(echo "<brief-path>" | sed 's/\.md$//; s|/|-|g')
git fetch origin
git worktree add ".worktrees/$brief_slug" -b "brief/$brief_slug" origin/main
cd ".worktrees/$brief_slug"
```

- Branch name `brief/<slug>` mirrors the repo's `feat/…` convention. `.worktrees/` is git-ignored, so the nested checkout never shows up in the main repo's `git status`.
- If `origin` is not configured, branch from local `main` instead: `git checkout main && git pull`, then `git worktree add ".worktrees/$brief_slug" -b "brief/$brief_slug" main`.
- No local copy of the spec is needed here — `c4s` reaches it remotely via `--project`/`--workspace` from any cwd (see step 2), so a fresh worktree works out of the box.

### 4. Implement

Standard code flow in your target repository: read existing code, plan, edit, test. Stay focused on what the brief specifies. Commit your work on the `brief/<slug>` branch.

### 4a. Stage `package.json` version from the brief's target release

The brief frontmatter carries `to_release` — the **target release name**. Read it from the brief body (it is the YAML block at the very top of `c4s read-brief <brief-path> …`, alongside `from_release`, `type`, `implemented`). Use it to stage this repo's version:

- **Valid semver** (e.g. `to_release: 0.1.128`) → write it into the `"version"` field of this repo's `package.json` and commit it on the `brief/<slug>` branch as part of the implementation. Do **not** run `npm version` (it creates a commit and a tag) — edit the `"version": "…"` line directly.
- This is a **staging write only.** `release-process` remains the authority on the published version and may override this value at publish time — so a divergence between this staged version and the latest git tag is expected and gets resolved there, not here. Note that `to_release` is a free-form release *name*, not guaranteed to match npm/git-tag semver.

**If `to_release` can't be turned into a version unambiguously — do NOT guess.** This covers:

- `to_release` is `null` or absent — an analysis / "to-next" brief (state relative to HEAD, no fixed target release);
- its value is a free-form label that isn't valid semver (release names are opaque strings, e.g. `v2`, `current`);
- it conflicts with the current `package.json` version in a way you can't resolve.

In each of these cases, ask the user via **AskUserQuestion** whether to set the version (and to what value) or to leave the current `package.json` version as-is. Never invent a number.

### 5. Smoke-test via env-runner

Before opening the PR, launch and exercise the change end-to-end — don't hand off on green unit tests alone. Never run Docker yourself.

**Read the `c4s-env-runner` skill and follow it.** It owns everything about ordering an environment; nothing of that is repeated here.

Push the branch first — the environment is built from it:

```bash
git push -u origin "brief/$brief_slug"
```

Then order an environment named `$brief_slug`, built from that branch, whose purpose is a smoke-test of this branch. Don't put the brief's file path or name in the order — env-runner knows nothing about briefs.

The operator only stands the environment up; **you** exercise the change at the URL it returns. Report the env name, URL and `threadId` to the user, and leave it running.

If the smoke test reveals drift, file a patch (step 6).

**If the environment never comes up, do not shrug it off and continue to the PR** — go to step 6a, which is a hard stop. A change you could not run is not a change you can hand off. This includes the case where the failure has nothing to do with your branch.

### 5b. Exercise it in a real browser, not just with `curl`

"Exercise the change" in step 5 means a **browser**. A green `curl` proves the server answered; it does not prove the page rendered, and it cannot see what the page logs. Run the repo's committed e2e suite against the URL env-runner returned:

```bash
C4S_E2E_BASE_URL=<url> npm run test:e2e     # whole suite
npm run test:e2e -- -t 'purge'              # one case, by name or [ac:<slug>] marker
```

The suite skips itself when `C4S_E2E_BASE_URL` is unset, and is excluded from `npm test`, so it never runs against nothing.

For behavior specific to THIS brief that no committed test covers yet, write a throwaway Playwright script in the scratchpad (`playwright` is a devDependency, browsers are cached — `chromium.launch()` is headless; pass `{ headless: false }` only when the user asks to watch). In every such script:

- **Always assert zero console errors and zero responses with status ≥ 400.** This is the highest-value assertion in the whole step — it is what caught two 404s on a page that `curl` reported as a clean `200`.
- Save screenshots to the scratchpad and give the user the paths.
- Assert on rendered content (a heading, a list row), not just on the final URL — a white SPA shell also returns 200.

If a brief's behavior is worth keeping honest over time, don't leave it in the scratchpad: add it to `tests/e2e/` as `it('[ac:<slug>] …')`. That marker is the repo's traceability contract (see the `ac-test-implementer` skill) and `npm run test:ac-coverage` counts it with no further wiring. Browser-driven cases can also retire entries from `tests/ac-skiplist.json` whose stated reason is "UI-only / not automatable in Vitest" — that reason stops being true once the test exists.

### 6. Feedback loop (patches)

When you discover that the brief diverges from reality — a missing detail, an incorrect assumption, an edge case not covered, or anything else the spec-author should know — file a patch. Use `c4s file-patch`, which records the patch on the spec side for you:

```sh
printf '%s\n' "$PATCH_BODY" | c4s file-patch \
  --brief <brief-path> --desc "<short-desc>" --kind drift \
  --project 'app-spec' --workspace 'default'
```

The body (from stdin, or `--body-file <f>`) goes below an auto-generated `# Patch — <short-desc>` heading. Structure the body as two sections: a `## What I found` section (the drift / missing detail / incorrect assumption) and a `## Suggestion` section (what the spec-author should consider in a follow-up brief or entity edits). `c4s file-patch` records all the metadata for you (which brief it relates to, the kind from `--kind`, defaulting to `drift`) — you only write the markdown body.

`--kind` values:

- `drift` — the brief described behavior X, but the codebase already does Y.
- `missing` — the brief is silent on a detail you had to decide yourself.
- `incorrect` — the brief is factually wrong about existing code.
- `clarification` — the brief is ambiguous; you guessed but it should be made explicit for next time.

### 6a. HARD GATE — a failed smoke test blocks the PR and escalates

**This gate runs BEFORE you open a PR, and it overrides the "always hand off a draft PR" flow below.** Green unit tests are not a substitute: they exercise the code, not the shipped artifact.

Classify the step-5 outcome honestly:

- **The environment came up and you exercised the change** → proceed to step 7 normally.
- **The environment never came up** — the build failed, `npm ci`/install failed, the app can't start, the image won't produce a running container → **STOP. Do NOT open a PR.** Escalate to the user directly, as the headline of your reply, in these words or equivalent: *"BLOCKER: the app cannot be installed/started — I did not open a PR."* Then give the literal error, say whether it comes from your branch or pre-exists on `main` (check: `git diff origin/main...HEAD -- package.json package-lock.json`), and ask how to proceed. Nothing about this is a footnote.
- **The environment came up but the change misbehaves** → that's a normal bug; fix it and re-test, don't escalate.

**Never** report an install/start failure as a bullet inside a longer summary, under a heading like "worth noting", or after a list of green results. A reader skimming for the outcome must hit it first, or they will merge something that does not run. If you already opened the PR when the failure surfaced, immediately mark it: `gh pr edit <n> --title "[DO NOT MERGE — app cannot be installed] <original title>"`, keep it a draft, and put the blocker at the very top of the PR body.

**Why this rule exists:** on brief `0-1-133-to-0-1-134` the app could not be `npm ci`-installed at all (a pre-existing ERESOLVE on `main` broke every env-runner build, on every branch). That was reported as an ⚠️ bullet mid-report under "worth your attention" — and the user came within a step of merging before having to ask what was actually going on. A merge-blocking fact stated calmly in the middle of good news reads as noise.

**Corollary — a pre-existing blocker is still a blocker.** "Not caused by my branch" explains it; it does not downgrade it. If `main` itself cannot be installed, say so loudly: it means nobody's smoke test works, which is worse than a bug in your diff, not better.

### 7. Open a draft PR and STOP

The branch was already pushed in step 5; push again only if step 6 or later added commits (no-op otherwise). Then open a **draft** PR against `main` and hand off:

```bash
git push -u origin "brief/$brief_slug"   # no-op if nothing changed since step 5
gh pr create --draft --base main \
  --title "$brief_slug: <short title>" \
  --body "Implements brief <brief-path> — see: c4s read-brief <brief-path> --project 'app-spec' --workspace 'default'

<one-paragraph summary of what changed + how it was tested>"
```

**Do NOT run `gh pr merge`.** Review and merge are the human's call. Stop here and report the PR URL.

### 8. After the user confirms the PR is merged: clean up

Only do this once the user explicitly tells you the PR is merged (or asks you to merge it yourself) — never proactively. Then, from the **primary repo checkout** (not the worktree, since it has the target branch, e.g. `main`, checked out and `git worktree remove`/branch deletion must run from outside the worktree being removed):

First, tear down the environment you left running for this brief's smoke-test (step 5) — per the `c4s-env-runner` skill, in the same thread. Nothing to clean up in local Docker. Then clean up the git side:

```bash
git fetch origin
git checkout main && git pull origin main   # or the repo's actual base branch
git worktree remove ".worktrees/$brief_slug"
git branch -d "brief/$brief_slug"                          # local branch
git push origin --delete "brief/$brief_slug" 2>/dev/null    # remote, if `gh pr merge --delete-branch` didn't already
```

Once local `main` is refreshed with the merged change, rebuild so the local `dist/` matches the new `main`:

```bash
npm run build
```

This keeps the local checkout's compiled output in sync with the code you just merged (stale `dist/` is a known trap — see [[c4s-cli-stale-dist]]). Report the build result to the user; if it fails, surface the error rather than treating cleanup as done.

If you merge the PR yourself (`gh pr merge --draft` PRs need `gh pr ready` first), pass `--delete-branch` — but still verify locally afterward: `gh pr merge` run from inside the worktree can fail the local branch-delete/checkout step (base branch is checked out elsewhere), so don't assume it fully succeeded without checking (`git ls-remote --heads origin "brief/$brief_slug"` should come back empty).

If the `envr destroy` request above didn't go through for some reason, follow up in the same thread rather than tearing anything down locally.

### 9. Mark brief as implemented

`implemented: true` is a **declaration**, set ONLY after the draft PR is reviewed and merged to main (or otherwise accepted) — never at PR-open time, never proactively, and a later revert on main does NOT roll it back:

```sh
c4s mark-brief-implemented <brief-path> --project 'app-spec' --workspace 'default'
```

Unlike the filesystem-scoped `c4s list-briefs` / `read-brief` / `file-patch`, this command **requires the claude4spec server** (see terminology note above — not the env-runner sandbox you may have just destroyed in step 8). If the server isn't up, ask the user to start it. There is no by-hand file edit: this skill is CLI-only.

### 10. Hand-off

The spec-author picks up your patches on the spec side and folds each deviation back into the specification. That lifecycle lives entirely in the spec repo; you only write the raw markdown patch body via `c4s file-patch`.

## Notes

This is a **base skill** generated by claude4spec **on demand** — you got it either by downloading the ZIP from the Settings page or by running `c4s install-skills`, which writes it into your code repo's `.claude/skills/`. The base skill covers reading briefs and asking the c4s agent questions; **this project's copy additionally pins a git/PR flow** on top of it (worktree → fresh branch → stage `package.json` version from `to_release` → push → order an environment from env-runner → smoke-test (leave it running) → browser pass → draft PR → stop → post-merge cleanup including `envr destroy`, steps 3/4a/5/5b/7/8 above). It is **yours to edit** — nothing overwrites it automatically. But a manual refresh (re-downloading the ZIP, or re-running `c4s install-skills`) **will** overwrite this file wholesale, including the pinned git/PR customization — re-apply steps 3/4a/5/5b/7/8 afterward rather than being surprised they're gone.

**Env-runner rules are not here.** Step 5 and the teardown in step 8 delegate to the `c4s-env-runner` skill. Keep it that way — never re-inline them.
