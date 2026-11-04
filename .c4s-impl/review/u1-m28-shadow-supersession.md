# Review u1-m28-shadow-supersession — non-blocking findings

- **rev-0001** `src/server/services/git.ts:2731` — `shadowSupersession` runs n·(n−1) `git merge-base --is-ancestor` calls on every `GET /api/git/shadows` (30 shadows ≈ 870 git processes). `git merge-base --independent` plus one `--contains`/`rev-list` per non-terminal tip gives the same answer in ~n+1 calls.
- **rev-0002** `src/server/services/git.ts:2857` — `resolveShadow` always runs the full list filter plus the supersession scan, but none of its current callers (shadow-diff, accept-shadow, run-read) reads `supersededBy`; run-read scans twice. Note: u3 (shadow-diff/accept) and u4 (`get_run`) will start reading `supersededBy` in wave 2, so part of this cost becomes needed — compute it only where read.
- round 2: rev-0001 and rev-0002 fixed (human request at the wave-1 gate); no new findings.
