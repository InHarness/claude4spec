---
name: c4s-brief-implementer
description: Implement features described in claude4spec briefs. Briefs are self-contained markdown files (entity snapshots, section diffs, narrative) that live in the companion specification repository, reached from your code repo via the c4s CLI (c4s list-briefs / read-brief, with --project and --workspace baked in). After implementation, if you discover drift between the brief and reality (missing details, incorrect assumptions, edge cases not covered), file a patch via c4s file-patch as feedback for the specification author. Use when implementing a claude4spec brief in a code repository.
---

# c4s-brief-implementer

This skill describes how to implement a release brief in **your code repository** (not the spec repo). A brief is a self-contained markdown file that captures everything you need to ship the change: entity snapshots, section diffs, narrative, acceptance criteria. Briefs live in the **spec** repository, a different repo from the one you are working in — you never touch it directly; the `c4s` CLI reaches everything for you.

**Reaching the briefs.** This skill is **CLI-only**: it reaches the briefs and writes patches solely through the `c4s` CLI, with the spec project's identity baked into this skill (`--project 'app-spec' --workspace 'default'`) — `c4s list-briefs` / `c4s read-brief` / `c4s file-patch` work from any directory, without a running server (they are filesystem-scoped). If `c4s` is not installed, **stop** and ask the user to install it — do not read or write the spec repo's files by hand.

**The brief is self-contained.** You do not need to read the main specification or query the entity database — everything is in the brief body. If the brief references something you cannot find in its body, treat that as drift and file a patch (step 4 below).

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

If the brief is unclear — a missing detail, an ambiguous wording, a decision you'd otherwise have to guess — you have two paths.

**Synchronous (preferred when available).** Ask the specification agent in the same terminal and continue once you have an answer. Two distinct commands, by what context you need.

Preferred — context of THIS brief plus its release diff (the agent sees only the change window of the brief you are implementing):

```bash
c4s agent "Brief nie precyzuje X — czy chodzi o A czy B?" --ct brief --brief <brief-path> --project 'app-spec' --workspace 'default'
```

Alternative — read-only peer-consult of the CURRENT spec state (may be ahead of the brief you are implementing); no brief context, no `--ct`/`--brief`:

```bash
c4s ask "Jak dziala Y w aktualnej specce?" --project 'app-spec' --workspace 'default'
```

Continue the brief thread with `c4s agent "..." --thread <threadId> --project 'app-spec' --workspace 'default'` (the `threadId` is printed with the answer). This path requires `c4s` installed *and* a running `npx @inharness-ai/claude4spec` server. When either is unavailable, skip it.

**Asynchronous (always available).** If you cannot ask synchronously, proceed with your best judgement and file a patch afterwards (step 4) so the spec-author can fold the clarification into the next brief.

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

### 5. Smoke-test in Docker

Before opening the PR, launch and exercise the change end-to-end — don't hand off on green unit tests alone. Always smoke-test in Docker, never on the bare host: a host-level dev server binds fixed ports tied to `--workspace default`, so it collides the moment another worktree or session already has one running. Docker gives each worktree its own isolated, port-bumped environment instead. From inside the worktree:

```bash
docker/setup-env.sh "$brief_slug"
C4S_ENV="$brief_slug" PORT_HOST=3000 docker compose up -d app-registry
# bump PORT_HOST (e.g. 3001) if another worktree/brief already has one running
```

Exercise the change at `http://localhost:$PORT_HOST/welcome`. Leave the container running (note the `-d`) and report back: the URL, the port, and (if you seeded one) which scratch project directory backs it — the user gets their own hands-on look at the same environment you just exercised. Don't `docker compose down` unless the user asks you to tear it down. Use `app-local` instead of `app-registry` only if this brief also touches `agent-adapters`/`agent-chat` — see `DOCKER.md` (repo root) for details and env vars. If the smoke test reveals drift, file a patch (step 6).

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

### 7. Open a draft PR and STOP

Push the branch and open a **draft** PR against `main`, then hand off:

```bash
git push -u origin "brief/$brief_slug"
gh pr create --draft --base main \
  --title "$brief_slug: <short title>" \
  --body "Implements brief <brief-path> — see: c4s read-brief <brief-path> --project 'app-spec' --workspace 'default'

<one-paragraph summary of what changed + how it was tested>"
```

**Do NOT run `gh pr merge`.** Review and merge are the human's call. Stop here and report the PR URL.

### 8. After the user confirms the PR is merged: clean up

Only do this once the user explicitly tells you the PR is merged (or asks you to merge it yourself) — never proactively. Then, from the **primary repo checkout** (not the worktree, since it has the target branch, e.g. `main`, checked out and `git worktree remove`/branch deletion must run from outside the worktree being removed):

```bash
# stop the Docker environment you left running for this brief's smoke-test (step 5) first:
# C4S_ENV="$brief_slug" docker compose down
git fetch origin
git checkout main && git pull origin main   # or the repo's actual base branch
git worktree remove ".worktrees/$brief_slug"
git branch -d "brief/$brief_slug"                          # local branch
git push origin --delete "brief/$brief_slug" 2>/dev/null    # remote, if `gh pr merge --delete-branch` didn't already
```

If you merge the PR yourself (`gh pr merge --draft` PRs need `gh pr ready` first), pass `--delete-branch` — but still verify locally afterward: `gh pr merge` run from inside the worktree can fail the local branch-delete/checkout step (base branch is checked out elsewhere), so don't assume it fully succeeded without checking (`git ls-remote --heads origin "brief/$brief_slug"` should come back empty).

Also check for stray Docker state tied to this brief: `docker ps -a --filter "name=$brief_slug"` — tear down anything found.

### 9. Mark brief as implemented

`implemented: true` is a **declaration**, set ONLY after the draft PR is reviewed and merged to main (or otherwise accepted) — never at PR-open time, never proactively, and a later revert on main does NOT roll it back:

```sh
c4s mark-brief-implemented <brief-path> --project 'app-spec' --workspace 'default'
```

Unlike the filesystem-scoped `c4s list-briefs` / `read-brief` / `file-patch`, this command **requires a running `npx @inharness-ai/claude4spec` server** — if it isn't up, ask the user to start it. There is no by-hand file edit: this skill is CLI-only.

### 10. Hand-off

The spec-author picks up your patches on the spec side and folds each deviation back into the specification. That lifecycle lives entirely in the spec repo; you only write the raw markdown patch body via `c4s file-patch`.

## Notes

This is a **base skill** generated by claude4spec **on demand** — you got it either by downloading the ZIP from the Settings page or by running `c4s install-skills`, which writes it into your code repo's `.claude/skills/`. The base skill covers reading briefs and asking the c4s agent questions; **this project's copy additionally pins a git/PR flow** on top of it (worktree → fresh branch → smoke-test (leave the environment running) → draft PR → stop → post-merge cleanup, steps 3/5/7/8 above). It is **yours to edit** — nothing overwrites it automatically. But a manual refresh (re-downloading the ZIP, or re-running `c4s install-skills`) **will** overwrite this file wholesale, including the pinned git/PR customization — re-apply steps 3/5/7/8 afterward rather than being surprised they're gone.
