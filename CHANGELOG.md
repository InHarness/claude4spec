# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Releases covered five entity types, not all of them.** A release snapshot iterated a hardcoded list that `design-system`, `diagram` and every plugin-contributed type were not among, so those entities were invisible in every release diff and unrecoverable from every release — while `restoreSpec` cheerfully restored types the snapshot had never captured. The covered types now come from the host registry. **No data was lost and none needs backfilling**: the `UPDATE entity_version SET release_id` that binds versions to a release was always untyped, so this history was captured and correctly bound all along and only the read path refused to look at it. Consequence: **past releases become complete retroactively** — design systems and diagrams appear in diffs that previously showed nothing for them, which can look like data materialising out of nowhere. Relatedly, the ordering of `snapshot.entities[]` (and so of `GET /api/releases/:id/snapshot` and the UI diff list) now follows each type's `displayOrder`.
- **Design systems and diagrams never reached a release bundle.** The archive's singular→plural file-name map was hand-written and had no entry for them, and the writer skips a type it cannot name — so they were dropped from every bundle, and therefore from every export, clone and push, in silence. File names now derive from the module's own `pathPrefix`, which reproduces all five pre-existing names exactly (`endpoints.json`, `dtos.json`, `ui-views.json`, `acs.json`, `database-tables.json`), so **existing bundles remain readable with no compatibility shim**.
- **Restoring a bundle silently dropped rows it had just validated.** `restoreBundleArchive` checked every entity file against the active type set and then iterated a *different*, hardcoded order — so a bundle carrying any type outside that list passed validation and was then never restored. It now uses the declared `dependsOn` order over active modules, the same one `restoreSpec` has used since 0.2.2.
- **Version restore refused every plugin-contributed type** with `type '<x>' is not restorable`, on no basis beyond a seven-literal predicate. Likewise, the entity store wrote a plugin type's file to disk but did not recognise it on read back, and AC analysis classified every verify pointing at one as `unknown-type`.
- **13 `c4s` commands were unusable for plugin types.** The eager `--type` check tested membership of a five-literal list, before a project (and therefore any registry) was open. It now validates only that the argument is shaped like a type id; existence is answered by the discovery core, which reports the project's real type list.
- **Client gaps from the same cause.** The XML-chip popovers offered exactly three entity types, so `ui-view`, `ac`, `design-system`, `diagram` and every plugin type were unreachable from the editor. A `tag:changed` event invalidated three hardcoded lists, leaving every other entity list showing stale tags. A deleted `ac`/`design-system`/`diagram`/plugin entity rendered as a raw JSON dump instead of a card, in the view whose purpose is explaining what was deleted.
- **A config the loader rejects can now be repaired instead of stranding the project.** `roots[]` entries are validated strictly (no field defaults at load time), so a `config.json` written before a root field existed failed to open — and the migration that would have fixed it ran *after* the validating load, i.e. never. Migrations now run before the load, and on project activation rather than only at bootstrap, so a workspace's other projects get the same repair as the one the server was started on. Only ABSENT behaviour flags are filled: identity (`id`, `name`, `dir`) is never invented, because a fabricated `dir` would silently point a root at a directory nobody chose instead of reporting the missing field. The file is validated before it is written, so a config the repair cannot complete is left untouched rather than half-rewritten, and a `config.json` from a NEWER schema version is refused rather than stamped back down to v4.
- **A legacy `git.syncCommitOnRelease` is carried onto `git.enabled` instead of being dropped.** The key predates the `enabled` master switch, so projects that had commit-on-release lost it silently when `enabled` arrived defaulting to `false`. The migration restores that intent (an explicit `enabled` always wins) and logs a line when it does — `enabled` is the master switch, so a project whose repo starts taking commits again can see why.
- **The subagent tool renders under both its names.** Claude Code v2.1.63 renamed `Task` → `Agent`; the SDK emits `Agent` in `tool_use` blocks while `system:init` still reports `Task`, and the renderer registry is an exact-name lookup — so every `Agent` call fell back to the generic tool card.
- **A full index rebuild no longer wipes every tag assignment.** `indexAll()` used to empty the `tag` registry along with the other derived tables; because `entity_tag.tag_slug` is a real foreign key with `ON DELETE CASCADE`, that swept **all** assignments in the project — for active, inactive and out-of-scope types alike — a few statements after the assignment clear had run correctly. The registry is now RECONCILED against `tags.json` (upsert what the file lists, delete only the slugs that left it), so the cascade fires only for tags genuinely removed, and the assignment clear is scoped to the types the rebuild will refill. A deactivated type keeps its tag assignments across a rebuild instead of losing them silently. An empty `tags.json` is not treated as authority to empty the registry.
- **A partial update no longer takes `createdAt` from the derived index.** The entity file is the source and the SQLite row is its projection; the update path read `created_at` off the row it had just selected, so once the two disagreed the following `persist` wrote the divergence back into the file. `createdAt` now comes from the existing entity file, with the row kept only as a fallback for a mutation with no file behind it. Unreachable through `snapshot → restore → snapshot`, which never assembles an object from a delta.
- **`list_tags` counts only ACTIVE types.** The counts always described themselves as a product of tags by *active* types, and `GET /api/tags` filtered accordingly, but the discovery-core query did not — previously masked because a rebuild left a deactivated type no rows to miscount. `--co-occurring-with` is scoped the same way.

### Added
- **The `c4s` CLI reaches every discovery-core operation.** Ten new commands — `get-entities`, `list-entities`, `list-pages`, `list-sections`, `get-sections`, `get-page`, `search-pages`, `search-entities`, `check-consistency`, `resolve-identity` — make the path from a phrase to a section's text walkable with no server running: `search-pages` returns hits carrying an `anchor`, `list-sections --by anchor` measures the subtree, `get-sections` fetches several bodies in one call. Pages are addressed by the full `(rootId, path)` key (`--root-id` is required, with no fallback to the built-in root); sections are addressed by `anchor` alone and take no root. Every list command accepts `--limit`/`--offset` and reports `total` + `hasMore`.

### Changed
- **BREAKING: the `database_table` / `ui_view` underscore spellings no longer resolve.** The CLI, the `c4s-reader` MCP, **and XML tags in existing pages** accepted `database_table` as an alias for `database-table`. An entity type id is always kebab-case, so that spelling is malformed rather than alternative — and no other type received the courtesy. **Pages are affected**: a tag already authored as `<single_element type="database_table" slug="…"/>` now resolves to `unknown type` and renders as an unresolved tag instead of an entity card, in the page, in MCP `get_page` output and in the editor. Nothing rewrites those tags automatically — search your spec repo for `type="database_table"` (and any other underscore spelling) and change it to the kebab-case id. `c4s catalog` lists what a project has.
- **BREAKING: `release_get` / `release_diff` accept any entity type in `entityTypes`.** The argument was a closed five-value enum that rejected anything else at the MCP boundary, so a caller could not ask about a design system, a diagram or a plugin type even once releases began covering them. An unknown type is no longer an error — it simply matches nothing. The empty-array and `entityTypes`-without-`entities` refusals are unchanged.
- **BREAKING: the bundle schema version moves to 3.** `entities/` now carries one file per active entity type (derived from each module's `pathPrefix`) instead of the five a static map allowed, so a bundle written by 0.2.11 can contain `design-systems.json`, `diagrams.json` or a plugin type's file. A pre-0.2.11 reader cannot map those, so the version had to move: an older installation receiving such a bundle (via `release_push`, `c4s clone` or a restore) now fails with `BUNDLE_SCHEMA_UNSUPPORTED`, naming the version skew, rather than aborting on the first unrecognised file and blaming the archive. **Reading v1 and v2 bundles is unaffected** — the derivation reproduces all five historical names exactly.
- **Importing a bundle now refuses a type that is installed but deactivated locally.** Previously unreachable, because the static map never wrote a file for `design-system`, `diagram` or any plugin type; now that it does, `restoreBundleArchive` reports `BUNDLE_UNKNOWN_ENTITY_TYPE: entity type '<x>' is not active locally`. This is deliberate rather than a skip — the alternative is dropping every row of that type from the restore without saying so, and a half-restored spec is worse than a refused one. Activate the type in `config.entities` to import. Note the previous behaviour was not "it worked": those entities were silently absent from the bundle entirely.
- **`database_table` leaves the host's baseline schema.** It was the last entity table the baseline created without owning — grandfathered because the type comes from an external plugin — and the schema-ownership collision exemption that existed solely to excuse it is gone with it. The table now comes from the plugin contributing the type, generated from its `data.schema` like every other entity table. **Existing databases are unaffected** (nothing drops the table); a fresh database without that plugin installed simply has none.
- **The host no longer holds a static entity-type vocabulary.** `RawEntityType` and `EntityType` are plain strings; the type→table map, the "all types" list, the `isRawEntityType` predicate, the store's directory list and the nine `DatabaseTable*` interfaces are all deleted. Which types exist, and what backs one, are answered by the registry. `RawEntityReader` now requires a host: it was optional only so a host-less reader could fall back to the static map, and without it such a reader cannot answer truthfully. Two architecture gates keep the release tier and the MCP release tools at exactly zero entity-type literals.
- **BREAKING (`c4s find-references`): the payload is the core's `{ references, total, hasMore }`** instead of a bare JSON array, and each hit carries `rootId` (and `anchor` where the position falls inside an indexed section). The transport projection is gone — MCP and the CLI now hand back the core envelope unchanged, because a page is keyed by `(rootId, pagePath)` and a projection dropping the root makes two hits from different roots indistinguishable. The sweep is still exhaustive and still refuses `--limit`/`--offset`, so `hasMore` is normally `false`; it is reported rather than hardcoded so a sweep stopped by the helper's runaway guard cannot claim it ran to the end. REST `GET /api/references` keeps its historical projection (`raw`, no `via`), and the external `c4s-reader` MCP keeps calling the collection `items`.
- **BREAKING (`c4s describe`): the payload is the core's `{ types: [ … ] }`** instead of a bare `{ version, views, schemas }`, and it gains `label` + `searchableFields`. The command had been calling the serialization registry directly, so it was the one discovery command answering differently from the MCP tool of the same name — and it could not say what a search would cover, which the `c4s-spec-reader` skill had documented for two releases. Consumers doing `c4s describe … | jq .schemas` must read `.types[0].schemas`.
- **BREAKING (`c4s list-tags`): the payload is the paginated `{ items, total, hasMore }`** instead of `{ tags: [ … ] }`, and per-type counts are now opt-in behind `--with-counts` (they are a product of tags by active types). Adds `--min-count` and `--co-occurring-with`. The command had been reading straight off the reader, so `list_tags`' pagination and flags were unreachable from the CLI.
- **BREAKING (`get_sections` / section `detail` view): `content_hash` is gone.** The response carries the content, so nothing is left for a version of it to settle. The hash remains on the `section_index` table and on `GET /api/sections` + `/api/sections/:anchor`, where it still drives change detection and cache invalidation.
- **`get_entities` no longer drops what it cannot afford.** It shares one budget branch with `get_sections`: every slug you name is answered, and rows past the response budget come back `entity: null` with `truncated: true` rather than vanishing (a vanished row read as "that entity does not exist"). The retry instruction moved from a per-result `truncationHint` to the envelope's `message`. The first item is never degraded. Host-side `getEntitiesAll` re-asks for truncated rows one slug at a time, so page rendering is unaffected.
- **An unknown `rootId` is `INVALID_ARGUMENT`** naming the roots that exist, not `PAGE_NOT_FOUND` — that code is now reserved for "the root exists, the path does not", which is the answer that authorizes a caller to stop looking.
- **`c4s find-references` has no page walk of its own**, consuming the same `src/core/references/` sweep behind MCP and REST, so the CLI answer equals the UI answer by construction. `--pages <dir>` still narrows the sweep to that one directory. Listing a page root no longer creates it: `PagesService.listMarkdownFiles()` returns an empty list for a missing directory instead of `mkdir`-ing it, so a `readonly-reader` command cannot write to the working tree.
- **Commands that do not paginate now refuse `--limit`/`--offset`** instead of ignoring them (`catalog`, `describe`, `get-entities`, `get-sections`; `--offset` on `check-consistency` and `resolve-identity`). A silently ignored flag leaves the caller believing the answer was scoped.

## [1.0.25] - 2026-07-10

### Added
- **Multiroot: `pagesDir` → `config.roots[]`.** Pages now live in any number of independently configured named roots instead of one fixed `pages` directory, each with its own lifecycle toggles (releasable, section-indexed, reference-validated, brief-target). Full UX to match: a root registry hub in Settings, a shared directory picker with a "Browse…" affordance (bounded to the project directory), per-root sidebar accordions, and root-aware navigation everywhere a page could be referenced (TODOs, section-ref chips, entity reference rows, the chat composer's "current page" chip). Brief generation can now be scoped to one or more roots — a picker in the "Generate brief" modal, `roots` frontmatter on the brief, and root-scoped `release_diff` calls in the brief-author prompt.
- **Git Sync (M28).** An opt-in `git.enabled` master switch turns on: a `releasesDir` for on-disk release-identity files, git-anchored (file-level) release diffs computed from actual commit history when two releases resolve to real commits, a sidebar Git-status badge with ahead/behind counts, and a Briefs section on `/releases` cards.
- **Consolidated entity CRUD onto one generic MCP server.** `entity-tools` (create/get/update/delete/list/search/describe_entity_type, type-parametrized) replaces six separate per-type MCP servers. Entity plugins move from imperative `backend.mount` to declarative `backend.{service,crud,routes,mcpServer}` slots, synthesized uniformly for built-in and external plugins.
- **Plugin version-diff surface.** Plugin authors get the same version-history + diff experience the host's own entity panels have: a new `GET /:type/:slug/versions/:from/diff/:to` route, a `useVersionDiff` hook, a `DiffView` UI-kit component, and a `VersionHistory` `timeline` variant with a "Compare to" affordance. `entity_version` capture is now generic for any active plugin type, not just the seven built-ins.
- **Host UI Kit growth (M34).** Two new groups — Overlay/Create (`Dialog`, `FormShell`) and Pickers (`EnumBadgePicker`, `GroupedRelationPicker`) — plus `Popover` (controlled), `ToastViewport`/`useToast`, `DocumentBody` and `DocEditor` (host-wired rich text with cross-entity mentions), a real rich-markdown `RichTextField` (was a `<textarea>` stub), and a `collapsed` `TagPicker` variant. `Popover`, `GroupedRelationPicker`, and `TagPicker` all gained an opt-in scrollable body with a pinned footer. Typography and layering tokens extended the color-only token bridge. All five built-in entity panels (dto/ac/endpoint/ui-view/design-system) now use the new components.
- **Agent filesystem path scoping.** `agent.allowedPaths`/`agent.disallowedPaths` narrow or widen a chat agent's filesystem access (deny > allow > cwd/pages default); Settings now shows the actually-probed enforcement strength (hard/soft/none) instead of a static claim.
- **`effort` pass-through.** An optional `low`/`medium`/`high` reasoning-level parameter on the headless agent turn, mirroring the existing `model` pass-through end-to-end (CLI `--effort`, MCP `ask`, `POST /api/threads/:id/ask`).
- **Portable, on-demand external skills.** `c4s install-skills` (CLI) and a Settings "Download ZIP" button replace the old bootstrap step that silently wrote skills to a location Claude Code never loaded. Generated `SKILL.md` files now carry a resolved `--project`/`--workspace` identity so they work correctly when copied into a different code repo. Also adds a generated `c4s-refactor` drift-router skill for reconciling spec and code.
- **Filesystem-only brief/patch CLI.** `c4s list-briefs`, `read-brief`, and `file-patch` resolve entirely through the workspace registry — no running server or SQLite required. New `c4s mark-brief-implemented` command flips a brief's `implemented` flag via the server.
- **`CliCommandContribution` registry** formalizes the `c4s` CLI's command contract (typed name/execution-mode/error-codes/handler) in place of a hand-written switch; adds `--model` to `c4s agent`/`c4s ask`.
- Project names now accept full Unicode (display-only; folder identity is unaffected) instead of being restricted to an ASCII-safe pattern.
- Projects are now keyed by a stored, immutable id minted at registration instead of a re-derived hash of the cwd — editing a project's directory no longer changes its URL, API prefix, database slot, or local storage scope.
- `--project <name>` on the CLI now falls back to matching a registered project's display name when no project exists at that literal filesystem path.
- Plan-anchor `section_ref` chips in chat replies now resolve to a working link instead of always rendering as broken (plan headings weren't reachable through the pages-only anchor lookup).

### Changed
- `search_entities`/`list_entities` no longer trust each entity type's `.search()` — several implemented it as a literal whole-phrase `LIKE` match that silently returned no results for ordinary natural-language queries. Search now correctly reports `searchSupported: false` so agents fall back to listing instead of trusting a false "no matches."
- User-authored skills under `.claude/skills`/`~/.claude/skills` are now re-scanned on demand (short TTL-coalesced) instead of only at server boot, so a new writing style is usable without a restart.
- `mcp__c4s-tools__ask` now defaults to the calling agent's own workspace instead of throwing `AMBIGUOUS_WORKSPACE` when a project is registered under more than one workspace.

### Fixed
- A long-running headless agent turn (undici's default 300s timeout) was being misreported as `SERVER_NOT_RUNNING` instead of a real timeout; interactive chat turns paused on a human tool-approval prompt no longer time out at all (previously unbounded, now explicitly so).
- Restoring a version that was captured as a delete tombstone crashed instead of routing through the entity's own delete path; a new project's id could collide with another project's id after a manual cwd edit; tag-creation idempotency failed on any casing/whitespace difference from the existing tag; restoring a version no longer left an open detail view showing stale data.
- The host now actually runs a plugin's declarative `backend.migrations` — previously parsed but never executed, so a plugin's own table was never created and any query against it failed with "no such table."
- The base-tier plugin hot-reload watcher resolved an ESM-only plugin package differently than bootstrap did, so edits to an ESM-only plugin required a full process restart instead of hot-reloading.

### Removed
- The short-lived M35 Progress view (route, endpoint, service, sidebar entry), added and removed within this same release window. Its useful parts — ahead/behind git status and a per-release brief list — were redistributed into the sidebar Git badge and the `/releases` cards instead.

[1.0.25]: https://github.com/InHarness/claude4spec/compare/v1.0.24...v1.0.25

## [1.0.24] - 2026-06-28

### Changed
- Pin the preinstalled `@inharness-ai/c4s-plugin-simple-database-tables` dependency to `^0.1.1`, which fixes the database-table list (its frontend now calls the project-scoped `/api/projects/<id>/database-tables` path instead of 404'ing on `/api/database-tables`). `^0.1.0` already resolved 0.1.1 on a fresh install; this makes the minimum explicit.

## [1.0.23] - 2026-06-27

### Fixed
- **Scoped plugin frontends 404'd → missing sidebar entry.** The frontend-manifest built asset URLs with a raw package name, so a scoped plugin (`@scope/pkg`) produced `/api/plugins/@scope/pkg/frontend.js` — an extra path segment the `/api/plugins/:name/:asset` route never matched. The preinstalled database-table plugin (`@inharness-ai/c4s-plugin-simple-database-tables`) loaded on the backend but its sidebar link vanished. The name is now percent-encoded into a single path segment (the route already decodes it).

## [1.0.22] - 2026-06-27

### Added
- **Published Host API types.** The CLI package now ships TypeScript declarations under type-only subpaths `@inharness-ai/claude4spec/plugin-runtime` and `@inharness-ai/claude4spec/plugin-runtime/ui`, plus an ambient binding (`@inharness-ai/claude4spec/plugin-runtime/ambient`) so a single reference types both the `@c4s/plugin-runtime` value specifier and all type names. Plugin authors reference the host's published types directly instead of vendoring a `c4s-runtime.d.ts` copy. `hostApiVersion` is unchanged — this is additive DX infrastructure. (brief 0.1.85→0.1.86)
- **Host UI Kit** (`@c4s/plugin-runtime/ui`, M34/L12) — a presentational component catalog delivered to plugins through the import-map shim: four `stable` core components (`EntityListHeader`, `DetailPanelShell`, `FieldRow`, `FieldGrid`) whose prop contracts are part of the versioned surface, plus experimental list/action/form components and a token bridge.
- **M33 plugin system (phase 3)** — the database-table entity now ships as the preinstalled `@inharness-ai/c4s-plugin-simple-database-tables` plugin; workspace-tier plugin frontend serving behind a trust gate; a plugin page-routing contract; per-plugin Settings and editor-command hot-reload.

### Fixed
- The preinstalled database-table plugin was referenced under a non-existent unscoped name; corrected to the published scoped `@inharness-ai/c4s-plugin-simple-database-tables` so a registry install resolves.
- Workspace plugin frontend was dropped when the install name differed from the package's `package.json` name.

## [1.0.21] - 2026-06-22

### Added
- Transagents — agents can now delegate work to nested child threads. A new `TransagentDispatcher` and `transagent-tools` MCP server manage parent→child thread relationships (migration `041`), and the client renders child activity in a dedicated `TransagentPanel` inside `ChatOverlay`, with `useChat` tracking child-thread start/complete state.
- Pagination and summary options for the `release-tools` MCP server — `release_list` and `release_show` accept `limit`/`offset`, and `release_diff` gains a `summaryOnly` mode that returns a light delta map (identifiers + operation types only, no full snapshots).

### Changed
- `c4s-brief-implementer` skill now documents pointing `c4s ask` at the symlinked spec dir via `--project .claude/skills/specyfikacja` (and warns against `cd`-ing into it, which resolves to the real path → `PROJECT_NOT_FOUND`).

### Fixed
- Chat thread-list over-fetch and frontend refetch storm. Server-side, `listThreads`/`forBrief`/`forPatch` drop the `LEFT JOIN chat_message + GROUP BY` (which aggregated `COUNT` over the full message table before `LIMIT`) for a correlated indexed `COUNT` subquery and a shared column list that omits the large `initial_system_prompt` blob — ~1962ms → ~10ms on a 506-thread/37k-message DB. `entity-indexer.indexAll` now rebuilds inside one transaction (~2s → ~117ms). Frontend uses a single shared `ThreadListProvider` with an in-flight guard, pagination, and a light `/entities/counts` aggregate replacing five full entity-list fetches.

## [1.0.20] - 2026-06-19

### Added
- Raw JSX passthrough in pages — a new `RawJsxNode` TipTap extension (with `RawJsxView`) lets pages carry raw JSX/MDX expressions through the markdown pipeline untouched. Backed by shared `jsx-passthrough`, `raw-jsx-escape`, `xml-tag-kinds`, `code-ranges`, and `page-files` modules with full round-trip serialization, so authored JSX survives parse → store → render.

### Changed
- Subagent panel reworked — `SubagentPanel` now renders richer subagent activity (expanded tool/turn detail and styling), supported by new chat-context service helpers and a `theme.css` palette refresh.
- `remoteApiUrl` validation hardened in `config` — validation moved into config resolution (with project-context plumbing), removing the duplicated check in the remote HTTP client.
- Bumped `@inharness-ai/agent-adapters` to `^0.8.4`.



### Added
- Diagram is now a full entity type (the 7th). A mermaid diagram's `source` lives in a `diagram` entity (`.claude4spec/entities/diagram/<slug>.json` + a derived `diagram` SQLite table, migration `040`), and pages reference it with a self-closing `<diagram slug="…" caption="…"/>` tag. `caption` is per-reference prose and is never stored on the entity. The slice mirrors the design-system module: serializer, services, REST routes, a `diagram-tools` MCP server (create/get/update/delete/list), system prompt, and client/server plugins. `source` is validated best-effort via `mermaid.parse()` (warnings only, never blocking). On the client, `<diagram/>` is a self-closing reference: `DiagramView` fetches `source` by slug and renders mermaid, `/diagram` authors source then creates the entity and inserts the reference, and editing PATCHes the entity while the caption stays per-reference.

### Changed
- The `c4s` spec-reader and brief-implementer skills (and their templates) now document the `c4s ask --project <symlink-path>` workaround for `PROJECT_NOT_FOUND` when the project directory is reached through a symlink.

### Removed
- Retired the inline content-bearing diagram block (`<diagram>…DSL…</diagram>`) along with the dead `xml_block_content` parser rule and the `diagram-source-escape` shared module, in favor of the entity-backed reference.

## [1.0.18] - 2026-06-16

### Added
- User-supplied ANTHROPIC API key management — a new `agent_credential` table stores the user's API key encrypted at-rest, with `GET`/`PUT`/`DELETE` `/api/agent/credentials` endpoints that never return the key in plaintext. The `AgentSection` component lets users enter and manage their key with success/error feedback, and `ChatService` injects the key into the environment for agent turns so users can run chat on their own credentials.

### Changed
- Bumped `@inharness-ai/agent-adapters` to 0.8.1.

## [1.0.17] - 2026-06-14

### Added
- Design system entity — a complete new module for creating, listing, and managing design systems through a dedicated UI (`NewDesignSystemPopover`, list page, and a full detail panel), backed by client/server plugins, REST routes, services, a `design-system` MCP server, and migrations `036`–`038`. UI views can now reference a design system by slug.
- Mid-turn chat message queuing — messages typed during a live turn are queued and delivered mid-turn (or merged after the turn). Queued messages render inline in the conversation as dimmed, dashed "ghost" bubbles that become solid once delivered, with a compact "N queued" counter and a clear-all action in the input area. Backed by migration `038_chat_queued_message` and queue state in `useChat`.

## [1.0.16] - 2026-06-11

### Added
- Project-less welcome page — a new `/welcome` route serves as an entry point when no project is active, letting users view and add projects to their workspace before selecting one. `WelcomePage` pairs with a server-side directory browser in `AddProjectDialog` for picking project directories.
- Multi-workspace support — projects can now belong to multiple workspaces, resolved through a new workspace registry. A `--workspace` CLI option disambiguates a project registered in more than one workspace, and a `ProjectSwitcher` UI plus `/api/workspace` routes manage workspace membership and project context.
- `describe` CLI command — returns on-demand JSON Schema for a given entity type or view, with error handling for invalid views, improving schema discovery for agents.
- Vitest testing framework — test infrastructure (`tsconfig.test.json`, `vitest.config.ts`, `tests/` helpers) plus an AC-coverage script (`scripts/ac-coverage.mjs`) and a broad initial suite of unit and integration tests across CLI, serialization, references, and DB migrations.
- `fable-5` chat model with adaptive thinking, surfaced across `ChatOverlay`, `UsageBadge`, and chat state.
- Onboarding configuration fields — a `DirectoriesSection` for specifying directory paths, `LanguageFields` (backed by `shared/languages.ts`), and a local "elevator pitch" project description field.
- Danger Zone settings section for destructive project actions.

### Changed
- Major server refactor — `src/server/index.ts` (~1000 lines) decomposed into dedicated `server/workspace/` modules (registry, bootstrap, project-context, context-cache, middleware, db-migration) with project-scoped DB access and a per-project plugin host (`host.ts` → `project-host.ts`).
- `useEntityDraftEditor` hook standardizes draft management and autosave across all entity detail panels (AC, DTO, endpoint, table, UI view); `CreateBriefDialog` simplified by removing the extra prompt input.
- `catalog` command enriched with row counts, descriptions, `roleNoun`, and `mcpToolsLine` for better smoke-test output; entity system prompts clarified.
- `ChatOverlay` now prioritizes a one-shot seed prompt over draft input via a new `seedPrompt` store state, ensuring fresh context when starting seeded threads.
- Bumped `@inharness-ai/agent-adapters` to 0.6.4.

## [1.0.15] - 2026-06-09

### Added
- M30 Static HTML preview — new `HtmlViewer` component renders read-only previews of `.html` files, backed by a static file server (`static.ts` / `static-html.ts`) with secure access and proper MIME-type handling. `router.tsx` routes `.html` files to the viewer, the `Sidebar` shows distinct icons for `.html` vs `.md`, and `PagesService` plus the file watcher now recognize HTML files.
- Chat orchestration for seeded threads — `startSeededThread` seeds new chat threads with a prompt for immediate agent interaction, paired with a sticky `ActionBar` UI and a new AC analysis service (`ac-analysis.service.ts`). `StyleOption` / `WritingStyleList` / `ProjectSection` now badge user-defined writing styles.
- `find-references` CLI command and core reference-search logic (`core/references`) supporting static and dynamic references, with `ReferencesService` delegating to the shared core and extended XML-tag matching.

### Changed
- M29 Slug-Based Entity Identity — entities are now identified solely by slug, replacing the previous integer-ID system. Adds an `entitiesDir` config option for committed entity JSON files, an `EntityStore` / `EntityIndexer` / `EntitiesWatcher`, a `MutateOpts` interface for granular control over file persistence, and migration `035_m29_slug_identity` for the ID→slug transition.
- `UsageBadge` context-window occupancy now uses the sum of input and output tokens for accurate context-utilization display.

## [1.0.14] - 2026-06-03

### Removed
- Obsolete acceptance criteria seed migration `026_ac_seed.sql` (stale AC data for modules M06, M19, M20 and associated tags), as part of cleaning up unused database migration scripts.

## [1.0.13] - 2026-06-03

### Added
- `projectKey` utility for consistent, project-scoped key management across components.

### Changed
- Chat state is now persisted under project-specific keys, isolating chat state across different project contexts.
- System prompt messages translated to English, with refined layout in `ChatOverlay` and `SystemPromptView`.
- Bumped `@inharness-ai/agent-adapters` to 0.6.3.

## [1.0.12] - 2026-06-02

### Added
- M28 Git Sync — release activities can now be automatically synced with your git repository. A new Git section in `SettingsPage` (`GitSection`) manages sync options for commits and pushes, backed by a `GitService` that detects the git repository and performs best-effort commit/push operations during release creation and remote pushes. Outcomes surface to the user via toast notifications, and API responses include git sync results for visibility into success or failure. New `/api/git` route, `useGitStatus` hook, and shared `git` / `release-push` types.

## [1.0.11] - 2026-05-31

### Added
- M27 Project Clone — bootstrap a local project from a published remote project. New `--clone <slug>` CLI option, backed by `ReleaseImportService` (validation, error handling) and the `release_import` table (migration `034_release_import`) that logs each clone attempt with its success or error state.
- `--remote-url <url>` CLI option for a sticky override of the remote API base URL.
- Chat session-lock — model and reasoning settings are now immutable for the duration of a chat session, with a chat configuration API exposing session resume constraints (migration `033_chat_initial_architecture_config`).
- Error handling for unknown writing styles in `ProjectSection`, surfacing a relevant message to the user.

### Changed
- `BriefsList` now sorts briefs by release order via the new `useReleases` hook.
- Bumped `@inharness-ai/agent-adapters` to 0.6.2.

## [1.0.10] - 2026-05-29

### Added
- `UnreleasedBanner` component surfacing unreleased changes in `ReleasesList` and `ReleaseDetail`.
- Remote project update flow — `RemoteProjectSection` gains create/update with validation and error handling, backed by an expanded `/api/remote-project` route, `useRemoteProject` hook, and `remote-http-client` / `remote-auth` support. Migration `032_release_push_remote_project_id_nullable` makes the release-push remote project id nullable.

### Changed
- Chat model support extended to Opus 4.8 — updated model labels and reasoning levels across `ChatOverlay`, `UsageBadge`, and chat state.
- Bumped `@inharness-ai/agent-adapters` and `@inharness-ai/agent-chat` dependencies; extended `reference-tools` and shared `xml-tags` helpers.

## [1.0.9] - 2026-05-28

### Added
- `SettingsPage` — centralized settings UI with dedicated sections (`AppearanceSection`, `AgentSection`, `EntitiesSection`, `ProjectSection`, `RemoteProjectSection`, `ServerSection`, `UserSettingsSection`, `AboutSection`) wrapped in a shared `SettingsCard`. The `Sidebar` and `UserSection` now navigate to it, and a new `RestartRequiredBanner` surfaces when settings changes require a server restart.
- Remote project plumbing — `/api/remote-project` route, `useRemoteProject` hook, and `shared/remote-project.ts` types, plus `RemoteAuthService` / `RemoteHttpClient` extensions.
- `shared/code-ranges.ts` and `shared/xml-tags.ts` helpers, and a `usePagesIndex` hook.

### Changed
- Rewrote `xml-chip-preprocess` and tightened `Editor` / `PlanEditor` around the new code-range helpers.
- `UserSection` and `Sidebar` simplified — settings navigation replaces inline controls.

### Removed
- `WritingStyleSelector` component (UI cleanup).

## [1.0.8] - 2026-05-26

### Added
- Push to remote — bundle a release into a tarball and push it to the remote claude4spec API. Adds the `/api/release-pushes` route, `ReleasePushService` and `ReleaseBundleService` (tarball packaging via `tar`), and migration `031_release_push`, with `RemoteHttpClient` / `RemoteAuthService` support for the authenticated upload. Client side: a "Push to remote" release action, the `ReleasePushesList` panel, the `useReleasePushes` hook, and `releasePushesApi`. Includes a `verify-bundle` script for validating produced tarballs.

## [1.0.7] - 2026-05-25

### Added
- M24 Remote Account — device-flow login to the remote claude4spec API with a local session store (migration `030_remote_session`). Adds the `/api/remote-account` route (`GET /`, `POST /login/start`, `POST /login/poll`, `POST /logout`), `RemoteAuthService`, a single-per-process `RemoteHttpClient` with a startup reachability check, and a `remoteApiUrl` config override (defaults to the production remote). Client side: `remoteAccountApi`, the `useRemoteAccount` hook, and a `UserSection` in the sidebar.
- `SegmentedControl` component for view switching, plus a `ContextLinkBar` in the chat overlay.
- Shared entity-list primitives under `entities/_shared/` (`EntityListRow`, `ListPageHeader`, `ListPageLayout`, `ListScrollArea`, `TagFilterBar`, `EntityViewSwitcher`, `EntityDetailToolbar`, `useEntityListQuery`) that deduplicate the per-entity list and detail pages.

### Changed
- Reworked every entity list page (ac, dto, endpoint, database-table, ui-view) onto the shared `_shared/` primitives, replacing `ChatToggleButton` with `SegmentedControl` and centralizing tag filtering, list scrolling, and view switching.
- `EditorToolbar` now takes a `path` prop instead of `selection`, simplifying its callers (`PlanPage`, `PatchDetail`, `BriefDetail`, `ReleaseDetail`).
- Improved localization and wording in `SystemPromptView` and `OutlineFloater`.

### Removed
- Legacy marketing `site/index.html` and the unused `ChatToggleButton` component.

## [1.0.6] - 2026-05-21

### Added
- `c4s-tools` MCP server — exposes the cross-spec `c4s ask` Q&A flow over MCP, so it works in plan mode where Bash tools are filtered out. The plugin host registers MCP server factories and builds a fresh instance per turn.
- Brief "implemented" workflow, with a status pill and collapsible patch view in the UI.

### Changed
- Extracted the shared `ask` logic into `src/core/ask/run-ask.ts`; the `c4s ask` CLI is now a thin wrapper over it.

### Removed
- `list_brief_versions` / `get_brief_version` tools from the brief-tools MCP surface.

### Fixed
- Restored a green client typecheck (`tsconfig.client.json`): widened the sidebar-tab `icon` contract to accept lucide-react's `size?: number | string`, and guarded `Tag.counts[...]` lookups against `undefined` under `noUncheckedIndexedAccess`.

## [1.0.5] - 2026-05-19

### Added
- `c4s ask` — synchronous CLI Q&A against a running `npx claude4spec` server. Supports `--ct chat | brief | patch`, thread continuation via `--thread <id>`, and explicit server override via `--server <url>`. Skill templates (`c4s-spec-reader`, `c4s-brief-implementer`) document the escalation path as optional — only available when both `c4s` and the server are present.
- `POST /api/threads/:id/ask` — synchronous JSON sibling of `POST /api/chat` (SSE). Shares the same adapter pool, `pendingInputs` map, and tool whitelist via a new `routes/agent-turn.ts` module extracted from `chat.ts`.

### Changed
- The server now binds to a single, deterministic port (the `port+1` fallback is gone). `EADDRINUSE` fails fast with a clear message so that `c4s ask` can reliably discover the server through `.claude4spec/config.json.port`.

## [1.0.4] - 2026-05-18

### Added
- M23 Patches — patches (`.claude4spec/patches/`) become a first-class source alongside pages and briefs: versioned in `page_version` (`kind='patch'`) and chat-enabled (`chat_thread.context_type='patch'`). Adds a patches route/service, patch chat context, frontmatter indexing, and client views (`PatchDetail`, `PatchEditor`, `usePatches`, `PageViewSwitcher`).

### Changed
- Dropped the `CHECK` constraints on `page_version.kind` and `chat_thread.context_type` (migrations 028/029); allowed values are now validated in the application layer, so future source and context types need no migration.

## [1.0.3] - 2026-05-16

### Changed
- Set `package.json` `homepage` to `https://claude4spec.inharness.ai` (was the GitHub `#readme` anchor) — npm now links the package to the project site.
- Added `Homepage` link to the README's Links section.

### Fixed
- Included `docs/screenshots` in the `files` whitelist so the README hero image ships in the npm tarball instead of 404-ing on the package page.

## [1.0.2] - 2026-05-14

### Changed
- Rewrote `README.md` with new positioning ("plan the whole system before your agent writes a line of code"), badges, requirements section, screenshot embeds, and clearer CLI/MCP guidance.
- Updated `package.json` `description` to match the new positioning.
- Polished marketing site (`site/index.html`): chat-overlay mock layout, copy refinements, command-box width.

### Added
- `docs/screenshots/hero.png` and `docs/screenshots/hero-dark.png` referenced by the README.

## [1.0.1] - 2026-05-13

### Fixed
- Added `@openai/codex-sdk`, `@opencode-ai/sdk`, `@google/gemini-cli-core` as direct dependencies to satisfy static imports in `@inharness-ai/agent-adapters@0.4.0` (declared as optional peers there, but statically bundled).

## [1.0.0] - 2026-05-13

Initial public release.

### Added
- `claude4spec` CLI — local-first editor for system specifications (markdown + SQLite).
- `c4s` CLI — read specification entities (endpoints, DTOs, tables, AC, UI views) by slug.
- `c4s-mcp` — MCP server for reading specification entities.
- React-based web editor with tiptap, chat overlay, and live page rendering.
- Skills `c4s-spec-reader` and `c4s-brief-implementer` for Claude Code integration.
- Acceptance Criteria entity and tooling.
- Briefs and patches workflow for spec-driven implementation.

[1.0.21]: https://github.com/InHarness/claude4spec/compare/v1.0.20...v1.0.21
[1.0.20]: https://github.com/InHarness/claude4spec/compare/v1.0.19...v1.0.20
[1.0.19]: https://github.com/InHarness/claude4spec/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/InHarness/claude4spec/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/InHarness/claude4spec/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/InHarness/claude4spec/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/InHarness/claude4spec/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/InHarness/claude4spec/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/InHarness/claude4spec/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/InHarness/claude4spec/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/InHarness/claude4spec/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/InHarness/claude4spec/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/InHarness/claude4spec/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/InHarness/claude4spec/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/InHarness/claude4spec/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/InHarness/claude4spec/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/InHarness/claude4spec/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/InHarness/claude4spec/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/InHarness/claude4spec/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/InHarness/claude4spec/compare/v1.0.1...v1.0.2

[1.0.22]: https://github.com/InHarness/claude4spec/compare/v1.0.21...v1.0.22

[1.0.23]: https://github.com/InHarness/claude4spec/compare/v1.0.22...v1.0.23

[1.0.24]: https://github.com/InHarness/claude4spec/compare/v1.0.23...v1.0.24
