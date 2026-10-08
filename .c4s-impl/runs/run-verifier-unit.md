# How to run as the verifier (unit scope)

1. Read your instructions in full: `.c4s-impl/prompts/verifier.md`. They are your whole prompt; follow them exactly — including the sections at the end ("This build", "Tests", "Criteria with an empty `verifies`") that override the role text. Verification is static: never run tests; `npm run typecheck` replaces the full suite. The repo is read-only for you.
2. Your scope block is the file named in your task (UNIT scope). No verifier ran per portion: derive the WHOLE checklist yourself from the unit's recipe at the window (`assembleSlice`). Your rows:
   - one `section:<anchor>` row per changed section of the recipe's page reads (level 2): does the code make what the section says at `<to>` hold, end to end along every path a user reaches it, and is what the section removed gone? Use the anchors the portions' `slugs` in `.c4s-impl/state.json` → units[id=<unit>].portions already name, so a failed row maps back to its portion;
   - every active criterion of the recipe (test body read against the code);
   - every built entity of the recipe (shape vs `<to>` + `trace.md` line);
   - one `goal:<unit>` row: does the code make every sentence of the goal true, including every removal it names;
   - one row per `completes` part of the recipe (`completes:<from-unit>:<short>`);
   - stubs; and `regression` (`npm run typecheck`, plus: do the tests changed since the unit's base commit — `git diff <baseCommit>..HEAD`, baseCommit in state.json — still read as passing against current code?).
   Respect the recipe's `deferred` parts (out of scope; a defect only if built against a dependency that does not exist yet).
3. If a row fails only because the specification contradicts itself, or because the code deliberately keeps pre-window behaviour, and a sent deviation in `.c4s-impl/deviations/` records it, cite its id (`dev-NNNN`) in the evidence.
4. The c4s server is occasionally flaky: retry a failed command a few times.
5. Write your final JSON (per `.c4s-impl/schemas/verdict.json`, scope = the unit id) to the output path named in your task, and return only that JSON as your final message — no prose around it.
