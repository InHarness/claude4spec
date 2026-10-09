---
name: c4s-workflow-implementer
description: Implement a claude4spec workflow brief (heading `# Workflow brief:` or `# Initial workflow brief:`) in a code repository. A workflow brief is a plan of work units — each with a goal, a reading recipe naming what to read at the brief's release window (pages and section ranges, entity types and slugs), and its dependencies — grouped into waves. This skill builds and runs the loop that implements it: set-up of `.c4s-impl/` state, fresh implementer runs per portion, verifier and reviewer runs per unit, one commit per unit, gates, and deviations shipped as `c4s create-patch`. Use when the user asks to implement a workflow brief, or when `c4s-brief-implementer` hands one over.
---

# c4s-workflow-implementer

A workflow brief says **what** to build and **in what order**: units of work, each with a goal, a reading recipe and its dependencies, grouped into waves. This skill says **how** the loop that builds it runs. The brief carries no protocol; this skill is the protocol, and it is yours to tune: fill `defaults.md` once, delete what your harness does not use.

## Two levels of reading

The skill separates **building the loop** from **working in the loop**.

| Who | Reads |
| --- | --- |
| The session that starts the loop (you, now) | this file, `defaults.md`, `setup.md`, the chosen `harness/*.md` |
| The orchestrator — the main session (session harness) or the driver (headless) | `loop-protocol.md`, `.c4s-impl/` |
| A role run (implementer, verifier, reviewer, system verifier) | only its materialized prompt `.c4s-impl/prompts/<role>.md`, its scope, and the `c4s release-diff` reads its recipe names, built per `reading-the-spec.md` |

A role run never reads this file, `setup.md`, the harness files or the brief. Setup writes everything a role needs into its prompt once (`setup.md` step 7), so every run of a role reads the same words.

## Server required

Every `c4s` command talks to a running claude4spec server. `SERVER_NOT_RUNNING` (exit 8) — stop and ask the user to start it; never read the specification's files by hand. A role run that meets it ends with status `error`.

## Workflow

1. **Pick the brief.** `c4s list-briefs --status pending <identity>`; the user names it, or there is exactly one workflow brief pending. Read it once with `c4s get-brief <path> <identity>` and check its heading names the genre.
2. **Set up** — follow `setup.md` from start to end, in this interactive session, even when the loop will run headless. It asks the project which entity types it uses and plans how each is built and verified here, asks the user only what `defaults.md` leaves open (plus that plan, to correct), and ends with a commit. From that commit on **nothing reads the brief again**: everything it said lives in `.c4s-impl/state.json` and `.c4s-impl/stubs.json`.
3. **Run the loop** with the harness named in `.c4s-impl/release.json`:
   - `claude-code-session` — this session is the orchestrator: follow `harness/claude-code-session.md`, which runs `resume()` from `loop-protocol.md` and starts each role as a fresh subagent;
   - `claude-code-headless` / `codex` — the driver is the orchestrator: follow `harness/driver.md` to install `harness/driver-reference.mjs` (or your own driver honouring its contract), then hand the terminal loop to the human.
4. **Stop at every gate** and report why (`.c4s-impl/gate`). `waiting` goes to the recipient in `release.json`.
5. **Done** — `resume()` exits `done` only after `terminate()` holds and `c4s mark-brief-implemented` succeeded. Open the PR as `defaults.md`'s git policy says (`.c4s-impl/` removed before merge).

## Files

```
SKILL.md               this file — set-up and orchestration entry point
defaults.md            the user's choices: harness, tests, the running app, isolation, budget, gates, review, notifications
setup.md               init: worktree, .c4s-impl/, connection check, state.json from the brief, entity types, release.json, role prompts
loop-protocol.md       resume(), scopes, review, gates, deviations — read by the orchestrator
reading-the-spec.md    how to read release-diff — pasted into implementer and verifier prompts
roles/                 implementer (incl. split mode), verifier, reviewer, verifier-system
schemas/               deviation, iteration-status, verdict, review, split, release, state, stubs
harness/               claude-code-session, claude-code-headless, codex, driver.md + driver-reference.mjs
```
