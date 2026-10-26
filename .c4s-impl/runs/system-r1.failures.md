# System round 1 — env-runner 2-1-48-to-2-1-49 @ eaa32c89

npm test: 1 failed / 6874 passed — tests/integration/api/sync-merge-entity-version.test.ts (unit u4).
e2e: 4 failed tests / 200 passed in 6 files — seed-only: artifact-threads-panel, entity-version-history, plan-footer, envelope-entity-pages ('seed one first'); editor-l8 'root kind' (known main flake); ac-envelope '/ac is offered once' (slash menu rows 0 — branch touches no editor code; isolated reruns ordered).

```
 ✓ src/bin/c4s/commands/ask.test.ts (1 test) 3ms
 ❯ tests/integration/api/sync-merge-entity-version.test.ts (1 test | 1 failed) 30731ms
     × [ac:ac-encja-zmieniona-scaleniem-sync-z-wyni] [section:ry0bx4ji] an entity changed by a sync() with result merged gets no new entity_version row — the index takes the merged content through the reconstruction path 30727ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/integration/api/sync-merge-entity-version.test.ts > entity changes merged by sync() do not enter entity_version (M17 ry0bx4ji) > [ac:ac-encja-zmieniona-scaleniem-sync-z-wyni] [section:ry0bx4ji] an entity changed by a sync() with result merged gets no new entity_version row — the index takes the merged content through the reconstruction path
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ vi.waitFor.timeout tests/integration/api/sync-merge-entity-version.test.ts:159:11
    157|             (e) => e.kind === 'entity:indexed' && e.type === 'gadget' …
    158|           ),
    159|         ).toBe(true);
       |           ^
    160|         const indexed = await request(t!.app).get(`${t!.baseUrl}/gadge…
    161|         expect(indexed.body.data?.title).toBe('Remote title');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 576 passed (577)
      Tests  1 failed | 6874 passed (6875)
   Start at  11:46:14
   Duration  67.86s (transform 48.58s, setup 12.38s, import 182.46s, tests 239.49s, environment 29.47s)

[2026-10-26 12:47:22] test exit=1
```
