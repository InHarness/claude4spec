# Review u4-m55-run-continuation — non-blocking findings

- **rev-0001** `src/server/runs/run-remote.ts:500` — parent record reader duplicates `run-read.ts` (parseRecord/recordFilePath/readRecord); share one reader. Sent back for a fix.
- **rev-0002** `src/server/runs/run-remote.ts:52` — header comment out of date (step 7 INSERT, 4xx/network sentence split). Sent back for a fix.
- round 2: rev-0001 (shared Run record reader in run-read.ts) and rev-0002 (header comment) fixed; no new findings.
