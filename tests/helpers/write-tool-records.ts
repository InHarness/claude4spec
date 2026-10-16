/**
 * 2.1.26 — the `mcp-tool` records of the M13 entity-mutation tools, the two
 * DTO-binding tools and the five `page-tools` (M02 / M06 page write path), as the
 * specification states them at release 2.1.26: name, server, the description the
 * model reads, the declared parameters and the annotation hints. Copied from the
 * records, not from the code — the tests that read this file hold the registered
 * tools against it.
 *
 * A record without `hints` has every hint empty: its server declares none. Of the
 * records here only `page-tools · update_page` declares hints.
 */

import { expect } from 'vitest';
import { declaredParams, type DeclaredTool } from './read-tool-records.js';

export interface WriteToolRecord {
  server:
    | 'entity-tools'
    | 'endpoint-tools'
    | 'page-tools'
    | 'brief-tools'
    | 'plan-tools'
    | 'patch-tools'
    | 'transagent-tools'
    | 'release-tools'
    | 'skill-tools'
    | 'c4s-reader'
    | 'workspace-tools'
    | 'spec-skill-tools';
  name: string;
  description: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
  /** The record's hints; `null` is an empty hint (nothing declared). Absent → all four empty. */
  hints?: Record<'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint', boolean | null>;
}

const DTO_LINK_PARAMS: WriteToolRecord['params'] = [
  { name: 'endpointSlug', type: 'string', required: true },
  { name: 'dtoSlug', type: 'string', required: true },
  { name: 'relation', type: 'enum(request, response, error)', required: true },
  { name: 'statusCode', type: 'number', required: false },
];

export const WRITE_TOOL_RECORDS: Record<string, WriteToolRecord> = {
  'entity-tools-create-entities': {
    server: 'entity-tools',
    name: 'create_entities',
    description:
      "Create one or more entities of the given type in a single batch. Each item is validated against the type's createSchema (see describe_entity_type). Non-transactional: one item failing (e.g. duplicate slug) does not roll back the others. Returns { results: [{ slug } | { error, code }] } in input order.",
    params: [
      { name: 'type', type: 'string', required: true, description: 'Entity type, e.g. "endpoint"' },
      { name: 'items', type: 'object[]', required: true, description: "Items to create, each matching the type's createSchema" },
    ],
  },
  'entity-tools-update-entities': {
    server: 'entity-tools',
    name: 'update_entities',
    description:
      "Update one or more entities in a single batch. `data` is validated against the type's updateSchema (partial by default). The slug is stable — pass an explicit `newSlug` to rename (collision → SLUG_CONFLICT); a rename propagates to every markdown reference. Non-transactional. Returns { results: [{ slug } | { error, code }] } in input order (slug is the NEW slug if renamed).",
    params: [
      { name: 'type', type: 'string', required: true },
      { name: 'updates', type: 'object[]', required: true },
    ],
  },
  'entity-tools-delete-entities': {
    server: 'entity-tools',
    name: 'delete_entities',
    description:
      'Delete one or more entities in a single batch. Returns broken markdown references per deleted item. Non-transactional. Returns { results: [{ deleted: true, brokenReferences } | { error, code }] } in input order.',
    params: [
      { name: 'type', type: 'string', required: true },
      { name: 'slugs', type: 'string[]', required: true },
    ],
  },
  'endpoint-tools-link-dto': {
    server: 'endpoint-tools',
    name: 'link_dto',
    description:
      'Link a DTO to an endpoint as request body, response, or error response. Optional HTTP status code for response/error. Idempotent.',
    params: DTO_LINK_PARAMS,
  },
  'endpoint-tools-unlink-dto': {
    server: 'endpoint-tools',
    name: 'unlink_dto',
    description: 'Remove a DTO link from an endpoint. Omit statusCode to remove all links (endpoint, dto, relation).',
    params: DTO_LINK_PARAMS,
  },
  "page-tools-create-page": {
    server: "page-tools",
    name: "create_page",
    description:
      "Create a page that does not exist yet. Fails PAGE_EXISTS rather than overwriting — use update_page for an existing one.\nReturns { rootId, path, hash, version, content, anchors }. `content` is the file AS IT SETTLED: omit `content` and it is the generated template, and in either case the reaction chain has already injected `<!-- anchor: … -->` comments for your headings. Edit from it, not from what you sent.",
    params: [
      { name: "rootId", type: "string", required: true, description:
          "Page root id. Part of a page's identity — `(rootId, path)` — not a filter." },
      { name: "path", type: "string", required: true, description:
          "Page path relative to the root, e.g. \"guides/auth.md\"." },
      { name: "title", type: "string", required: false, description:
          "Sets the frontmatter `title` of the generated template. Ignored when `content` is given." },
      { name: "content", type: "string", required: false, description:
          "Full markdown, frontmatter included. Omit it and you get a default template — a frontmatter block with `title`, not an empty file. Overwrite the page afterwards if you truly want it empty." },
    ],
  },
  "page-tools-delete-page": {
    server: "page-tools",
    name: "delete_page",
    description:
      "Delete a page. The previous content stays recoverable through its version history.",
    params: [
      { name: "rootId", type: "string", required: true, description:
          "Page root id. Part of a page's identity — `(rootId, path)` — not a filter." },
      { name: "path", type: "string", required: true, description:
          "Page path relative to the root, e.g. \"guides/auth.md\"." },
    ],
  },
  "page-tools-move-page": {
    server: "page-tools",
    name: "move_page",
    description:
      "Move a page to a different path WITHIN THE SAME ROOT. Renaming a file and moving it to another directory are the same call — only `to` differs.\n`to` is a whole path relative to the root, not a bare filename: moving \"guides/auth.md\" to \"auth.md\" means to: \"auth.md\", and to: \"auth.md\" is NOT how you rename it in place inside `guides/`.\nThe content is never read, re-serialized or returned, so `hash` comes back UNCHANGED — it is echoed because you need it to arm your next write at the new path, not because anything happened to it.\nCitations follow: every `@old/path.md` in the root is rewritten to the new path afterwards, each rewritten page as its own write. That propagation is NOT atomic across those pages, and it is not part of the move — the move has already committed when it runs.\nNOT IDEMPOTENT. Replaying a successful call answers NOT_FOUND, because the source is gone — this is the `delete` class, not the `replace` class.\nRefusals: PAGE_EXISTS (the destination is occupied — it is never overwritten), PAGE_CONFLICT (your `expectedHash` does not match the source), NOT_FOUND (no page at `from`), INVALID_ARGUMENT (a `to` that leaves this root, or equals `from`). None of them touches either file.\nONE FILE per call. A directory move is N of these with no atomicity between them.",
    params: [
      { name: "rootId", type: "string", required: true, description:
          "Page root id. Part of a page's identity — `(rootId, path)` — not a filter." },
      { name: "from", type: "string", required: true, description:
          "The page's current path relative to the root, e.g. \"guides/auth.md\"." },
      { name: "to", type: "string", required: true, description:
          "The destination path, relative to the SAME root and complete — directories included. A path outside this root is INVALID_ARGUMENT; a move between roots is not a move." },
      { name: "expectedHash", type: "string", required: true, description:
          "sha256 of the full file as you last read it — the `hash` from get_page, from the get_page_outline envelope, or from your previous write. REQUIRED in both modes. Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT carrying the current hash, so you can refresh and retry instead of overwriting blind." },
    ],
  },
  "page-tools-update-page": {
    server: "page-tools",
    name: "update_page",
    description:
      "Write a specification page, addressed by `(rootId, path)`. A literal write creates a missing page (create-or-replace). Describe the new content in ONE of two ways, never both: literally via `body` (the complete markdown, optionally with a `frontmatter` object beside it), or differentially via `textEdits` (literal find/replace substitutions applied to the current file). Both, or neither, is an error.\n\nFor a punctual change inside one section prefer `update_sections` (its `rename` keeps the anchor). Use `textEdits` here when the target crosses sections, lies outside any section (frontmatter, preamble) or the page has no section index; use `body` for a wholesale rewrite.\n\nDIFFERENTIAL MODE. `find` matches BYTE FOR BYTE — no whitespace normalisation, no regular expressions. `expectedMatches` OMITTED MEANS EXACTLY ONE match; pass a number, or `\"all\"` for every occurrence. All patterns are counted against the content BEFORE the write: a SET of substitutions, not a sequence — two matches may not overlap.\n\n`expectedHash` is REQUIRED in both modes. It guards one file: N pages are N calls.\n\nANCHOR LOSS, IN BOTH MODES: a write removing a cited `<!-- anchor: … -->` comment is refused with ANCHOR_LOSS (400) naming each anchor and who cites it; name those anchors in `dropAnchors` to go ahead. Differential mode: every entry must lie inside a matched fragment. Literal mode: every entry must be an anchor this page has now (otherwise INVALID_ARGUMENT). The guard runs on every page root. Literal mode is idempotent by content; differential mode is NOT — a repeat answers FIND_NOT_FOUND.\n\nReturns { hash, version, changedAnchors }, plus `replacements` in differential mode and `droppedAnchors` when the write removed any anchor. The page is NOT returned. Anchors are injected for new headings, so the bytes on disk are not the bytes you sent — re-read with `get_page` if you need them; `hash` is taken after that injection. `changedAnchors` is relative to the page BEFORE this write.",
    params: [
      { name: "rootId", type: "string", required: true, description:
          "Page root id. Part of a page's identity — `(rootId, path)` — not a filter." },
      { name: "path", type: "string", required: true, description:
          "Page path relative to the root, e.g. \"guides/auth.md\"." },
      { name: "body", type: "string", required: false, description:
          "LITERAL mode: the complete markdown — either the body alone, with the frontmatter sent beside it in `frontmatter`, or the whole file assembled from get_page (`frontmatter.raw`, preamble, then per item its anchor line, heading line and body) with `frontmatter` omitted. Everything not present here is gone after the write; a page that does not exist yet is created. Mutually exclusive with `textEdits` — giving both, or neither, is INVALID_ARGUMENT." },
      { name: "frontmatter", type: "object", required: false, description:
          "LITERAL mode only: replaces the page's frontmatter wholesale. Omit it to write a page without frontmatter, or when `body` already carries the whole file, frontmatter block included." },
      { name: "textEdits", type: "object[]", required: false, description:
          "DIFFERENTIAL mode: `[{ find, replaceWith, expectedMatches? }]`, matched against the FULL file content INCLUDING frontmatter. `find` is literal, byte for byte. `expectedMatches` omitted means EXACTLY ONE match; a number means exactly that many; `\"all\"` means every occurrence. Zero matches → FIND_NOT_FOUND, whose envelope tells you how many times the pattern would have matched after whitespace normalisation. A count other than declared → MATCH_COUNT_MISMATCH, carrying the real count and each hit as section anchor + line number. Mutually exclusive with `body`." },
      { name: "dropAnchors", type: "string[]", required: false, description:
          "BOTH modes. Anchors this call is allowed to destroy — needed when the write removes an `<!-- anchor: … -->` comment whose anchor is cited elsewhere; without them the write is refused with ANCHOR_LOSS listing who cites what. In DIFFERENTIAL mode every entry must sit inside a MATCHED fragment, not merely somewhere on the page. In LITERAL (`body`) mode the touched scope is the whole page, so every entry must be an anchor this page has now; an anchor you leave out of the new content and do not name here is refused if anything cites it. The guard runs on every page root — each one has a section index." },
      { name: "expectedHash", type: "string", required: true, description:
          "sha256 of the full file as you last read it — the `hash` from get_page, from the get_page_outline envelope, or from your previous write. REQUIRED in both modes. Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT carrying the current hash, so you can refresh and retry instead of overwriting blind." },
    ],
    hints: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  "page-tools-update-sections": {
    server: "page-tools",
    name: "update_sections",
    description:
      "Edit sections of ONE page by anchor. All anchors must be on the SAME page (else INVALID_ARGUMENT).\nEach action takes EXACTLY ONE field: `replace` (the OWN body), `append` (end of the OWN body, before the first subsection) and `insert_after` (after the subtree) take `content`; `edit` (literal substitutions inside the subtree, heading included) takes `textEdits`; `rename` (the heading line alone, level and anchor kept) takes `heading`; `delete` (the SUBTREE with its heading and anchor) takes nothing. Any other combination is INVALID_ARGUMENT for the WHOLE batch. `replace`/`append` refuse a `content` heading at or above the section's level. One anchor may carry several actions.\n`edit` matches BYTE FOR BYTE, on the page as read; one entry may carry many substitutions, a second `edit` on the same anchor is refused. Omitted `expectedMatches` means EXACTLY 1. 0 hits → FIND_NOT_FOUND, wrong count → MATCH_COUNT_MISMATCH. `edit` is NOT idempotent and costs the whole batch its idempotence; `rename` is idempotent by heading text.\nANCHOR LOSS: `delete`, a `find` swallowing an anchor comment, or `content` opening an unclosed code block destroys anchors (an anchor-shaped line inside code never counts). A destroyed CITED anchor refuses the WHOLE batch with ANCHOR_LOSS (400) unless named in `dropAnchors`; an uncited one is only reported. `replace`, `append` and `rename` never drop one.\nANCHOR DUPLICATE: never send an anchor comment for a NEW heading; a value held elsewhere, or over no heading of its own, refuses the WHOLE batch with ANCHOR_DUPLICATE (400), no override.\nTRANSACTIONAL, applied bottom-up regardless of order. `expectedHash` is the PAGE hash and guards the whole batch.\nReturns { path, hash, version, results }: a row per element, in input order: { anchor, action, affectedAnchors, droppedAnchors, addedAnchors }, `replacements` on `edit`, `previousHeading` (text before the write) on `rename`. Dropped/added anchors are reported on success too.",
    params: [
      { name: "expectedHash", type: "string", required: true, description:
          "sha256 of the full file as you last read it — the `hash` from get_page, from the get_page_outline envelope, or from your previous write. REQUIRED in both modes. Missing → INVALID_ARGUMENT; mismatch → PAGE_CONFLICT carrying the current hash, so you can refresh and retry instead of overwriting blind." },
      { name: "edits", type: "object[]", required: true, description:
          "The edits to apply, all addressing sections of one page. replace — swap the section's OWN BODY; deeper headings in `content` become its first children, a heading at or above its level is INVALID_ARGUMENT. append — the same, at the end of the own body. COLLISIONS — each element CLAIMS the page as it was BEFORE the write: `delete` the subtree with its anchor line, `replace` the own body, `edit` each matched fragment, `rename` the anchor and heading lines; `append` and `insert_after` claim only a POINT. INVALID_ARGUMENT when two claims share a character or a point lies strictly INSIDE a claim (an edge is fine), for two elements of the SAME action on one anchor, and for ANY element addressing an anchor inside a deleted subtree. Inserts sharing a position land innermost first — `append` before `insert_after` of the same section, a descendant's before its ancestor's. `results[]` carries one row PER ELEMENT; read them by position." },
      { name: "dropAnchors", type: "string[]", required: false, description:
          "Anchors this batch is allowed to destroy. Required only for dropped anchors that are CITED elsewhere — without them the batch is refused with ANCHOR_LOSS. Every entry must lie inside the scope the batch actually TOUCHES: the addressed subtree for `delete` and `insert_after`, the matched fragments for `edit`, the sections a never-closed code block in `content` swallows, and NOTHING at all for `replace` and `append`, which write only the section's own body, or for `rename`, which writes only its heading line — so none of those three can drop an anchor, and naming one there (a subsection under a `replace` included) is INVALID_ARGUMENT; listing MORE than the batch actually drops inside that scope is fine, so a repeated call can send the same list unchanged." },
    ],
  },

};

/**
 * The registered tool matches its record: name, description verbatim, the
 * parameter set with each one's type, requiredness and description, and exactly
 * the record's non-empty hints as annotations (none when every hint is empty).
 */
export function expectToolMatchesWriteRecord(tool: DeclaredTool | undefined, slug: string): void {
  const record = WRITE_TOOL_RECORDS[slug];
  expect(record, `record ${slug}`).toBeDefined();
  expectToolMatchesToolRecord(tool, record!);
}

/**
 * The same check against a record held elsewhere (e.g. `brief-tool-records.ts`):
 * name, description verbatim, parameters with type / requiredness / description,
 * and exactly the record's non-empty hints as annotations.
 */
export function expectToolMatchesToolRecord(tool: DeclaredTool | undefined, record: WriteToolRecord): void {
  expect(tool, `tool ${record.server} · ${record.name}`).toBeDefined();
  expect(tool!.name).toBe(record!.name);
  expect(tool!.description).toBe(record!.description);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  expect([...declaredParams(tool!)].sort(byName)).toEqual([...record!.params].sort(byName));
  const declared = Object.fromEntries(
    Object.entries(record!.hints ?? {}).filter((entry): entry is [string, boolean] => entry[1] !== null),
  );
  expect(tool!.annotations ?? {}).toEqual(declared);
}
