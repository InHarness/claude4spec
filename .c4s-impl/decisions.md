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
