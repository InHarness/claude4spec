## u4-m52-potwierdzanie-podpiec — review round 1 (non-blocking, sent back for a fix)

- **rev-0001** `src/client/components/spec-skills/specSkillsSettings.tsx:182`: overlapping Confirm clicks on two rows lose the first confirmation (PUT replaces the list whole, body built from stale cached rows). Fix: disable all Confirm actions while one is in flight, or queue onto the latest list.
- round 2 (fix only): rev-0001 resolved, no new findings.
