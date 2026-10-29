---
name: c4s-brief-implementer
description: Implement features described in claude4spec briefs. Briefs are self-contained markdown files (entity snapshots, section diffs, narrative) that live in the companion specification repository, reached from your code repo via the c4s CLI (c4s list-briefs / get-brief, with --server and --project baked in). After implementation, if you discover drift between the brief and reality (missing details, incorrect assumptions, edge cases not covered), file a patch via c4s create-patch as feedback for the specification author. Use when implementing a claude4spec brief in a code repository.
---

# c4s-brief-implementer

This skill describes how to implement a release brief in **your code repository** (not the spec repo). A brief is a self-contained markdown file that captures everything you need to ship the change: entity snapshots, section diffs, narrative, acceptance criteria. Briefs live in the **spec** repository, a different repo from the one you are working in — you never touch it directly; the `c4s` CLI reaches everything for you.

**Reaching the briefs.** This skill is **CLI-only**: it reaches the briefs and writes patches solely through the `c4s` CLI, with the spec project's identity baked into this skill (`--server 'http://localhost:4508' --project 'app-spec'`) — `c4s list-briefs` / `c4s get-brief` / `c4s create-patch` work from any directory, and each of them delegates to the server (see below). If `c4s` is not installed, **stop** and ask the user to install it — do not read or write the spec repo's files by hand. There is no fallback **even when a `c4s` command fails**: a failed command ends the work and asks the user to intervene; it is never a reason to go read the specification's files instead. `WORKSPACE_NOT_REGISTERED` means the spec project lies in a workspace home directory this machine has never registered — stop and ask the user to start the server once with `--cwd <home>`; do not start it yourself.

## Server required — for every step

Every `c4s` command in this skill talks to a running `npx @inharness-ai/claude4spec` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.

`SERVER_NOT_RUNNING` **(exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.

Three neighbouring codes mean something else, and starting a server will not fix any of them: `SERVER_NOT_RECOGNIZED` (something is listening, but it is not claude4spec), `PROJECT_NOT_IN_WORKSPACE` (the server is fine, but it does not serve this skill's project — see "Stale address" below) and `WORKSPACE_NOT_REGISTERED` (the project lies in a workspace home directory this machine has never registered). Report those as they are.

## Stale address — `PROJECT_NOT_IN_WORKSPACE`

`PROJECT_NOT_IN_WORKSPACE` means the server at `http://localhost:4508` does not serve the project `app-spec` — the address baked into this skill is stale. **Stop and ask the user to regenerate this skill** (Settings → External Integrations, or `c4s install-skills`). Do not guess another `--project` or `--server` value.

**The brief is self-contained.** You do not need to read the main specification or query the entity database — everything is in the brief body. If the brief references something you cannot find in its body, treat that as drift and file a patch (step 4 below).

## Workflow

### 1. Discover

List the briefs through `c4s` (paginated — briefs accumulate over time, so filter and page rather than dumping everything):

```sh
c4s list-briefs --status pending --limit 10 --server 'http://localhost:4508' --project 'app-spec'
```

`--status pending` hides briefs already marked `implemented: true`; drop it to see all. Use `--offset` to page. Output lists each brief's `path` (which you pass to `get-brief`) and whether it is already implemented.

**Which brief do I implement?** If the user named a brief, use it. If not — and `list-briefs` returns more than one pending brief — **ask the user which one**; do NOT guess. Picking the wrong brief wastes an implementation pass. Only proceed automatically when there is exactly one obvious candidate (a single pending brief, or the user pointed at one).

### 2. Read the brief as self-contained input

Read the full brief by the `path` printed by `list-briefs`:

```sh
c4s get-brief <brief-path> --server 'http://localhost:4508' --project 'app-spec'
```

The body contains everything you need — entity snapshots, section diffs, the narrative of what changes, and acceptance criteria. Read it and implement it; you do not need to understand how the brief was produced. **Do not read the main specification.**

**A workflow brief is the exception.** When the brief's heading reads `# Workflow brief:` or `# Initial workflow brief:`, it is not a one-pass narrative but a **plan of work units**: each with a goal, a reading recipe of `c4s release-diff` commands pinned to the brief's window, and its dependencies, ordered in waves. Implement it with the **`c4s-workflow-implementer`** skill, not with the steps below. If that skill is not installed in this repo, **stop and tell the user** that this brief needs it — do not implement a plan brief as a narrative, and do not read the specification to fill the gap.

If the brief is unclear — a missing detail, an ambiguous wording, a decision you'd otherwise have to guess — you have two paths.

**Ask the spec (the normal path).** Ask the specification agent in the same terminal and continue once you have an answer. Two distinct commands, by what context you need.

Preferred — context of THIS brief plus its release diff (the agent sees only the change window of the brief you are implementing):

```bash
c4s agent "Brief nie precyzuje X — czy chodzi o A czy B?" --ct brief --brief <brief-path> --server 'http://localhost:4508' --project 'app-spec'
```

Alternative — read-only peer-consult of the CURRENT spec state (may be ahead of the brief you are implementing); no brief context, no `--ct`/`--brief`:

```bash
c4s ask "Jak dziala Y w aktualnej specce?" --server 'http://localhost:4508' --project 'app-spec'
```

Continue the brief thread with `c4s agent "..." --thread <threadId> --server 'http://localhost:4508' --project 'app-spec'` (the `threadId` is printed with the answer).

**Asynchronous.** If the agent cannot answer — an `AGENT_UNAVAILABLE`, or a question the spec genuinely does not settle — proceed with your best judgement and file a patch afterwards (step 4) so the spec-author can fold the clarification into the next brief. This is not the fallback for a server that is down: with no server you never read the brief in the first place, so there is nothing to proceed with. Stop and ask for the server instead.

### 3. Implement

Standard code flow in your target repository: read existing code, plan, edit, test. Stay focused on what the brief specifies.

**Literal UI strings ship in English**, even when the brief quotes them in another language (labels, empty states, toasts, error messages). Translate them as you implement, and file a patch (step 4, `--kind clarification`) listing each string you translated, so the spec-author can fix the source.

### 4. Feedback loop (patches)

When you discover that the brief diverges from reality — a missing detail, an incorrect assumption, an edge case not covered, or anything else the spec-author should know — file a patch. Use `c4s create-patch`, which records the patch on the spec side for you:

```sh
printf '%s\n' "$PATCH_BODY" | c4s create-patch \
  --brief <brief-path> --desc "<short-desc>" --kind drift \
  --server 'http://localhost:4508' --project 'app-spec'
```

The body (from stdin, or `--body-file <f>`) goes below an auto-generated `# Patch — <short-desc>` heading. Structure the body as two sections: a `## What I found` section (the drift / missing detail / incorrect assumption) and a `## Suggestion` section (what the spec-author should consider in a follow-up brief or entity edits). `c4s create-patch` records all the metadata for you (which brief it relates to, the kind from `--kind`, defaulting to `drift`) — you only write the markdown body.

`--kind` values:

- `drift` — the brief described behavior X, but the codebase already does Y.
- `missing` — the brief is silent on a detail you had to decide yourself.
- `incorrect` — the brief is factually wrong about existing code.
- `clarification` — the brief is ambiguous; you guessed but it should be made explicit for next time.

### 5. Mark brief as implemented

When the implementation is genuinely finished — code committed, tests green, merged to main / accepted by the user — mark the brief as implemented (`implemented: true`):

```sh
c4s mark-brief-implemented <brief-path> --server 'http://localhost:4508' --project 'app-spec'
```

Like every other command in this skill, this one goes through the server — see "Server required" above. There is no by-hand file edit: this skill is CLI-only.

`implemented: true` is a **declaration**, not a computed fact derived from git. A revert on main does NOT roll the flag back. Set it ONLY when implementation is realistically done — never proactively or "just in case".

### 6. Hand-off

The spec-author picks up your patches on the spec side and folds each deviation back into the specification. That lifecycle lives entirely in the spec repo; you only write the raw markdown patch body via `c4s create-patch`.

## Notes

This is a **base skill** generated by claude4spec **on demand** — you got it either by downloading the ZIP from the Settings page or by running `c4s install-skills`, which writes it into your code repo's `.claude/skills/`. It already covers what you need to read briefs and ask the c4s agent questions. Feel free to **adapt it to your own workflow** (e.g. add a git/PR flow) or use it as-is. To refresh it against the current spec, re-download the ZIP or re-run `c4s install-skills` (overwrites the managed copy).
