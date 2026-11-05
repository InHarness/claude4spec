# m31-registry-canonical-paths — review log

- round 1: **rev-0001 (blocking, fixed in round 2)** `src/server/workspace/home-workspace.ts:119` — the canonical rule dropped the absolute-path guard; a drive prefix `C:/…` passed as a segment. The drive prefix is now refused and covered in the `[section:t97gncju]` it.each list.
- round 2: no findings.
