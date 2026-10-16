/**
 * 2.1.26 — the `mcp-tool` records of the M10 plan tools, as the specification
 * states them at release 2.1.26: the six `plan-tools` tools of the thread mount
 * (`internal`), their `-explicit` twins of the threadless mount (external `mcp`,
 * `path` required) plus `list_plans`, which only the threadless mount carries,
 * and `transagent-tools · list_plans`. Name, server, the description the model
 * reads, the declared parameters and the annotation hints. Copied from the
 * records, not from the code — the tests that read this file hold the registered
 * tools against it, through the shared `expectToolMatchesToolRecord` of
 * `write-tool-records.ts`.
 */

import type { WriteToolRecord } from './write-tool-records.js';

export const PLAN_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  "plan-tools-create-plan-explicit": {
    server: "plan-tools",
    name: "create_plan",
    description:
      "Create a new plan file from a title and a ready body, and get its address back. Use it when you already know what the plan should say — you have read the code and hold the content, not a question. The plan is created together with a carrier thread that grounds its provenance; no turn is started in that thread, so run one yourself if you want the plan worked on. The new plan belongs to its carrier thread. To edit it afterwards, pass the returned path to update_plan; the returned hash arms its expectedHash.",
    params: [
      { name: "title", type: "string", required: true, description:
          "Plan title. The plan's slug is derived from it once and is immutable afterwards, so renaming the title later does not move the plan. A title whose slug is already taken is refused rather than suffixed." },
      { name: "content", type: "string", required: false, description:
          "Full markdown body of the plan, verbatim — this is the first version. Blank or whitespace-only is refused: nothing is created." },
    ],
  },
  "plan-tools-create-plan": {
    server: "plan-tools",
    name: "create_plan",
    description:
      "Create a new plan file from a title and a ready body, and get its address back. Use it when you already know what the plan should say — you have read the code and hold the content, not a question. The plan is created together with a carrier thread that grounds its provenance; no turn is started in that thread, so run one yourself if you want the plan worked on. This is not how you edit a plan. The new plan belongs to its carrier thread, not to this one, so you cannot read or edit it from here — hand the returned path to whoever will work on it. To write the plan of this thread, use update_plan, with title on the first call.",
    params: [
      { name: "title", type: "string", required: true, description:
          "Plan title. The plan's slug is derived from it once and is immutable afterwards, so renaming the title later does not move the plan. A title whose slug is already taken is refused rather than suffixed." },
      { name: "content", type: "string", required: false, description:
          "Full markdown body of the plan, verbatim — this is the first version. Blank or whitespace-only is refused: nothing is created." },
    ],
  },
  "plan-tools-get-plan-explicit": {
    server: "plan-tools",
    name: "get_plan",
    description:
      "Read a plan by path — latest content, version and hash. An unknown path is PLAN_NOT_FOUND; use list_plans to find one. The returned `hash` is what arms `expectedHash` on the next `update_plan`. For a long plan, or when a response comes back truncated, read it in windows with `range`.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Plan path relative to the plans root (.claude4spec/plans), from list_plans." },
      { name: "range", type: "object", required: false, description:
          "1-based inclusive line window { start, end } onto the plan. Always allowed. A start past the end of the file is refused with the file size." },
    ],
  },
  "plan-tools-get-plan-version-explicit": {
    server: "plan-tools",
    name: "get_plan_version",
    description:
      "Get a specific version snapshot with full content. Use to inspect historical plan state or prepare a diff locally.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Plan path relative to the plans root (.claude4spec/plans), from list_plans." },
      { name: "version", type: "integer", required: true },
    ],
  },
  "plan-tools-get-plan-version": {
    server: "plan-tools",
    name: "get_plan_version",
    description:
      "Get a specific version snapshot with full content. Use to inspect historical plan state or prepare a diff locally.",
    params: [
      { name: "version", type: "integer", required: true },
    ],
  },
  "plan-tools-get-plan": {
    server: "plan-tools",
    name: "get_plan",
    description:
      "Get the current plan for this thread — latest content, version and hash. Returns null when the thread has no plan yet. This is the ONLY way to the plan's content: the system prompt carries the plan's path and version, never its body. Use it to inspect plan state before updating, especially when a system reminder notes the plan was edited in another thread. The returned `hash` is what arms `expectedHash` on the next `update_plan`, so this read is the entry point of every write. For a long plan, or when a response comes back truncated, read it in windows with `range`.",
    params: [
      { name: "range", type: "object", required: false, description:
          "1-based inclusive line window { start, end } onto the plan. Always allowed. A start past the end of the file is refused with the file size." },
    ],
  },
  "plan-tools-list-plan-versions-explicit": {
    server: "plan-tools",
    name: "list_plan_versions",
    description:
      "List all versions of a plan (metadata only, no full content), oldest first — offset 0 is version 1. Use for audit / timeline rendering or before calling get_plan_version.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Plan path relative to the plans root (.claude4spec/plans), from list_plans." },
      { name: "limit", type: "integer", required: false },
      { name: "offset", type: "integer", required: false },
    ],
  },
  "plan-tools-list-plan-versions": {
    server: "plan-tools",
    name: "list_plan_versions",
    description:
      "List all versions of this thread's plan (metadata only, no full content), oldest first — offset 0 is version 1. Use for audit / timeline rendering or before calling get_plan_version.",
    params: [
      { name: "limit", type: "integer", required: false },
      { name: "offset", type: "integer", required: false },
    ],
  },
  "plan-tools-list-plans-explicit": {
    server: "plan-tools",
    name: "list_plans",
    description:
      "List the plans in this project — path, title, last update. The path is what get_plan / update_plan take on this connection.",
    params: [
      { name: "search", type: "string", required: false, description:
          "Filter by title or path substring." },
    ],
  },
  "plan-tools-mark-plan-applied-explicit": {
    server: "plan-tools",
    name: "mark_plan_applied",
    description:
      "Mark this thread's plan as applied to the specification. Call it as the LAST step after you have finished executing the plan.\nOne-way from here: `applied: false` is refused (INVALID_ARGUMENT) — only the user unsets the flag, from the plan page.\nIdempotent: calling it again with the same value changes nothing.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Plan path relative to the plans root (.claude4spec/plans), from list_plans." },
      { name: "applied", type: "boolean", required: true, description:
          "Must be true — this tool marks a plan applied, it does not unmark one." },
    ],
  },
  "plan-tools-mark-plan-applied": {
    server: "plan-tools",
    name: "mark_plan_applied",
    description:
      "Mark this thread's plan as applied to the specification. Call it as the LAST step after you have finished executing the plan.\nOne-way from here: `applied: false` is refused (INVALID_ARGUMENT) — only the user unsets the flag, from the plan page.\nIdempotent: calling it again with the same value changes nothing.",
    params: [
      { name: "applied", type: "boolean", required: true, description:
          "Must be true — this tool marks a plan applied, it does not unmark one." },
    ],
  },
  "plan-tools-update-plan-explicit": {
    server: "plan-tools",
    name: "update_plan",
    description:
      "Create or update the deployment plan attached to this thread.\nEXACTLY ONE of three variants per call, else INVALID_ARGUMENT: `content` — the complete markdown, create-or-replace; `textEdits` — literal find/replaceWith counted over the WHOLE plan; `edits` — a section batch by `anchor` (from get_plan), several actions per anchor.\nBatch actions: `replace` (OWN body), `append` (end of OWN body) and `insert_after` (after the subtree) take `content`; `delete` (subtree, heading, anchor) takes nothing; `edit` takes `textEdits`, counted inside the subtree alone; `rename` takes `heading`: the heading line alone, level and anchor kept. Wrong fields for an action, an invalid `rename` heading, or a `content` heading at or above the section's level in `replace`/`append`: INVALID_ARGUMENT for the whole batch. No `dropAnchors`, no ANCHOR_LOSS; each row's `droppedAnchors` names what went.\nThe batch is TRANSACTIONAL and order-independent. `find` is matched on the plan as read. A `replace` carrying an existing subsection's anchor is INVALID_ARGUMENT. Anchors only: unknown → SECTION_NOT_FOUND, duplicated → AMBIGUOUS_ANCHOR.\nFIRST call in a thread: `title` REQUIRED (creates the file, slug immutable), else MISSING_TITLE; on an empty plan only `content` succeeds. Otherwise `expectedHash` is REQUIRED — the WHOLE plan's hash; missing → INVALID_ARGUMENT, stale → PLAN_CONFLICT (409) with the current hash. One `changeSummary`, one `file_version` entry per call.\nReturns { path, version, hash, results }: a row per element in input order, { anchor, action, affectedAnchors, droppedAnchors, replacements?, previousHeading? }; whole-plan variants: one row, null `anchor` and `action`. Content does not come back.\nIDEMPOTENT: `content`, `replace`, `rename` (not a `replace` adding a deeper heading). `delete` repeated → SECTION_NOT_FOUND, `edit`/`textEdits` → FIND_NOT_FOUND, `append`/`insert_after` duplicate.\nUse in plan_mode or when asked for a plan. It cannot change `applied` — use `mark_plan_applied`.",
    params: [
      { name: "path", type: "string", required: true, description:
          "Plan path relative to the plans root (.claude4spec/plans), from list_plans." },
      { name: "content", type: "string", required: false, description:
          "VARIANT 1: the complete plan markdown. Mutually exclusive with textEdits and edits." },
      { name: "textEdits", type: "object[]", required: false, description:
          "VARIANT 2: substitutions counted over the whole plan. Mutually exclusive with content and edits." },
      { name: "edits", type: "object[]", required: false, description:
          "VARIANT 3: a transactional section batch. Mutually exclusive with content and textEdits. replace — swap the section's OWN BODY; deeper headings in `content` become its first children, a heading at or above its level is INVALID_ARGUMENT. COLLISIONS — each element CLAIMS the plan as it was BEFORE the write: `delete` the subtree with its anchor line, `replace` the own body, `edit` each matched fragment, `rename` the anchor and heading lines; `append` and `insert_after` claim only a POINT. INVALID_ARGUMENT when two claims share a character or a point lies strictly INSIDE a claim (an edge is fine), for two elements of the SAME action on one anchor, and for ANY element addressing an anchor inside a deleted subtree. Inserts sharing a position land innermost first — `append` before `insert_after` of the same section, a descendant's before its ancestor's. `results[]` carries one row PER ELEMENT; read them by position." },
      { name: "title", type: "string", required: false },
      { name: "expectedHash", type: "string", required: false, description:
          "sha256 of the plan as you last read it (`hash` from get_plan or a previous update_plan). REQUIRED except on the first call in a thread, which creates the plan." },
      { name: "changeSummary", type: "string", required: true },
    ],
  },
  "plan-tools-update-plan": {
    server: "plan-tools",
    name: "update_plan",
    description:
      "Create or update the deployment plan attached to this thread.\nEXACTLY ONE of three variants per call, else INVALID_ARGUMENT: `content` — the complete markdown, create-or-replace; `textEdits` — literal find/replaceWith counted over the WHOLE plan; `edits` — a section batch by `anchor` (from get_plan), several actions per anchor.\nBatch actions: `replace` (OWN body), `append` (end of OWN body) and `insert_after` (after the subtree) take `content`; `delete` (subtree, heading, anchor) takes nothing; `edit` takes `textEdits`, counted inside the subtree alone; `rename` takes `heading`: the heading line alone, level and anchor kept. Wrong fields for an action, an invalid `rename` heading, or a `content` heading at or above the section's level in `replace`/`append`: INVALID_ARGUMENT for the whole batch. No `dropAnchors`, no ANCHOR_LOSS; each row's `droppedAnchors` names what went.\nThe batch is TRANSACTIONAL and order-independent. `find` is matched on the plan as read. A `replace` carrying an existing subsection's anchor is INVALID_ARGUMENT. Anchors only: unknown → SECTION_NOT_FOUND, duplicated → AMBIGUOUS_ANCHOR.\nFIRST call in a thread: `title` REQUIRED (creates the file, slug immutable), else MISSING_TITLE; on an empty plan only `content` succeeds. Otherwise `expectedHash` is REQUIRED — the WHOLE plan's hash; missing → INVALID_ARGUMENT, stale → PLAN_CONFLICT (409) with the current hash. One `changeSummary`, one `file_version` entry per call.\nReturns { path, version, hash, results }: a row per element in input order, { anchor, action, affectedAnchors, droppedAnchors, replacements?, previousHeading? }; whole-plan variants: one row, null `anchor` and `action`. Content does not come back.\nIDEMPOTENT: `content`, `replace`, `rename` (not a `replace` adding a deeper heading). `delete` repeated → SECTION_NOT_FOUND, `edit`/`textEdits` → FIND_NOT_FOUND, `append`/`insert_after` duplicate.\nUse in plan_mode or when asked for a plan. It cannot change `applied` — use `mark_plan_applied`.",
    params: [
      { name: "content", type: "string", required: false, description:
          "VARIANT 1: the complete plan markdown. Mutually exclusive with textEdits and edits." },
      { name: "textEdits", type: "object[]", required: false, description:
          "VARIANT 2: substitutions counted over the whole plan. Mutually exclusive with content and edits." },
      { name: "edits", type: "object[]", required: false, description:
          "VARIANT 3: a transactional section batch. Mutually exclusive with content and textEdits. replace — swap the section's OWN BODY; deeper headings in `content` become its first children, a heading at or above its level is INVALID_ARGUMENT. COLLISIONS — each element CLAIMS the plan as it was BEFORE the write: `delete` the subtree with its anchor line, `replace` the own body, `edit` each matched fragment, `rename` the anchor and heading lines; `append` and `insert_after` claim only a POINT. INVALID_ARGUMENT when two claims share a character or a point lies strictly INSIDE a claim (an edge is fine), for two elements of the SAME action on one anchor, and for ANY element addressing an anchor inside a deleted subtree. Inserts sharing a position land innermost first — `append` before `insert_after` of the same section, a descendant's before its ancestor's. `results[]` carries one row PER ELEMENT; read them by position." },
      { name: "title", type: "string", required: false },
      { name: "expectedHash", type: "string", required: false, description:
          "sha256 of the plan as you last read it (`hash` from get_plan or a previous update_plan). REQUIRED except on the first call in a thread, which creates the plan." },
      { name: "changeSummary", type: "string", required: true },
    ],
  },
  "transagent-tools-list-plans": {
    server: "transagent-tools",
    name: "list_plans",
    description:
      "List the plans of this specification — the set you pick a plan from for a banka.\nOrdered by `created_at` ascending (ties by `path`; a plan without `created_at` comes last).\nFilter with `applied` (`false` = not yet applied to the spec; a plan with no `applied` field counts as false).\nEach row: { path, title, applied, createdAt, updatedAt } — no plan content; `path` is what\nrunTransagent({ payload: { planPath } }) takes. Paged: `limit` / `offset`, answered with `total` and `hasMore`.",
    params: [
      { name: "applied", type: "boolean", required: false, description:
          "Narrow to applied (true) or not yet applied (false). Omit for all." },
      { name: "limit", type: "integer", required: false },
      { name: "offset", type: "integer", required: false },
    ],
    hints: { readOnlyHint: true, destructiveHint: null, idempotentHint: null, openWorldHint: null },
  },
};
