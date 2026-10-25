# System round 1 — env-runner 2-1-47-to-2-1-48 @ ec889d57

npm test: 2 failed / 6836 passed (both in src/server/routes/artifacts.test.ts, unit m10).
e2e: 4 failed tests in 6 files — artifact-threads-panel, entity-version-history, plan-footer (seed-only, as on 2.1.47), editor-l8 'root kind' (known main flake), envelope-entity-pages, frontend-mockups-envelope (isolated reruns ordered).

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/server/routes/artifacts.test.ts > artifactsRouter — /api/artifacts/:kind/* > the detail route's two projections (2.1.48) > [ac:ac-po-save-planu-dluzszego-niz-budzet-od] a Save of the whole plan (longer than the response budget) leaves the file ending with its last line
AssertionError: expected 400 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 400

 ❯ src/server/routes/artifacts.test.ts:955:26
    953|       const edited = read.body.data.content.replace('0 xxx', '0 EDITED…
    954|       const res = await request(app).put(`${url}/content`).send({ cont…
    955|       expect(res.status).toBe(200);
       |                          ^
    956|       const bytes = await onDisk(path.join(plansDir, 'big-plan.md'));
    957|       expect(bytes).toBe(edited);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/server/routes/artifacts.test.ts > artifactsRouter — /api/artifacts/:kind/* > the detail route's two projections (2.1.48) > [ac:ac-save-planu-zmienionego-w-miedzyczasie] a Save of a plan changed on disk meanwhile is refused 409 PLAN_CONFLICT and the file on disk stays byte-identical
AssertionError: expected 400 to be 409 // Object.is equality

- Expected
+ Received

- 409
+ 400

 ❯ src/server/routes/artifacts.test.ts:976:26
    974|         .send({ content: read.body.data.content.replace('0 xxx', '0 MI…
    975|
    976|       expect(res.status).toBe(409);
       |                          ^
    977|       expect(res.body.error.code).toBe('PLAN_CONFLICT');
    978|       expect(res.body.currentHash).toBe(sha256(foreign));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed | 571 passed (572)
      Tests  2 failed | 6836 passed (6838)
   Start at  19:44:28
   Duration  48.10s (transform 43.28s, setup 11.52s, import 156.40s, tests 176.56s, environment 22.00s)

[2026-10-25 20:45:16] test exit=1
```
