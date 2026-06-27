# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
