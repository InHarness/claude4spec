# Review u3-m17-chain-accept — non-blocking findings

- **rev-0001** `src/server/services/release-shadow-diff.ts:93` — reuse `RUN_RECORD_FILE` (run-read.ts) and `RUN_ID_PATTERN` (run-id.ts) instead of redeclaring them. Sent back for a fix (the user's "fix and continue").
- round 2: rev-0001 fixed (RUN_RECORD_FILE reused; isRecordDirName kept on purpose, decisions.md); no new findings.
