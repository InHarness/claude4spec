# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.4]: https://github.com/InHarness/claude4spec/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/InHarness/claude4spec/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/InHarness/claude4spec/compare/v1.0.1...v1.0.2
