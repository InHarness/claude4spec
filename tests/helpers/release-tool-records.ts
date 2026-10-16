/**
 * 2.1.26 — the `mcp-tool` records of the M17 release tools (`release-tools`
 * server: `release_create`, `release_list`, `release_show`, `release_diff`,
 * `release_update`), as the specification states them at release 2.1.26: name,
 * server, the description the model reads and the declared parameters (every
 * hint of these five records is empty — the server declares none). Copied from
 * the records, not from the code — the tests that read this file hold the
 * registered tools against it through the shared `expectToolMatchesToolRecord`
 * of `write-tool-records.ts`, and resolve a `spec-operation` record's
 * `narzedzia` to `<server>.<tool>` through it.
 */

import type { WriteToolRecord } from './write-tool-records.js';

export const RELEASE_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  "release-tools-release-create": {
    server: "release-tools",
    name: "release_create",
    description:
      "Create a named release (snapshot of current spec state). Assigns release_id to all unreleased entity_version + file_version rows in one transaction. Always manual — there are no auto-triggers (M17 decyzja 9). Both name (UNIQUE) and description (non-empty) are required.",
    params: [
      { name: "name", type: "string", required: true, description:
          "Release name, must be unique. e.g. \"v1.0.0\", \"pre-launch\". The release is addressed by this name everywhere. `current`, `initial` and `null` are reserved (they name states, not releases) → 400 RELEASE_NAME_RESERVED." },
      { name: "description", type: "string", required: true, description:
          "Non-empty statement of the intent of this release, at most 500 characters. It is the raw material a later change brief is written from, so make it say what the release is about." },
    ],
  },
  "release-tools-release-list": {
    server: "release-tools",
    name: "release_list",
    description:
      "List releases newest-first (paginated). Returns `{ releases, total }` where `total` is the full count before limit/offset. Per release: id, name, description, createdBy, createdAt. The first entry is the newest release; address it (and any other) in the other release tools by its `name` — `id` is a technical key returned for reference only.",
    params: [
      { name: "limit", type: "number", required: false, description:
          "Window size. Default 5, no upper limit. Negative → 400 INVALID_PAGINATION." },
      { name: "offset", type: "number", required: false, description:
          "Window offset into the newest-first list. Default 0. Negative → 400 INVALID_PAGINATION." },
    ],
  },
  "release-tools-release-show": {
    server: "release-tools",
    name: "release_show",
    description:
      "Show a release's identification surface (release metadata + lists of entity slugs/page paths present at the release). Returns `MCPSpecSnapshot` — IDENTIFICATION only, not full entity/page data. To inspect the data, call `release_diff` (with this release as `to` and any earlier release — or `null` — as `from`). Addressed by release name only. Filters: `include` (defaults to ['pages','entities']) trims the dimensions returned; `entityTypes` restricts entity types. Brief versions (`file_version.kind='brief'`) are excluded from `pages` (L2 invariant). RESPONSE BUDGET: a window cut short by the budget reports `truncationHint` naming the next `offset`; rows here are identity-only, so degradation is always a narrower window and never a poorer row.",
    params: [
      { name: "releaseName", type: "string", required: true, description:
          "Release name — the only input identifier (a digit string is a name, never an id). The literals `current` / `initial` / `null` name states, not releases → 404 RELEASE_NOT_FOUND." },
      { name: "include", type: "enum(pages, entities)[]", required: false, description:
          "Filter dimensions. Default ['pages','entities']. Empty array → 400 INVALID_INCLUDE_FILTER." },
      { name: "entityTypes", type: "string[]", required: false, description:
          "Filter entity types. Default: every active entity type. Empty array → 400 INVALID_ENTITY_TYPES_FILTER. Passing this without 'entities' in `include` → 400 CONFLICTING_FILTERS." },
      { name: "limit", type: "number", required: false, description:
          "Window size applied independently to entities[] and pages[]. Default 5, no upper limit. Negative → 400 INVALID_PAGINATION." },
      { name: "offset", type: "number", required: false, description:
          "Window offset applied independently to entities[] and pages[]. Default 0. Negative → 400 INVALID_PAGINATION." },
    ],
  },
  "release-tools-release-diff": {
    server: "release-tools",
    name: "release_diff",
    description:
      "Compute a self-contained structured diff between two releases, or between a release and the current unreleased state. Heavy mode (default) carries, per changed entity, the FULL `before`/`after` snapshots frozen at each release, and per changed page section the section text with inline `<before_change>`/`<after_change>` markers; compare the snapshots yourself. The payload already carries historical state, so do not drill into current files or the live entity graph to explain a past change. `toReleaseName: \"current\"` diffs against the live, not-yet-released state (HEAD); that side is not frozen and does not reproduce later. Light mode (`summaryOnly: true`) returns a complete delta MAP, deletions included, windows ignored: `total` plus `{ type, slug, name, op }` per entity and `{ rootId, path, op, sections, size }` per page, where `size` is the length of the page's changed-section content in characters. With exactly one entry in `paths` it also returns that page's section map, with a `size` per section. Pattern: probe with `summaryOnly`, use `size` to partition into disjoint slices, then pull each slice by `entityTypes`, `paths` and the `limit`/`offset` page window. Read a large page with `paths` set to it and the `sectionOffset`/`sectionLimit` section window; `sectionLimit: 1` reads it section by section, by choice and not only after truncation. `limit` (default 5) and `offset` window entities and pages independently; `total` counts after filters, before the window, and with one path `total.sections` counts its changed sections. A window past the end returns an empty list with `total` present. `fromReleaseName: null` gives the initial diff (every entry `op: 'create'`); `from === to` gives an empty diff. Briefs and patches never appear. Read-only.",
    params: [
      { name: "fromReleaseName", type: "string | null", required: true, description:
          "Earlier release name (a digit string is a name, never an id). `null`, `\"null\"` and `\"initial\"` are equivalent and name the empty state (initial diff — all entries become op:create). `\"current\"` is not legal here → 400 INVALID_DIFF_RANGE." },
      { name: "toReleaseName", type: "string", required: true, description:
          "Later release name (a digit string is a name, never an id). The literal `\"current\"` compares against the live, not-yet-released state (HEAD) instead of a release; it is resolved before the name lookup and is a reserved release name, so it can never be shadowed by a real one. The empty state (`null` / `\"null\"` / `\"initial\"`) on the left together with `\"current\"` → 400 INVALID_DIFF_RANGE; `\"initial\"` / `\"null\"` here → 400 INVALID_DIFF_RANGE." },
      { name: "include", type: "enum(pages, entities)[]", required: false, description:
          "Filter dimensions. Default ['pages','entities']. Empty array → 400 INVALID_INCLUDE_FILTER." },
      { name: "entityTypes", type: "string[]", required: false, description:
          "Filter entity types. Default: every active entity type. Empty array → 400 INVALID_ENTITY_TYPES_FILTER. Passing this without 'entities' in `include` → 400 CONFLICTING_FILTERS." },
      { name: "slugs", type: "string[]", required: false, description:
          "Narrow the ENTITIES dimension to these bare slugs of ONE type — requires exactly one element in `entityTypes` and 'entities' in `include` (otherwise 400 CONFLICTING_FILTERS). Empty array or an empty element → 400 INVALID_SLUGS_FILTER. Narrows the response, not the computation; a slug unchanged (or absent) on both sides yields no entry and `total.entities: 0`, not an error. With `fromReleaseName: null` a present entity comes back as one `op: 'create'` entry whose `after` is its state in `to`. Does not touch the pages dimension, so it combines with `paths`." },
      { name: "summaryOnly", type: "boolean", required: false, description:
          "When true, return the light delta map — identifiers plus op, and per page `sections` (changed-section count) and `size` (their content length in characters); deletions included, no before/after/content. With exactly one element in `paths`, the page row also carries `sectionMap`: one row per changed section with its identity and `size`. The map is always complete and ignores limit/offset and the section window." },
      { name: "roots", type: "string[]", required: false, description:
          "Narrow the PAGES dimension to these page root ids (file_version.rootId). Default: every page root. Does not affect the entities dimension. Empty array, an unknown root id, or an id that is not a page root (e.g. plans, briefs, patches, entities, releases) → 400 INVALID_ROOTS_FILTER (never silently skipped; the refusal lists the page roots). Mutually exclusive with `paths`." },
      { name: "paths", type: "string[]", required: false, description:
          "Narrow the PAGES dimension to single pages. Each element is a page's FULL key `<rootId>/<relPath>` and addresses exactly one page file — a directory prefix is not accepted. Mutually exclusive with `roots`, and rejected when `include` does not carry 'pages'. An empty array, an element without a root prefix, an unknown root id, or a root that is not a page root is rejected. Does not affect the entities dimension. A well-formed key unchanged (or absent) on both sides is NOT an error — it yields no page entry and `total.pages: 0`. Errors: 400 INVALID_PATHS_FILTER, 400 CONFLICTING_FILTERS. Exactly one element enables the section window and, in light mode, the section map." },
      { name: "limit", type: "number", required: false, description:
          "Window size applied independently to entities[] and pages[] (heavy mode only). Default 5, no upper limit. Negative → 400 INVALID_PAGINATION." },
      { name: "offset", type: "number", required: false, description:
          "Window offset applied independently to entities[] and pages[]. Default 0. Beyond total → empty list + total. Negative → 400 INVALID_PAGINATION. In light mode (`summaryOnly: true`) this is the resume cursor for an identity map that does not fit in one response." },
      { name: "sectionOffset", type: "number", required: false, description:
          "Default 0. Start of the section window in the ONE page named by `paths`; positions count in the order `sections[]` comes back without a window. Requires exactly one element in `paths`, otherwise 400 CONFLICTING_FILTERS. Negative → 400 INVALID_PAGINATION. A window past the end returns an empty section list with `total.sections` present. The page's `frontmatter`/`xmlRefs` come only in the window starting at 0. Ignored with `summaryOnly: true`." },
      { name: "sectionLimit", type: "number", required: false, description:
          "Size of the section window. Default: every section from `sectionOffset` on. `1` reads the page section by section, usable by choice whatever the page size. Same conditions as `sectionOffset`." },
    ],
  },
  "release-tools-release-update": {
    server: "release-tools",
    name: "release_update",
    description:
      "Update the LATEST release only — older releases are frozen. Mutates name/description in-place and optionally pulls all unreleased entity_version + file_version rows (release_id IS NULL) into this release. 409 RELEASE_FROZEN if the release is not the latest on the release axis (latest created_at, tie by id). 409 RELEASE_NAME_CONFLICT on rename collision. 400 RELEASE_DESCRIPTION_TOO_LONG / RELEASE_DESCRIPTION_REQUIRED when a given description is over 500 characters or empty.",
    params: [
      { name: "releaseName", type: "string", required: true, description:
          "Name of the release to update — the only input identifier. A literal (`current` / `initial` / `null`) or an unknown name → 404 RELEASE_NOT_FOUND, checked before RELEASE_FROZEN." },
      { name: "name", type: "string", required: false, description:
          "New name (must be unique; `current`, `initial` and `null` are reserved → 400 RELEASE_NAME_RESERVED). Omit to leave unchanged." },
      { name: "description", type: "string", required: false, description:
          "New non-empty description of the release intent, at most 500 characters. Omit to leave unchanged." },
      { name: "assignUnreleased", type: "boolean", required: false, description:
          "When true, assigns all entity_version/file_version rows where release_id IS NULL to this release. No-op when queue is empty." },
    ],
  },
};
