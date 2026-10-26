# Decisions

## setup
- entityTypes carried over from the 2.1.48→2.1.49 loop where the type recurs (`ac` criteria/unit, `dto` and `code-snippet` built; catalog payload versions unchanged: ac 3, dto 2, code-snippet 1), with `inCode`/`verify` re-aimed at this window's code (project config schema/loader + config routes). No `per-entity` types → no entityParts. Approved by the user with the plan.
- conventions: L5 §1–2, L17 §1–2, modules table `pages/SKILL.md` §12–14 — one line per section. The spec has no user-jobs table → `jobs: []` everywhere; the system verifier works from the units' criteria and goals.
- recipe pages: a non-contiguous change range ("sections 4, 7") is split into one page entry per contiguous range; context ranges are separate context-only entries of the same key.
- release.json: the `ask` rows answered as in 2.1.48/2.1.49 (user confirmed with the plan): tests only in env-runner (full `npm test` + `npm run test:e2e` once, at system verification), filtered = static reading + `npm run typecheck`, waiting recipient = the user in this session. startMode `resume` (delta window).
- baseline: the branch starts at main 709fe4c4, whose tree is the 2.1.48→2.1.49 branch verified in env-runner today (b11171ed: npm test 6891/6891, e2e seed-only failures) plus the removal of `.c4s-impl/` and the root version bump → baselineGreen without a new env run (tests never run locally).

## u1-elements-menu-config/p1
- Load-time handling of `elementsMenu` in u1 is TOLERANCE only: the loader (`src/server/config.ts` `parseElementsMenu`) enforces rule 1 (shape — hard load error) and keeps the list as the file holds it; it does not drop duplicate types or empty/blank groups. Applying the normalization (first occurrence wins, groups with empty label/types treated as absent, groups without a visible member omitted) is the sidebar assembly's job and is deferred to u4-elements-slot per the recipe. GET /config therefore returns the file's list verbatim, so the u5 editor sees what the team saved.
- Save rules 2–5 live with the declarant (M13) in `entity-settings-fields.ts`; the PATCH rule also runs the shape parser, so every refusal of the key — shape included — is a 400 pinned to `elementsMenu`. Effect class `per-operation` (no context rebuild), resumeLock false, apiWritable true. Wire type `object` (the closed FieldType set has no array type; a non-array is reported by the stage-1 check or by the shape parser).
- `hidden` accepts only `true` (the declared type is `hidden?: true`).
