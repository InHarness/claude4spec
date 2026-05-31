# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
