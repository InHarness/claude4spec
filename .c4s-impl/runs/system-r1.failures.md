# System verification round 1 — env-runner 2-1-46-to-2-1-47 (sha 3bc60300, git 2.39.5, node in container, npm ci as uid 1000)

npm test: 10 failed / 6791 passed (3 files). e2e: 3 failed / 201 passed (5 files: 3 seed-only as on 2.1.46 — artifact-threads-panel, entity-version-history, plan-footer; plus ac-envelope, envelope-entity-pages).

```
⎯⎯⎯⎯⎯⎯ Failed Tests 10 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  src/client/components/ReleasesPage.shadow-accept.render.test.ts > /releases Shadows tab — accepting a shadow (M17 releases-list, 2.1.47) > [ac:ac-przycisk-accept-jest-nieaktywny-gdy-p] Accept is inactive when the preview returns a non-empty `conflicts` list — its hint names the conflicting files; with an empty list it is active
TypeError: Cannot read properties of null (reading 'getAttribute')
 ❯ src/client/components/ReleasesPage.shadow-accept.render.test.ts:261:43
    259|     await mount();
    260|     expect(acceptButton()!.disabled).toBe(false);
    261|     expect(q('[data-shadow-accept-reason]')!.getAttribute('title')).to…
       |                                           ^
    262|   });
    263|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/10]⎯
 FAIL  src/server/fs/watcher.fs.test.ts > M40 — fs provider behaviour > [section:c38qf5p5] an operation suppression swallows the provider’s add, change and unlink of its paths
AssertionError: expected false to be true // Object.is equality
- Expected
+ Received
- true
+ false
 ❯ src/server/fs/watcher.fs.test.ts:191:53
    189|     // The control: a path outside the operation dispatches as usual.
    190|     fs.writeFileSync(path.join(dir, 'c.md'), 'unrelated\n');
    191|     expect(await until(() => log.includes('c.md'))).toBe(true);
       |                                                     ^
    192|     await new Promise((res) => setTimeout(res, 400)); // let any strag…
    193|     expect(log).toEqual(['c.md']);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [ac:ac-porazka-po-scaleniu-a-przed-utworzeni] a failure after the merge and before the release, with no other writes meanwhile, leaves HEAD as before the call — and the mutex and the lock are released (a second call succeeds)
AssertionError: expected 'ACCEPT_ABORT_FAILED' to be 'ACCEPT_FAILED' // Object.is equality
Expected: "ACCEPT_FAILED"
Received: "ACCEPT_ABORT_FAILED"
 ❯ src/server/routes/shadow-accept.test.ts:798:48
    796|     const res = await accept();
    797|     expect(res.status).toBe(500);
    798|     expect((res.body as ErrorBody).error.code).toBe('ACCEPT_FAILED');
       |                                                ^
    799|     expect(await head()).toBe(headSha);
    800|     expect((await git(['symbolic-ref', 'HEAD'], dir)).trim()).toBe('re…
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [ac:ac-porazka-po-scaleniu-a-przed-utworzeni-2] a failure after the merge and before the release, with no other writes meanwhile, leaves the index as before the call
AssertionError: expected '100644 71f6421d4c1523dc93137e6d0eba7c…' to be '100644 71f6421d4c1523dc93137e6d0eba7c…' // Object.is equality
- Expected
+ Received
  100644 71f6421d4c1523dc93137e6d0eba7c3768b3f219 0	.claude4spec/config.json
- 100644 d2a87f12a5100aa47a3a8e26e5e129244efa033b 0	.claude4spec/entities/endpoint/e1.json
+ 100644 899db914e65ba8cf83a514961b9fccec6f606d7c 0	.claude4spec/entities/endpoint/e1.json
- 100644 6b03d911c80abcb3566bbddf37802d54c3ef3167 0	.claude4spec/entities/endpoint/e2.json
+ 100644 de4bab4b63bb466b5ae0243bc4244a36767a52ca 0	.claude4spec/entities/endpoint/e3.json
  100644 8398e54e3351b8d1d163ef6d2a135cf6e3c12b25 0	.claude4spec/releases/v0.json
- 100644 16c61b2ea2dd69360b3f3fae5d31060d200c726c 0	pages/a.md
+ 100644 fa1e3ca88275cf4d58d669a0ece3385ca58c8a9b 0	pages/a.md
- 100644 614a421c174bae18674c7736fa78ed90bd2e9a3b 0	pages/b.md
+ 100644 614a421c174bae18674c7736fa78ed90bd2e9a3b 0	pages/b.md
+ 100644 23aec3b600b59705a71642865f6bafb05cf386c0 0	pages/c.md
 ❯ src/server/routes/shadow-accept.test.ts:815:53
    813|     failChainOfA();
    814|     expect((await accept()).status).toBe(500);
    815|     expect(await git(['ls-files', '--stage'], dir)).toBe(before);
       |                                                     ^
    816|     expect(await git(['diff', '--cached', '--name-only'], dir)).toBe('…
    817|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [ac:ac-porazka-po-scaleniu-a-przed-utworzeni-3] a failure after the merge and before the release, with no other writes meanwhile, leaves the registry roots in the working tree as before the call
AssertionError: expected { …(8) } to deeply equal { Object (pages/a.md, pages/b.md, ...) }
- Expected
+ Received
@@ -1,23 +1,23 @@
  {
    ".claude4spec/entities/endpoint/e1.json": "{
    \"slug\": \"e1\",
-   \"summary\": \"v1\",
+   \"summary\": \"v2\",
    \"createdAt\": \"2026-01-01T00:00:00.000Z\",
    \"updatedAt\": \"2026-01-01T00:00:00.000Z\",
    \"payloadVersion\": 1
  }
  ",
-   ".claude4spec/entities/endpoint/e2.json": "{
-   \"slug\": \"e2\",
-   \"summary\": \"keep\",
+   ".claude4spec/entities/endpoint/e2.json": null,
+   ".claude4spec/entities/endpoint/e3.json": "{
+   \"slug\": \"e3\",
+   \"summary\": \"fresh\",
    \"createdAt\": \"2026-01-01T00:00:00.000Z\",
    \"updatedAt\": \"2026-01-01T00:00:00.000Z\",
    \"payloadVersion\": 1
  }
  ",
-   ".claude4spec/entities/endpoint/e3.json": null,
    ".claude4spec/releases/v0.json": "{
    \"name\": \"v0\",
    \"slug\": \"v0\",
    \"description\": \"Baseline\",
    \"createdAt\": \"2026-10-24T21:29:37.963Z\",
@@ -28,13 +28,16 @@
  }
  ",
    ".claude4spec/releases/v1.json": null,
    "pages/a.md": "# A
- A one
+ A shadow
  ",
    "pages/b.md": "# B
  B master
  ",
-   "pages/c.md": null,
+   "pages/c.md": "# C
+
+ C shadow
+ ",
  }
 ❯ src/server/routes/shadow-accept.test.ts:825:28
    823|     expect((await accept()).status).toBe(500);
    824|     const after = await repoState();
    825|     expect(after.worktree).toEqual(before.worktree);
       |                            ^
    826|     expect(after.status).toBe(before.status);
    827|     expect(after).toEqual(before);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [ac:ac-nieudany-zapis-pliku-wydania-przy-prz] a failed write of the release file during the acceptance leaves HEAD as before the call — no release, no file, no cache row
AssertionError: expected 'ACCEPT_ABORT_FAILED' to be 'ACCEPT_FAILED' // Object.is equality
Expected: "ACCEPT_FAILED"
Received: "ACCEPT_ABORT_FAILED"
 ❯ src/server/routes/shadow-accept.test.ts:839:48
    837|     const res = await accept();
    838|     expect(res.status).toBe(500);
    839|     expect((res.body as ErrorBody).error.code).toBe('ACCEPT_FAILED');
       |                                                ^
    840|     expect((res.body as ErrorBody).error.message).toContain('injected …
    841|     expect(await head()).toBe(headSha);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [ac:ac-po-nieudanym-przyjeciu-liczba-wierszy] after a failed acceptance the number of unreleased file_version rows of the merged pages is what it was before the call
AssertionError: expected { a: 1, c: 1 } to deeply equal { a: +0, c: +0 }
- Expected
+ Received
  {
-   "a": 0,
-   "c": 0,
+   "a": 1,
+   "c": 1,
  }
 ❯ src/server/routes/shadow-accept.test.ts:855:78
    853|     });
    854|     expect((await accept()).status).toBe(500);
    855|     expect({ a: unreleasedPageRows('a.md'), c: unreleasedPageRows('c.m…
       |                                                                              ^
    856|     expect(dbState().fileVersions).toEqual(dbBefore.fileVersions);
    857|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [ac:ac-nieudane-przyjecie-cienia-dodajacego] a failed acceptance of a shadow adding a page leaves no delete row for that page
AssertionError: expected '# C\n\nC shadow\n' to be null
- Expected:
null
+ Received:
"# C
C shadow
"
 ❯ src/server/routes/shadow-accept.test.ts:865:32
    863|     });
    864|     expect((await accept()).status).toBe(500);
    865|     expect(read('pages/c.md')).toBeNull();
       |                                ^
    866|     expect(pageRows('c.md').filter((r) => r.op === 'delete')).toEqual(…
    867|     expect(pageRows('c.md')).toEqual([]);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [ac:ac-po-nieudanym-przyjeciu-entity-version] after a failed acceptance entity_version has no new rows for the entities the shadow changed
AssertionError: expected { slug: 'e1', summary: 'v2', …(3) } to match object { summary: 'v1' }
(4 matching properties omitted from actual)
- Expected
+ Received
  {
-   "summary": "v1",
+   "summary": "v2",
  }
 ❯ src/server/routes/shadow-accept.test.ts:879:38
    877|     expect({ e1: entityRows('e1'), e2: entityRows('e2'), e3: entityRow…
    878|     // The rollback's chains brought the index back with the files.
    879|     expect(index.get('endpoint/e1')).toMatchObject({ summary: 'v1' });
       |                                      ^
    880|     expect(index.has('endpoint/e2')).toBe(true);
    881|     expect(index.has('endpoint/e3')).toBe(false);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/10]⎯
 FAIL  src/server/routes/shadow-accept.test.ts > M17 shadow acceptance — POST /api/shadow-accept (2.1.47) > [section:wh8x023p] a refused release transaction removes the written release file and its cache row, then rolls the merge back
AssertionError: expected 'ACCEPT_ABORT_FAILED' to be 'ACCEPT_FAILED' // Object.is equality
Expected: "ACCEPT_FAILED"
Received: "ACCEPT_ABORT_FAILED"
 ❯ src/server/routes/shadow-accept.test.ts:893:48
    891|     const res = await accept();
    892|     expect(res.status).toBe(500);
    893|     expect((res.body as ErrorBody).error.code).toBe('ACCEPT_FAILED');
       |                                                ^
    894|     expect(read('.claude4spec/releases/v1.json')).toBeNull();
    895|     expect(await repoState()).toEqual(before);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/10]⎯
 Test Files  3 failed | 567 passed (570)
```

Relevant stderr: the env's git is 2.39.5 ('git merge --abort' / reset --merge semantics of that version). The u2 abortMerge unit tests passed there; the failures are in the acceptance rollback path.
