# Decisions

## Set-up — entity parts (2026-10-13)

- `katalog-operacji-m52` (spreadsheet) — built: all data rows (2–4), key = operation name. Each row is an operation the system registers (channels, effects, guard, error codes); a structure built in code. Only row 3 (`fork_writing_style`) changes in this window.
- `wklad-do-edytora-m52` (spreadsheet) — built: data row 2, key = Nazwa (`spec-skills`). The row is a command-source registration for the chat-input context; its Uwagi column states the item shape (label `/<slug>`, description from listing, no title).
- `moduly-feature` (convention, system verifier) — context, all; no unit owns a user job (jobs[] empty), as in previous loops.

## Set-up — build choices

- `ask` rows answered as in the three previous loops (user's standing rule: tests only in env-runner): suite = env-runner full `npm test` + `npm run test:e2e` at system verification; filtered = static verification + `npm run typecheck`; waiting → the user in this session via stdout. Overrides carried over: packetKB 200, gates [].
- 2026-10-13 — baseline (startMode resume): tests never run locally; main @ 7e81a22e is the merge of PR #268 whose env-runner system verification reported `npm test` 5588/5588 green (c6bcc31b). baselineGreen = true on that evidence; the full suite runs once in env-runner at system verification.

## m02-frontmatter-tolerant-read/p1-l4-l5

- The tolerant read (`splitMarkdown` → `frontmatterRaw`), the editor's literal save (`pageWritePayload`) and the route already existed (2.1.9, dev-0801, M52 criteria). This portion adds what the window's `page-detail` DTO names and the code lacked: the required `title` field (label chain `frontmatter.title` → first H1 → `path`, M02 `xlx33i1v`), so a broken header labels from the H1.
- The write-back after a save (`m06-anchor-injection`: `SectionIndexerService.mintAnchors` on page roots, `artifactAnchorInjectionSubscriber` on plans) re-wrote `{ frontmatter: page.frontmatter, body }` — for a broken header that is `{}` plus the body, which dropped the block on any `pages` root as soon as a heading lacked an anchor. Both now write `frontmatterRaw + body` literally when the read carried `frontmatterRaw`, so the editor's save keeps the block byte for byte through the whole chain, not only at the route.

## m02-tree-create-button/p1-l4-l5

- The `+` at the PAGES header already created in the base root (App's `handleNewPage`, 0.2.101). The flow moved into one hook, `src/client/hooks/useNewPageAction` (`src/client/hooks/useNewPage.ts`), used by the Sidebar's `+` directly and by App for the `c4s:new-page` event, so the criterion is testable through the real button: `src/client/components/Sidebar.tree-create.render.test.ts`. Sidebar's `onNewPage` prop removed.
- Row menu: the code already had Rename only (no New page / New folder / Delete existed), but `.html` rows still had the `…` trigger and menu, and the menu opened only from `…`, not on right click. Now: `.md`/`.mdx` rows open the Rename-only menu on right click and from `…`; `.html` rows and folders have neither. The stale `ASSUMPTION:dev-0802` comment on `TreeAccordion` was replaced.
- No server change: `POST /api/pages/:rootId` already creates parent folders with the page (folder appears with its first page).

## m01-skills-root-collision/p1-l13-l13

- The refusal itself already existed: `parseRootsArray` refuses `id: skills` on read (D4 rule 6), and the context build refuses a user `dir` at or under `.claude4spec/skills` via `validateRootDirs` (D4 rule 3). What did not hold was "the loader migrates nothing": `migrateConfigToV4` validated types only (not the overlap) before writing, and `migrateConfigToV3` validated nothing — so a legacy file with a colliding entry was rewritten (format bump, `port`/`mode` stripped) before the start failed. Both migrations now pass one gate, `assertMigratable` in `src/server/config.ts` (type validation + overlap over the file's `roots[]`), before any write; a colliding file fails with the same D4 error and stays byte for byte.
- Tests on the real start path (`buildProjectContext`, `bootstrapProject`) plus each migration alone: `tests/integration/api/skills-root-collision.test.ts`. Fixtures carry legacy keys so the migrations WOULD write without the collision (a control case proves it).

## ask-answer-postprocessing/p1-l3-l4

- The post-processing already existed (2.1.9, `src/server/services/ask-answer.ts`, called from `POST /api/threads/:id/ask` for `context_type === 'ask'` only, after the turn and before the response; the persisted `chat_message` is written inside `runAgentTurn` and never touched). This window makes it a guarantee of the operation (M05 `za3t91al`) and adds two things the code did not hold literally:
  - order: step 1 (the plan line) now runs before step 2 (the directory scrub), as the section numbers them — `appendPlanLines` then `scrubProjectDir`. The result is the same for every answer (a plan named by its absolute in-project path already contains its relative path), but the code now reads as the spec does;
  - outside paths: the scrub only rewrites the project directory where it STARTS a path (lookbehind: not preceded by a path character), so an absolute path outside the project that merely contains the directory's spelling (`/mnt/backup<dir>/x`) passes unchanged, as `ac-sciezka-bezwzgledna-spoza-katalogu-pr` requires; siblings like `<dir>-old` were already left alone.
- The old `[ac:ac-answer-tury-ask-nie-zawiera-sciezki-b]` test asserted that NO absolute path survives anywhere — the title narrowed in this window to the project directory only (outside paths pass), so that assertion was replaced by exact-output assertions over both spellings (given and `realpath`).
- `c4s-tools-ask` changed only its `returns`; the tool passes the peer's answer through, so its entity test pins the verbatim pass-through of a closing `Plan:` line.
