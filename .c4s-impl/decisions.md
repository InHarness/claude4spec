# Decisions

## Set-up — entity parts (2026-10-13)

- `katalog-operacji-m52` (spreadsheet) — built: all data rows (2–4), key = operation name. Each row is an operation the system registers (channels, effects, guard, error codes); a structure built in code. Only row 3 (`fork_writing_style`) changes in this window.
- `wklad-do-edytora-m52` (spreadsheet) — built: data row 2, key = Nazwa (`spec-skills`). The row is a command-source registration for the chat-input context; its Uwagi column states the item shape (label `/<slug>`, description from listing, no title).
- `moduly-feature` (convention, system verifier) — context, all; no unit owns a user job (jobs[] empty), as in previous loops.

## Set-up — build choices

- `ask` rows answered as in the three previous loops (user's standing rule: tests only in env-runner): suite = env-runner full `npm test` + `npm run test:e2e` at system verification; filtered = static verification + `npm run typecheck`; waiting → the user in this session via stdout. Overrides carried over: packetKB 200, gates [].
