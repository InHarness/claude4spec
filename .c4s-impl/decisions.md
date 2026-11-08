# Decisions

- 2026-11-08 (setup): user jobs — the convention's "User jobs table" (`pages/SKILL.md` §12 `45yst8co`) at 2.1.74 is the "Moduły" prose section (module/layer layout), no user-jobs table → `units[].jobs = []` for every unit; the system verifier checks the window's criteria alone.
- 2026-11-08 (setup): entityParts — none; no recipe names a per-entity type.
- 2026-11-08 (setup): `m23-patch-applied-agent` recipe — the brief's m43 context range "sections 30–31 (`l3media0`, `rp99fpc1`)" reads back `rp99fpc1`, `l3route0` at 2.1.74; corrected to offset 29, limit 2, which matches the anchors. Reported as non-blocking deviation dev-0001.
- 2026-11-08 (setup): build settings reused from the previous loop (2-1-67-to-2-1-68) and approved by the user with the plan: tests never run locally (static verification + `npm run typecheck`), full `npm test` + `npm run test:e2e` only in env-runner at system verification; gates off.
- 2026-11-08 (baseline): baseline = `npm run typecheck` w worktree @ca76aaa2, zielony (exit 0, 0 błędów TS); pełny suite tylko w env-runnerze przy weryfikacji systemowej.
- 2026-11-08 (system verification 1, static @bbbfdf8a): wszystko covered poza `ac-attach-mode-c4s-agent-msg-ct-bri` (AC spoza okna wskazujące endpoint zmieniony w oknie; brak testu z tym slugiem) → reopen m11-agent-patch-thread z only=[ten slug]. Suite: env-runner w toku @bbbfdf8a.
- 2026-11-08 (system verification 1 fix): m11 — test `[ac:ac-attach-mode-c4s-agent-msg-ct-bri]` w run-agent.test.ts (attach POST /artifacts/brief/<p>/threads, potem POST /threads/<id>/ask), tylko test, bez zmian w kodzie; bez osobnej rundy weryfikatora/recenzenta jednostki — dowodem jest runda 2 env-runnera. Gałąź na origin → zwykły commit, bez squasha.
