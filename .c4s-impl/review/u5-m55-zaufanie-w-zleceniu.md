## u5-m55-zaufanie-w-zleceniu — review round 1 (non-blocking, sent back for a fix per the user's 'fix' instruction)

- **rev-0001** `src/server/runs/run-read.ts:112`: RUN_REASON_HINTS are written in Polish, while every other agent-facing string in these modules (PLAN_HINT, RunRemoteError messages, TRUST_WARNING_*) is English; get_run now mixes languages. Write the hints in English, following PLAN_HINT.
- **rev-0002** `src/server/runs/run-remote.ts:414`: On a consent path mismatch, trustOf adds the mismatch warning and then also TRUST_WARNING_PLUGINS and/or TRUST_WARNING_SKILL_USES (plugins/attachments are empty once samePath is false): up to three warnings for one cause, two of which claim no local approval although one exists for another path. Omit the needs warnings when the mismatch warning was added, or make the mismatch warning name what was withheld.
- **rev-0003** `src/server/runs/run-remote.ts:531`: `path.join(rootPath, home === '.' ? '' : home!, …)` duplicates the recipe path computation at line 522. Compute the home's absolute directory once and reuse it so the two base-sha reads cannot drift.
- round 2 (fix only): rev-0001..0003 resolved, no new findings.
