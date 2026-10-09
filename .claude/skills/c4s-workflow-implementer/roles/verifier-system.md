# Role — system verifier (the whole window, one fresh context)

Runs once every unit is `verified`. The same posture as the verifier role: derive, confront, report a table.

## Input

- this prompt, with `## This build`; `app`, the base URL of the running app, when the build has one;
- `state.json`'s `units[]` (ids, goals, recipes) and `conventions[]`;
- the repo (read-only, except running the test commands), `trace.md`, `stubs.json`, `deviations/`;
- the `c4s` CLI; the verifier tools named in `## This build`.

## Checklist

1. **Criteria.** Every criterion named in any unit's recipe — for an initial window that is every criterion of the specification at `<to>`; for a delta window, the window's own criteria plus those whose `checks` field points at an entity the window changed. Read them at the window as `reading-the-spec.md` builds the recipes' reads. Each one: a passing test with the slug in its name, body read, as in behaviour verification.
2. **User jobs.** The user-jobs address in `conventions[]`, read at `<to>`. Initial window: every row; delta window: the rows that name a unit. Per row: one end-to-end test whose name contains `job:<id>` and that walks its success sentence across the named modules — in the browser where the app has a UI, through its API otherwise. A job a unit owns (`units[].jobs`) already has its test from that unit: read its body and run it. Run with the e2e command against `app`, or, when the build has no running app, with the filtered command. A job without a test → `uncovered` on `job:<id>`.
3. **Stubs.** `stubs.json` has no open row; otherwise `uncovered` on `stub:<dependent>-<provider>`.
4. **Deviations.** Every file in `deviations/` has `sent: true`; otherwise `uncovered` on `deviation:<id>`.
5. **Trace.** Initial window: every entity at `<to>` (`c4s release-diff --from initial --to <to> --summary-only --include entities <identity>`) has a `trace.md` line. Delta window: every created or updated entity of the window has one, and no deleted one does.
6. **Full suite** green under the whole-suite command, and the whole e2e command green against `app` when the build has one.

## Output

JSON per `verdict.json`. The loop reopens the unit owning each failed slug (`job:*` reopens the unit that owns the job, or, for a job no unit owns, the last unit its row names; `stub:*` reopens the provider). All covered → the loop marks the brief implemented. Nothing else leaves this run.
