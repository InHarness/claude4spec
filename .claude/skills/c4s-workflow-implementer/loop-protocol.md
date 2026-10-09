# Loop protocol — `resume()` and the state on disk

Read by the orchestrator: the main session (session harness) or the driver (headless). No role reads this file. No context survives the whole build, so the protocol stands on two invariants.

1. **All state is on disk, in the code repo, never in an agent's memory.** Files under `.c4s-impl/`:
   - `release.json` — `schemas/release.json`: the window every read is pinned to, the identity, the brief path, the harness and `build` (the choices from `defaults.md`);
   - `state.json` — `schemas/state.json`: `entityTypes[]` and `entityParts[]` (setup step 5); per unit its `goal`, `recipe`, `jobs`, `dependsOn`, `wave`, `status` (`pending | in-progress | verified | blocked`), `blockedBy`, `startCommit`, `baseCommit`, `portions[]` (each with `status`, `rounds`, `partial`, `uncovered`, `only`), unit and review rounds; `waves[]` with their `startCommit`; `conventions[]`; `app` (the URL and commit of the app last brought up, and its smoke result);
   - `trace.md` — `slug → path` for every entity of a `built` type (`state.json` → `entityTypes`) and `<slug>#<key value> → path` for every item of a `built` part (`state.json` → `entityParts`), pointing at its counterpart and the test that proves its shape;
   - `stubs.json` — `schemas/stubs.json`: the brief's stub ledger plus stubs opened during the build, each with `closesInWave` and `closed`;
   - `deviations/` — one file per deviation (`schemas/deviation.json`), `sent` after `c4s create-patch`;
   - `review/<unit>.json` — the last review round (`schemas/review.json`); `review/<unit>.md` — non-blocking findings, for the human at the gate;
   - `decisions.md` — implementation-only decisions (library versions, directory names) that change nothing a user can observe;
   - `prompts/<role>.md` — the materialized role prompts (`setup.md` step 7);
   - `packets/` — ephemeral, gitignored, deleted when the unit is `verified`;
   - `gate` — present means "a human must look"; nothing runs while it exists.
2. **Every iteration is resumable from zero.** It starts with `resume()`, reads the files, derives one next step, executes it, writes. Two `resume()` calls on the same state derive the same step.

Only the orchestrator writes `state.json` and `stubs.json` status fields; a role **returns** JSON, and the orchestrator validates it against its schema before applying it. (The implementer may append rows to `stubs.json` and `trace.md` as part of its work; the orchestrator owns every `status`, `rounds`, `partial`, `uncovered`, `startCommit` and `baseCommit`.)

## Scope of a run

A role run receives its materialized prompt plus a scope block, and nothing else:

- `unit`: the unit's `id`, `goal`, `recipe` and `jobs` from `state.json` — the recipe is the only way it reads the specification;
- `app`: the base URL of the running app, for a verifier run that needs it (`needsApp`, below);
- `portion`: its name and layer(s) or criteria group (from `split.json`), and its packet path;
- `only`: the items the previous round left open — `{ "slug": "…" }` for a unit-verifier row, `{ "finding": "…" }` for a blocking review finding; empty means the whole portion;
- the state dir.

It never receives another role's reasoning, the brief, or this file.

## One iteration

```
resume():
  if gate exists → exit gate
  if c4s list-briefs shows a brief whose from_release is release.to → write gate("next window exists"); exit gate
  state ← read(state.json, stubs.json, deviations/)
  if terminate(state) → exit done

  u ← unit with status in-progress
       ?? first pending unit in wave order whose dependsOn are all verified
       ?? exit waiting                                   # every runnable unit is blocked

  if no unit has a startCommit and startMode == resume:  # the first unit of the build
      run the full suite; red → write gate("red baseline"); exit gate   # the repo's to fix, not the brief's
      if app ≠ none: ensureApp()                        # a red smoke here is the repo's too

  if u.status == pending:
      u.status ← in-progress; u.startCommit ← HEAD; u.baseCommit ← HEAD
      if u is the first unit of its wave started: wave.startCommit ← HEAD
      write

  if u.portions is empty:
      split ← run(implementer, mode = split, unit = u)  # returns split.json; writes nothing in state
      record split.deviations
      if split.portions is empty:                      # a read of the recipe did not hold ("Read problems")
          u.status ← blocked(<its blocking deviation>); write; ship; commit; exit progressed
      u.portions ← split.portions; write; commit "split(<unit>): <n> portions"; exit progressed

  p ← first portion of u not implemented
  if p exists:                                          # pending, or in-progress after a run that stopped early
      p.status ← in-progress; write
      status ← run(implementer, p, only = p.only)       # empty on the first round
      if status is waiting → u.status ← blocked(<its deviation>)
      elif status is missing or stoppedEarly:           # the work so far is in the repo; the next run finishes it
          p.partial += 1
          if p.partial ≥ stuck.rounds → u.status ← blocked(stuck); write a blocking deviation; write gate
      else → p.status ← implemented; p.rounds += 1; p.partial ← 0; p.only ← []
      write; ship; commit "impl(<portion>): round <p.rounds>"; exit

  # every portion of u is implemented
  if needsApp(u): ensureApp()
  verdict ← run(verifier, unit = u, app = state.app.url) # unit scope: whole scope + goal + jobs + full suite
  u.rounds.unit += 1
  failed ← rows of verdict whose status ≠ covered
  if failed is not empty:
      if u.rounds.unit ≥ stuck.rounds and failed did not shrink → u.status ← blocked(stuck); write a blocking deviation; write gate
      else → reopen the portions owning the failed slugs
  elif review == per-unit → review(u)
  else → verify(u)
  if u verified and its wave is complete:
      if review == per-wave → review(wave)
      if gates include wave → write gate("wave N done")

  if every unit is verified:
      if app ≠ none: ensureApp()
      verdict ← run(verifier-system, app = state.app.url)
      if all covered → c4s mark-brief-implemented <brief> <identity>; app.down is a command → run it; exit done
      else → reopen the units owning the failed slugs

  for d in deviations not sent: c4s create-patch …; d.sent ← true
  commit — "unit(<unit>): …" squashed when u was verified this iteration, else "verify(<unit>): …"
  exit gate exists ? gate : progressed

verify(u):  u.status ← verified; delete packets of u; close the stubs u provides;
            squash u.baseCommit..HEAD (with this iteration's changes) into one commit "unit(<unit>): <goal, first line> — <covered>/<total>"
needsApp(u): app ≠ none, and u owns a job, or its recipe names criteria of a type whose observedIn is e2e or per-criterion
ensureApp():
            if state.app.commit ≠ HEAD: bring the app up from HEAD (build.app) → url; state.app ← { url, commit: HEAD }
            run tests.smoke at state.app.url → state.app.smokeGreen
            no url, or smoke red → write gate("smoke red: <tail of the output>"); exit gate
                                                       # the loop cannot verify what it cannot run — a stop, never a reopen,
                                                       # and a stop also when the cause is not this branch
reopen(portions of u, items):
            each owning portion: status ← pending, only ← its failed items, uncovered ← their slugs
            u.status ← in-progress; u.startCommit ← HEAD                       # the next review reads only the fix; baseCommit stays
```

Exit statuses (`schemas/iteration-status.json`): `progressed | waiting | gate | done | error`. The driver loops on `progressed`, notifies `release.json`'s `waiting.recipient` on `waiting`, stops on `gate` and `done`, retries `error` up to `retries.error`, then writes `gate`.

## Review

Runs only when `build.review` is not `off`, after the unit-scope verifier reported all covered and before `verified`:

```
review(u):
  r ← run(reviewer, diff = git diff <u.startCommit>..HEAD, goal = u.goal)    # per-wave: wave.startCommit, every unit's goal
  validate r against review.json; write it to review/<unit>.json   # the implementer reads blocking findings from here
  append r.findings where blocking == false to review/<unit>.md
  blocking ← r.findings where blocking == true
  if blocking is empty → verify(u); u.rounds.review ← 0
  else:
      u.rounds.review += 1
      if u.rounds.review ≥ stuck.rounds and blocking did not shrink → u.status ← blocked(review); write gate("review: <unit>")
      else for each finding f: reopen(portion f.portion) with only += { finding: f.id }
           u.startCommit ← HEAD at the reopen
```

Each finding carries its `portion` — the reviewer maps `file:line` to a portion through `trace.md`. A finding that concerns the specification rather than the code is not a finding: the reviewer writes it as a deviation.

`reviewer: same-harness` or another harness name runs the reviewer role in that harness. `reviewer: command:…` needs a converter to `review.json` and is not supported yet.

## Runs are bounded, not clean

A run ends when the role reports or when the harness limit hits (turns, time, context). Both are the same to the loop: a portion whose implementer stopped early stays `in-progress` and the next iteration runs the implementer on it again; it reads the repo first and finishes what is missing. Nothing is lost, because nothing lived only in the run's context. An implementer near its limit **stops and reports** rather than starting a change it cannot finish.

## One commit per unit

Every iteration commits: the commits are checkpoints, so `resume()` works after a crash and from another machine, and `u.startCommit..HEAD` is what the review reads. When `verify(u)` holds, those checkpoints are squashed: `git reset --soft <u.baseCommit>` and one commit `unit(<unit>): <goal, first line> — <covered>/<total>`. The branch then carries one commit per unit, each one reviewable and revertable as a whole. The next unit starts from that commit. A checkpoint already pushed upstream is never rewritten: if any commit in `u.baseCommit..HEAD` is on the upstream, the unit commit is a plain commit on top, not a squash.

## Two verification scopes

| Scope | Trigger | Checks | Reopens |
| --- | --- | --- | --- |
| **unit** | every portion of the unit implemented | shape and behaviour for the whole unit scope; criteria from other units that point at its entities; the unit's goal (`goal:<unit>`, level 2); its jobs end to end (`job:<id>`, level 3); no open stub pointing at an earlier wave; **full suite green** | portions |
| **system** | all units verified | every criterion in the window's scope; the user jobs the window touches, end to end; `stubs.json` all closed; all deviations sent; full suite green | units |

Only these two scopes run against the app (`ensureApp()`, when `app` is not `none`), and the unit scope only for a unit that `needsApp`: bringing an app up costs minutes, a portion is too small to pay for it. A portion's implementer writes its end-to-end tests without running them against the app; the unit verifier runs them first, and a failing one goes back to its portion like any slug. The app is one per build, brought up again only when HEAD moved.

No verifier runs per portion. A portion's implementer proves its own slugs with the filtered test command; the unit verifier reads every slug of the unit anyway, and a slug it finds open goes back to the portion that owns it. A test that broke under a later portion returns the same way.

A unit with no criteria and no entities in its recipe (a `Domain`-only change, wave 0) would otherwise pass for free; the `goal:<unit>` row is what verifies it.

## terminate(state)

True when every unit is `verified`, the system verification reported all covered, `stubs.json` has no open row, and every deviation is `sent`. Then and only then `c4s mark-brief-implemented <brief path> <identity>`.

## Gates

A gate is a file plus a non-zero exit, never a question. Configured in `release.json` → `build.gates` — after wave 0, at every wave boundary, every N iterations — and always on: a red baseline, a red smoke, a next window, `stuck`, `blocked(review)`, `waiting`. The human reads the diff and `review/*.md`, deletes `gate`, and reruns (in a session harness: says "continue").

## Deviations, never questions

Inside a run nobody answers. What the specification does not settle becomes a deviation file: address (`<unit>/<layer or section anchor>`), slugs, `kind`, `blocking`, text. Kinds are the patch kinds of `c4s create-patch`:

- `missing` — the specification is silent on something the build needs;
- `incorrect` — two places disagree, or one is wrong about what exists;
- `clarification` — ambiguous, or not buildable as written;
- `drift` — delta window only: the code already does something else, and the specification should say so.

Non-blocking → an `ASSUMPTION:<id>` marker at the site in code, and the work goes on. Blocking → the unit goes `blocked(<id>)` and the loop takes another runnable unit. The test for "deviation or decision?": does the answer change behaviour a user could observe? Yes → deviation. No → `decisions.md`, and continue.

Shipping, at the end of every iteration:

```sh
c4s create-patch --brief <release.brief> --kind <kind> --desc "<address>: <short>" --body-file .c4s-impl/deviations/<id>.md <identity>
```

The body file is the deviation rendered as `## What I found` / `## Suggestion`. `sent: true` and `patchPath` only on success. Answers come back only through the specification: a patch, a spec edit, a new release, a new brief for the next window.
