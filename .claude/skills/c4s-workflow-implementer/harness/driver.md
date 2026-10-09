# Driver — the orchestrator of a headless loop

With a headless harness (Claude Code headless or Codex) the loop needs a driver: a program that runs `resume()` once per invocation. `driver-reference.mjs` beside this file is one — Node, no dependencies. Copy it into the code repo (`tools/c4s-implement/driver.mjs` is a good home), version it there, and change it as your repo needs; any driver that honours the contract below is interchangeable with it.

## Contract

1. **State only on disk**, under `.c4s-impl/`, in the shapes of `schemas/` (`release`, `state`, `stubs`, `deviation`). The driver never reads the brief: setup parsed it into `state.json` once.
2. **One invocation = one `resume()`**: read → derive one step → run the role(s) of that step → write → exit. Two invocations on the same state derive the same step.
3. **Roles are separate processes** with fresh contexts — implementer (build and split mode), verifier, reviewer, system verifier. Each gets its materialized prompt (`.c4s-impl/prompts/<role>.md`) plus a scope block; one role's output never reaches another role.
4. **Role output is validated** against its schema before the state is touched (`iteration-status`, `split`, `verdict`, `review`). Invalid or missing output is `stoppedEarly`: the portion stays `in-progress` and the implementer runs on it again.
5. **Only the driver writes `state.json`.** The split step's portions come back as `split.json` and the driver records them.
6. **One adapter per harness**, chosen by `release.json.harness` (or `--adapter`): `run(role, scope) → output | null`, plus `nextWindow()`, `createPatch()`, `markImplemented()`, `appUp() → url | null`, `smoke(url) → { green, tail }`, `appDown()`. The `stub` adapter answers every role from `.c4s-impl/stub/<role>.json` (`implementer-split.json` for split mode, `app.json` for `{ url, green }`) or, absent a file, with a happy default — for tests of the driver itself.
7. **Guards first**: refuse to run while `gate` exists; write `gate("next window exists")` when `c4s list-briefs` shows a brief whose `from_release` is `release.to`.
8. **Gates, `stuck` and review rounds** as configured in `release.json.build`.
9. **Deviations shipped** at the end of every iteration with `c4s create-patch … --body-file .c4s-impl/deviations/<id>.md`; `sent: true` only on success.
10. **One commit per iteration, one per unit in the end**: `split(<unit>): <n> portions`, `impl(<portion>): round <n>`, `verify(<unit>)…` are checkpoints; when the unit is verified they are squashed from `u.baseCommit` into one `unit(<unit>): <goal> — <covered>/<total>` (not when a checkpoint is already upstream — `loop-protocol.md`, "One commit per unit"). The git log is the human's progress view; `state.json` is the machine's.
11. **`--dry-run`** derives the step and prints it as JSON; it writes nothing and runs no role.
12. **Exit codes**: 0 `done`, 10 `progressed`, 20 `gate`, 30 `waiting`, 1 `error`. A terminal loop is `while node driver.mjs; [ $? -eq 10 ]; do :; done`.

## Steps the reference driver derives

```
driver():
  release, state, stubs, deviations, gate ← read .c4s-impl/
  gate exists                        → exit 20
  next window exists                 → write gate; exit 20
  terminate()                        → exit 0
  every unit verified                → app up + smoke (red → gate) → verify-system (all covered → mark-brief-implemented, app.down) | ship | gate(open stubs)
  u ← in-progress unit ?? first pending unit in wave order whose dependsOn are verified ?? → exit 30
  first unit of the build, startMode resume → baseline: full suite; red → gate("red baseline"); app → smoke; red → gate("smoke red")
  (u pending → in-progress, u.startCommit ← u.baseCommit ← HEAD, wave.startCommit ← HEAD if unset)
  u.portions empty                   → split: implementer in split mode → split.json → u.portions,
                                       or no portions + a blocking deviation → u blocked
  p ← first portion not implemented  → implement-portion (implementer with only = p.only);
                                       finished → implemented, stopped early → stays in-progress
  all portions implemented           → needsApp(u) → app up from HEAD + smoke; red → gate("smoke red")
                                       verify-unit (+ goal:<unit>, job:<id>); covered → review per build.review → verified + squash | reopen
  ship deviations; commit; exit gate ? 20 : 10
```

The reference driver runs one of these steps per invocation, so a unit's verification is its own iteration after the last portion's. `loop-protocol.md` is the authority on what each step does.

## Checked before the first real run

On a copy of the fresh state:

- `node driver.mjs --dry-run` twice prints the same JSON and leaves `.c4s-impl/` byte-identical;
- `node driver.mjs --adapter stub` once exits 10, records the first unit's portions in `state.json`, and adds exactly one commit;
- run to the end of the first unit with the stub adapter: `git log` shows one `unit(<unit>)` commit for it, and no `split`/`impl`/`verify` checkpoint of it.

Running `claude -p` from inside a Claude Code session's shell is not the intended path; the human runs the terminal loop.
