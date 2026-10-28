# U1-obserwacja-poddrzewa — non-blocking review findings

- round 1, rev-0002 (`src/server/fs/dir-watch.test.ts:116`): `expect(watches).toHaveLength(1)` is vacuous (the test builds one DirWatch itself); the `add:fresh/deeper/x.md` assertion carries the AC. Drop it or assert something observable.
