# m11-cli-output-streams — non-blocking review findings

- **rev-0001** `src/bin/c4s/streams.test.ts:66` — the test title says the log line comes *after* an unexpected error, but the body writes `console.error('library diagnostic')` *before* the throw. No test covers a write after the failure (e.g. a late async callback once `release()` has run). Rename the test or add the case.
- gate fix: rev-0001 — test renamed to what it checks (log line before the error); late writes after release() are out of the implementation by design (see decisions.md).
