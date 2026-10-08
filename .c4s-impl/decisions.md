# Decisions

Implementation-only decisions (no user-observable effect) and set-up choices.

## Set-up (2026-10-08)

- Brief: `2-1-8-to-2-1-9-workflow-3.md` (app-spec / default, 2.1.8 → 2.1.9). Only this brief is implemented; the other two 2.1.8→2.1.9 briefs are ignored (the user deletes them). Only workflow-3 will be marked implemented.
- `c4s get-brief` truncates this brief at the response budget; it was read whole with `--range`.
- Tests: never run locally (user rule). `tests.suite` = full `npm test` + `npm run test:e2e` in an env-runner environment, once, at system verification. `tests.filtered` = static verification: read the test bodies and run `npm run typecheck` only.
- Red baseline: skipped (no local suite run is possible under the rule above); the env-runner run at the end is the baseline + final check together. Failures there claimed "pre-existing" are proven against an env built from `main`.
- Gates: only the always-on ones. Review per unit, reviewer same-harness, no verifier tools, startMode resume (delta window).
- Next-window gate acknowledged up front: briefs 2.1.9→2.1.10 and 2.1.10→2.1.11 already exist; the loop does not stop on them.
- `resume()`'s `done` does NOT call `c4s mark-brief-implemented`: the brief is marked only after the PR is merged (user decision), followed by full cleanup.
- `package.json` stays at 2.1.11 (to_release 2.1.9 would be a downgrade).
- `.c4s-impl/` is excluded in the repo's `.git/info/exclude`; it is committed with `git add -f` (packets/ excluded by pathspec).

## Entity types (user-confirmed)

| type | role | checks | links | inactive | v |
| --- | --- | --- | --- | --- | --- |
| ac | criteria | verifies | verifies | status = deprecated | 3 |
| mcp-tool | built | | | | 1 |
| endpoint | built | | linkedDtos[].dto | | 3 |
| dto | built | | | | 2 |
| code-snippet | built | | | | 1 |
| spreadsheet | per-entity (each sheet classified from its content) | | | | 3 |
| module-dependency | context | | | | 1 |

## Entity parts (spreadsheets, classified at 2.1.9)

- `wklad-do-edytora-m05` — built, all data rows, key `Nazwa`: rows are editor contributions M05 registers.
- `wklad-do-edytora-m20` — built, all data rows, key `Nazwa`: rows are TipTap extensions M20 registers.
- `wklad-do-edytora-m52` — built, row `spec-skills`, key `Nazwa`: the command source M52 registers in `chat-input`.
- `znaczniki-xml-m52` — built, row `skill_ref`, key `Znacznik`: the XML tag M52 registers.
- `katalog-operacji-m52` — built, all data rows, key = operation name: L3 operation catalog entries; rows land per unit (`update_skill_file` u07, `list_exposed_projects` u11, `fork_writing_style` u12).
- Baseline (static): `npm ci`, `build:envelopes` and `npm run typecheck` green in the worktree at 30308bd.

## Loop decisions

- (u01 split, 2026-10-08) `reading-the-spec.md`'s read problem "active criterion with an empty `checks` field → blocking clarification" misfires on this specification: ≈103 of the 129 ACs the recipes name have an empty `verifies`, so it would block every unit. Replaced for this build by a bounded rule (appended to the implementer/verifier/verifier-system prompts): such an AC checks its own title/description against its unit's page sections, like a `criteria` item of a `per-entity` part. No product-observable effect; no patch per AC. To be fixed in the skill itself (rule over exception).

## u01-root-facades / p1-l3-l13 (implementer)

- The kind registry stays the `KIND_DECLARATIONS` record; "registration order" of kinds = its key order. `SYSTEM_ROOT_KINDS` is now derived from it (`source: 'code'`), so reserved ids (`isSystemRootId` reads `SYSTEM_ROOTS`), fixed dirs and bootstrap's system dirs follow the declarations. A system root's `name` is its kind capitalised (no new declaration field — keeps the declaration objects' shape, which several tests pin with `toEqual`).
- `sidebar` is typed `'hidden' | 'accordion' | SidebarReducer` (`{ glob, reduce }`); helpers `kindHasFacade`, `sidebarReducerOf`, `accordionCase`, `enforceAccordionRules` live in `src/shared/root-kinds.ts`. No kind declares a reducer yet (u05 adds `skills`); tests put one on a kind temporarily.
- Facades: `mountRegistryRoots` builds `PagesService` for every kind whose `sidebar` is not `hidden`; `RootRuntime` gained `kind`; a code-source root's facade record is `{ id, name, dir, builtin }`. A kind can be both an artifact mount and a facade. The boot `file_version` baseline over facades is gated on `m17-capture` and skips artifact roots (they have their own pass).
- Source names (L13 step 1): config source → `pages:<id>`; code source → the kind's name, except plans/briefs/patches → `artifacts:*` (`sourceNameFor` is now generic; `rootIdFromSource` maps a code-source kind name back to its id).
- Sidebar reducer: `SidebarAccordionsService` (src/server/services/sidebar-accordions.ts) is both the cache/`listAccordions()` and the `m02-sidebar-reducer` handler (`CoreReactionContext.sidebarReducer`, optional; binding without it throws). "Different from the previous array, also after a context rebuild" is kept in a process-level map keyed `(projectId, rootId)`; the first computation in a process emits nothing (no previous array). The context build runs `rebuildAll()` fire-and-forget after binding.
- `PagesService.listTree` uses the root kind's file map (`store.kind ?? 'pages'`).
- Client landing (`4dcvgivu`): the remembered root must be a registry root with a facade (`registryList(roots)` + `kindHasFacade`).

## u02-references-expansion / p1-l7-l13 (implementer)

- Expansion core: `expandEmbeds(text, ctx, { format, source? })` in src/core/references/expand-embeds.ts (serverless; types in src/core/references/types.ts). Its only reach into project state is `ExpansionContext` (reader by slugs + projection, listing by tags, section heading, page links + page title). The server builds one per project with `createExpansionContext({ discovery, sections, links })` (src/server/discovery/expansion-context.ts) over that project's discovery core (`getEntitiesAll` / `listEntitiesAll`), `SectionsService.getByAnchor` and the page-link indexer (`resolve` + `getFileMeta`). Not wired into any caller yet — `c4s resolve` (M11) and the `project-exposed` skill source (M52) belong to other units.
- Inline rendering choices (no product contract beyond "link / block / table"): mention → `[title](href)` (plain title if no href); card → `**title** (type \`slug\`)`, optional italic caption, then `- **field**: value` per record field (slug/title/href skipped, non-strings JSON); lists → `| Title | Slug |` table, mixed list adds a `Type` column. Both formats return `resolved[]`; `json` returns the original text.
- A tag is left unchanged (with `error`) when any of its slugs is broken (an `element_list` with one missing slug stays whole); an unknown `section_ref` anchor and an unresolved `@`/`[..](..)` page link likewise. An unresolved backtick path is code, not a link — ignored, no error. A page link carrying `#anchor` is still replaced by the page title (spec: "link do strony → tytuł strony").
- Tags inside a leading frontmatter block are not expanded (the block returns byte-identical); anchor lines are HTML comments, never touched.
- find_references: a hit gets an `anchor` only when its root's kind selects `m06-anchor-injection` (`RootSet.anchorInjected()`), on top of the existing `unindexedRootIds` gate.
- check_consistency: rules 15/16 rows renamed `path` → `pagePath` (section-indexing.test.ts updated); rule-11 row gains `rootId` + `pagePath` (first matching module page of the builtin root). See dev-0201 for the bucket names left as shipped.
