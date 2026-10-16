/**
 * 2.1.26 — the `mcp-tool` records of the M21 brief tools, as the specification
 * states them at release 2.1.26: the four `brief-tools` tools of the thread
 * mount (`internal`), their four `-explicit` twins of the threadless mount
 * (external `mcp`, `path` required) and `transagent-tools · list_briefs`. Name,
 * server, the description the model reads, the declared parameters and the
 * annotation hints. Copied from the records, not from the code — the tests that
 * read this file hold the registered tools against it, through the shared
 * `expectToolMatchesToolRecord` of `write-tool-records.ts`.
 */

import type { WriteToolRecord } from './write-tool-records.js';

export const BRIEF_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  "brief-tools-get-brief": {
    server: "brief-tools",
    name: "get_brief",
    description:
      "Read the brief this thread is anchored in — content, frontmatter and hash. This is the ONLY way to the brief's content: the system prompt carries the brief's path and frontmatter, never its body and never its hash. There is no `path` parameter: the tool is scoped to the brief of this thread and cannot reach another one. For a long brief, or when a response comes back truncated, read it in windows with `range`. The returned `hash` is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write. Call it before editing, and again after a system reminder says the file changed underneath you.",
    params: [
      { name: "range", type: "object", required: false, description:
          "Line window { start, end }, 1-based and inclusive. Use it to read a long brief in parts or to fetch the rest after a truncated response. A start past the end of the file is refused with the file size." },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "brief-tools-get-brief-explicit": {
    server: "brief-tools",
    name: "get_brief",
    description:
      "Read the brief named by `path` — content, frontmatter and hash. An unknown path is BRIEF_NOT_FOUND, with the real brief paths in the hint. For a long brief, or when a response comes back truncated, read it in windows with `range`; a window starting past the end of the file is INVALID_ARGUMENT stating the file size. The returned `hash` is the digest of the WHOLE file (also when `range` narrowed what came back) and is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Path of the brief relative to the briefs root (.claude4spec/briefs), e.g. `0-2-12-to-0-2-13.md`. Required: this connection has no thread, so there is no default brief. List the candidates with the brief artifact read operations." },
      { name: "range", type: "object", required: false, description:
          "Line window { start, end }, 1-based and inclusive. Use it to read a long brief in parts or to fetch the rest after a truncated response. A start past the end of the file is refused with the file size." },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "brief-tools-update-brief": {
    server: "brief-tools",
    name: "update_brief",
    description:
      "Edit the brief of this thread — there is no `path` parameter and no way to reach another brief. TWO INPUT SHAPES, EXACTLY ONE PER CALL (both, or neither, is invalid):\n- by action — `action` + `content`: `replace` swaps the addressed range, `append` adds at the end, `insert_after_section` places new content after a section you address by `anchor` or by `heading`. You pass the full text of the range in `content`.\n- differential — `textEdits`: literal substitutions over the whole brief, without resending the untouched text. Use it for a few sentences anywhere; use `action` + `content` to write or genuinely rewrite a range.\n\n`find` matches BYTE FOR BYTE — no regex, no whitespace normalisation. `expectedMatches` OMITTED MEANS EXACTLY ONE match; pass a number, or `\"all\"` for every occurrence. All patterns are counted on the brief as it was BEFORE the write, so substitutions do not cascade.\n\n`expectedHash` is MANDATORY. Pass the hash you got from `get_brief`; omitting it is a validation error, not silent permission to overwrite. The brief is edited in parallel by this thread, by a human in the UI and by an implementer agent in the terminal, so last-write-wins would lose someone's work without a trace.\n\nAn `anchor` that no longer resolves does not fail the call — the content is appended at the end and the answer says so. A heading inside a code block is never a target, and a `heading` matching several headings lands after the first of them, with a warning in the answer.\n\nFrontmatter is not editable here; only `implemented` is mutable at all, and it has its own route.",
    params: [
      { name: "action", type: "enum(replace, append, insert_after_section)", required: false, description:
          "ACTION SHAPE: what to do with `content` — swap the addressed range, add at the end, or insert after an addressed section. Required together with `content`; forbidden with `textEdits`." },
      { name: "content", type: "string", required: false, description:
          "ACTION SHAPE: full text this edit contributes — write the range out. Required together with `action`; forbidden with `textEdits`." },
      { name: "textEdits", type: "object[]", required: false, description:
          "DIFFERENTIAL SHAPE: `[{ find, replaceWith, expectedMatches? }]` applied to the whole brief. `find` is literal, byte for byte; `expectedMatches` omitted means exactly one hit, a number means exactly that many, `\"all\"` means every occurrence. Mutually exclusive with `action` and `content`." },
      { name: "anchor", type: "string", required: false, description:
          "Section anchor to address for `insert_after_section`. Unknown anchor degrades to append-at-end with a warning." },
      { name: "heading", type: "string", required: false, description:
          "Heading text to address for `insert_after_section`, as an alternative to `anchor`." },
      { name: "expectedHash", type: "string", required: true, description:
          "sha256 of the brief as you last read it. Missing → VALIDATION; mismatch → BRIEF_CONFLICT carrying the current hash." },
      { name: "changeSummary", type: "string", required: false, description:
          "One-line description of what this edit changes, recorded with the version." },
    ],
    hints: { readOnlyHint: false, destructiveHint: null, idempotentHint: false, openWorldHint: null },
  },
  "brief-tools-update-brief-explicit": {
    server: "brief-tools",
    name: "update_brief",
    description:
      "Edit the brief named by `path` — required: this connection has no thread, so there is no default brief. TWO INPUT SHAPES, EXACTLY ONE PER CALL (both, or neither, is invalid):\n- by action — `action` + `content`: `replace` swaps the addressed range, `append` adds at the end, `insert_after_section` places new content after a section you address by `anchor` or by `heading`. You pass the full text of the range in `content`.\n- differential — `textEdits`: literal substitutions over the whole brief, without resending the untouched text. Use it for a few sentences anywhere; use `action` + `content` to write or genuinely rewrite a range.\n\n`find` matches BYTE FOR BYTE — no regex, no whitespace normalisation. `expectedMatches` OMITTED MEANS EXACTLY ONE match; pass a number, or `\"all\"` for every occurrence. All patterns are counted on the brief as it was BEFORE the write, so substitutions do not cascade.\n\n`expectedHash` is MANDATORY. Pass the hash you got from `get_brief`; omitting it is a validation error, not silent permission to overwrite. The brief is edited in parallel by this thread, by a human in the UI and by an implementer agent in the terminal, so last-write-wins would lose someone's work without a trace.\n\nAn `anchor` that no longer resolves does not fail the call — the content is appended at the end and the answer says so. A heading inside a code block is never a target, and a `heading` matching several headings lands after the first of them, with a warning in the answer.\n\nFrontmatter is not editable here; only `implemented` is mutable at all, and it has its own route.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Path of the brief relative to the briefs root (.claude4spec/briefs), e.g. `0-2-12-to-0-2-13.md`. Required: this connection has no thread, so there is no default brief. List the candidates with the brief artifact read operations." },
      { name: "action", type: "enum(replace, append, insert_after_section)", required: false, description:
          "ACTION SHAPE: what to do with `content` — swap the addressed range, add at the end, or insert after an addressed section. Required together with `content`; forbidden with `textEdits`." },
      { name: "content", type: "string", required: false, description:
          "ACTION SHAPE: full text this edit contributes — write the range out. Required together with `action`; forbidden with `textEdits`." },
      { name: "textEdits", type: "object[]", required: false, description:
          "DIFFERENTIAL SHAPE: `[{ find, replaceWith, expectedMatches? }]` applied to the whole brief. `find` is literal, byte for byte; `expectedMatches` omitted means exactly one hit, a number means exactly that many, `\"all\"` means every occurrence. Mutually exclusive with `action` and `content`." },
      { name: "anchor", type: "string", required: false, description:
          "Section anchor to address for `insert_after_section`. Unknown anchor degrades to append-at-end with a warning." },
      { name: "heading", type: "string", required: false, description:
          "Heading text to address for `insert_after_section`, as an alternative to `anchor`." },
      { name: "expectedHash", type: "string", required: true, description:
          "sha256 of the brief as you last read it. Missing → VALIDATION; mismatch → BRIEF_CONFLICT carrying the current hash." },
      { name: "changeSummary", type: "string", required: false, description:
          "One-line description of what this edit changes, recorded with the version." },
    ],
    hints: { readOnlyHint: false, destructiveHint: null, idempotentHint: false, openWorldHint: null },
  },
  "brief-tools-list-brief-versions": {
    server: "brief-tools",
    name: "list_brief_versions",
    description:
      "List the version history of the brief — metadata only, never content. Use it to see what changed and when before pulling a specific snapshot with `get_brief_version`. There is no `path` parameter: the tool addresses the brief of this thread only.",
    params: [
      { name: "limit", type: "integer", required: false },
      { name: "offset", type: "integer", required: false },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "brief-tools-list-brief-versions-explicit": {
    server: "brief-tools",
    name: "list_brief_versions",
    description:
      "List the version history of the brief named by `path` — metadata only, never content, oldest first (offset 0 is version 1). Use it to see what changed and when before pulling a specific snapshot with `get_brief_version`. An unknown path is BRIEF_NOT_FOUND, never an empty list.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Path of the brief relative to the briefs root (.claude4spec/briefs), e.g. `0-2-12-to-0-2-13.md`. Required: this connection has no thread, so there is no default brief. List the candidates with the brief artifact read operations." },
      { name: "limit", type: "integer", required: false },
      { name: "offset", type: "integer", required: false },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "brief-tools-get-brief-version": {
    server: "brief-tools",
    name: "get_brief_version",
    description:
      "Read one historical snapshot of the brief, addressed by version number from `list_brief_versions`. Use it to see what the brief said before an edit — it does not restore anything and does not touch the live file. There is no `path` parameter: the tool addresses the brief of this thread only.",
    params: [
      { name: "version", type: "integer", required: true, description:
          "Version number, from list_brief_versions." },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "brief-tools-get-brief-version-explicit": {
    server: "brief-tools",
    name: "get_brief_version",
    description:
      "Read one historical snapshot of the brief named by `path`, addressed by version number from `list_brief_versions`. Use it to see what the brief said before an edit — it does not restore anything and does not touch the live file.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Path of the brief relative to the briefs root (.claude4spec/briefs), e.g. `0-2-12-to-0-2-13.md`. Required: this connection has no thread, so there is no default brief. List the candidates with the brief artifact read operations." },
      { name: "version", type: "integer", required: true, description:
          "Version number, from list_brief_versions." },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
  "transagent-tools-list-briefs": {
    server: "transagent-tools",
    name: "list_briefs",
    description:
      "List the briefs of this specification — use it to turn a brief's name into its `path`\n(the `brief` filter of `list_patches`) and to orient yourself in the set. It is not an address\nfor a banka: runTransagent({ contextType: 'brief' }) always founds a new brief.\nOrdered on the release axis: newest cycle first, a brief open to the current state directly\nabove the briefs of the release it starts from, briefs of unknown releases last.\nFilter with `implemented` (`false` = not yet implemented).\nEach row: { path, title, fromRelease, toRelease, implemented, generatedAt } — no brief content.\nPaged: `limit` / `offset`, answered with `total` (counted after the filter) and `hasMore`.",
    params: [
      { name: "implemented", type: "boolean", required: false, description:
          "Narrow to implemented (true) or pending (false). Omit for all." },
      { name: "limit", type: "integer", required: false },
      { name: "offset", type: "integer", required: false },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
};
