/**
 * 2.1.26 — the `mcp-tool` records of the core read tools (M39 renderings on
 * `c4s-reader`, `reference-tools` and `entity-tools`), as the specification states
 * them at release 2.1.26: name, server, the description the model reads, and the
 * declared parameters. Copied from the records, not from the code — the tests that
 * read this file hold the registered tools against it.
 *
 * Every hint of every record here is empty: the servers declare none.
 */

import { expect } from 'vitest';
import { z } from 'zod';

export interface ReadToolRecord {
  server: 'c4s-reader' | 'reference-tools' | 'entity-tools';
  name: string;
  description: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
  hints: Record<'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint', boolean | null>;
}

export const READ_TOOL_RECORDS: Record<string, ReadToolRecord> = {
  "reference-tools-check-consistency": {
    "server": "reference-tools",
    "name": "check_consistency",
    "description": "Run a full consistency check across pages, entities, and tags — 16 rules. `brokenReferences` collects rules 1, 5, 6 and 12 in ONE list, each row carrying `reason`: \"missing\" (rule 1 — no such entity), \"inactive\" (rule 5 — the type's plugin is not active), \"unknown\" (rule 6 — no such type); the type is always resolved from the tag's `type` attribute, hidden types like `diagram` included (rule 12). Also: orphaned entity_tag rows (rule 2), unreferenced entities (3), invalid tag references (4), unanchored headings (7 — section-indexed roots; a `## X` inside a code block is not a heading), broken <section_ref/> anchors (8), broken AC verifies (9), entity-without-AC-coverage (10 — config.consistency.requireAcCoverage), module-without-AC (11 — config.consistency.requireModuleAc), duplicate anchors (13 — the row lists EVERY location; a line inside a code block does not count), tags-without-consumer (14 — config.consistency.requireTagConsumer; `entity-{slug}` and `mNN` tags on ACs are exempt), anchor lines in code (15 — `anchorLinesInCode`; informational) and code blocks never closed (16 — `unclosedCodeBlocks`: an open fence or multi-line HTML comment running to the end of the page, `line` = its opening line; below it headings make no sections, and its XML tags are not rewritten on a slug/anchor change, not checked by rules 1 and 3, not returned by find_references and not indexed as todos; informational). Every row that points at a page carries the page key `rootId` + `pagePath` (rules 11, 15 and 16 included); in a root without section anchors such a row is addressed by `rootId`, `pagePath` and `line`, without an anchor. Optional filters: `severity` (\"error\" | \"warning\"), `rule` (1–16 or a name), `limit` (per-bucket cap). The envelope carries `truncated: true` whenever `limit` actually cut a bucket — `summary` always counts the WHOLE project, before any filter.",
    "params": [
      {
        "name": "severity",
        "type": "enum(error, warning)",
        "required": false
      },
      {
        "name": "rule",
        "type": "string | number",
        "required": false,
        "description": "Rule number or name, 1 to 16"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-check-consistency": {
    "server": "c4s-reader",
    "name": "check_consistency",
    "description": "Run the 16 consistency rules over every reference-validated root and every active type: broken embeds in ONE `brokenReferences` list with `reason` missing | inactive | unknown (rules 1/5/6/12), orphaned entity_tag rows, unreferenced entities, invalid tag references, unanchored headings, broken section refs, broken AC verifies, coverage rules, duplicate anchors (rule 13 — one anchor comment on two headings; the row lists every location), tags no embed consumes (rule 14 — config-flagged), anchor lines inside code blocks (rule 15 — `anchorLinesInCode`) and code blocks open to the end of a page (rule 16 — `unclosedCodeBlocks`); 15 and 16 are informational. Filter with `severity` (\"error\" | \"warning\"), `rule` (number or name) or `limit` (a per-section cap) — `summary` always carries the FULL counts, so a filtered report still says what it hid. This is also the right home for disk-versus-index drift; that is not a mode of a page-listing tool.",
    "params": [
      {
        "name": "severity",
        "type": "enum(error, warning)",
        "required": false,
        "description": "Keep only rows of this severity"
      },
      {
        "name": "rule",
        "type": "string | number",
        "required": false,
        "description": "Rule number or name, 1 to 16"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Per-section cap; summary still counts everything"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "entity-tools-describe-entity-type": {
    "server": "entity-tools",
    "name": "describe_entity_type",
    "description": "Introspect one or all active entity types. Call it before a WRITE to learn createSchema/updateSchema and the value `constraints` a write must satisfy — and before a READ to learn `selectableFields` (the names get_entities `select` accepts), `contentFields` (fields no generic read carries, each with the operation that issues its content) and `searchableFields` (the dotted paths search consults). All four are DERIVED from the type's declared data schema rather than declared by the type, so what a type advertises and what the host enforces cannot drift. Omit `type` for all active types.",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-describe-types": {
    "server": "c4s-reader",
    "name": "describe_types",
    "description": "The JSON Schema of each entity type's read record, plus what you need before a read: `constraints` (per-field value rules), `contentFields` (fields withheld from every record, each with the operation that issues its content), `selectableFields` (the names legal in `get_entities`' `select`) and `searchableFields` (the paths a search_entities call would actually cover). Omit `types` for every active type. ONE schema per type, DERIVED from the type's declared data schema — a type contributes no read code, so there is nothing else it could be. A type deactivated in config answers INVALID_TYPE with the active list, never a raw-JSON fallback.",
    "params": [
      {
        "name": "types",
        "type": "string[]",
        "required": false,
        "description": "Restrict to these types; omit for all active types"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "reference-tools-find-references": {
    "server": "reference-tools",
    "name": "find_references",
    "description": "Who points at this? Three targets: { target: \"entity\", type, slug } — which pages embed it, and with `includeTagMatches` also the <tagged_list/> / <tagged_list_mixed/> pages whose `tags` intersect the entity's (those rows carry `via: string[]`); { target: \"section\", anchor } — who cites this section; { target: \"page\", rootId, path } — who links this page, full key required. Calling without `target` returns INVALID_ARGUMENT listing the variants. A target with no references is a SUCCESS with an empty list and total: 0. Rows carry `rootId`, and the sweep covers every reference-validated root. Each row is `{ rootId, pagePath, anchor?, tagType, line, raw?, via? }` with mandatory `total` and `hasMore`; in a root without section anchors (its kind does not inject them) a row has no `anchor` — it is addressed by `rootId`, `pagePath` and `line`. Scope is document edges — entity-to-entity links specific to a type (ac.verifies, foreign keys) are entity data, and check_consistency rule 9 reports their integrity. Use it to see where something is used before modifying or deleting it.",
    "params": [
      {
        "name": "target",
        "type": "enum(entity, section, page)",
        "required": false,
        "description": "Identity regime of the target; required"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "With target:\"entity\" — entity type"
      },
      {
        "name": "slug",
        "type": "string",
        "required": false,
        "description": "With target:\"entity\" — entity slug"
      },
      {
        "name": "anchor",
        "type": "string",
        "required": false,
        "description": "With target:\"section\" — section anchor"
      },
      {
        "name": "rootId",
        "type": "string",
        "required": false,
        "description": "With target:\"page\" — which page root"
      },
      {
        "name": "path",
        "type": "string",
        "required": false,
        "description": "With target:\"page\" — page path relative to the root"
      },
      {
        "name": "includeTagMatches",
        "type": "boolean",
        "required": false
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-find-references": {
    "server": "c4s-reader",
    "name": "find_references",
    "description": "Who points at this? Three targets: { target: \"entity\", type, slug } — which pages embed it, and with includeTagMatches also the <tagged_list/> pages whose tags intersect the entity's; { target: \"section\", anchor } — who cites this section; { target: \"page\", rootId, path } — who links this page, full key required. Calling without `target` returns INVALID_ARGUMENT listing the variants. A target with no references is a SUCCESS with an empty list and total: 0. Scope is document edges — entity-to-entity links specific to a type (ac.verifies, foreign keys) are entity data, and check_consistency rule 9 reports their integrity.",
    "params": [
      {
        "name": "target",
        "type": "enum(entity, section, page)",
        "required": false,
        "description": "Identity regime of the target; required"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "With target:\"entity\" — entity type"
      },
      {
        "name": "slug",
        "type": "string",
        "required": false,
        "description": "With target:\"entity\" — entity slug"
      },
      {
        "name": "anchor",
        "type": "string",
        "required": false,
        "description": "With target:\"section\" — section anchor"
      },
      {
        "name": "rootId",
        "type": "string",
        "required": false,
        "description": "With target:\"page\" — which root"
      },
      {
        "name": "path",
        "type": "string",
        "required": false,
        "description": "With target:\"page\" — page path relative to the root"
      },
      {
        "name": "includeTagMatches",
        "type": "boolean",
        "required": false,
        "description": "Also report tag-driven (dynamic) references"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Page size; the core applies a default and a cap"
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "description": "Rows to skip; a stable sort makes it meaningful"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "entity-tools-get-entities": {
    "server": "entity-tools",
    "name": "get_entities",
    "description": "Fetch multiple entities of the same type by slug. Missing slugs come back as { slug, entity: null } WITHOUT `truncated`, not an error. The response has a size budget: nothing you named is dropped, but an item past the budget comes back with `entity: null` AND `truncated: true` — which is what keeps \"no such entity\" distinguishable from \"cut for size\" — while the envelope's `message` says how to retry. The FIRST item is never degraded that way; a one-slug call is already the smallest retry, so it is emitted whole. Record width is yours to choose with `select`; the envelope echoes `selectedFields`, so a narrow record is distinguishable from an entity holding little data. Content-bearing fields never travel here — fetch them with get_field_content. Does NOT expand embedded mentions and does NOT take a view.",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": true,
        "description": "Entity type, e.g. \"endpoint\""
      },
      {
        "name": "slugs",
        "type": "string[]",
        "required": true
      },
      {
        "name": "select",
        "type": "string[]",
        "required": false,
        "description": "Top-level field names to return; slug, title and tags always come back. Omit for every field except content-bearing ones. [] for the identity skeleton alone. A dotted path, a [] suffix or an unknown name is INVALID_ARGUMENT with the legal names attached. Naming a content-bearing field is allowed and answers with its descriptor plus the operation that issues the content. Call describe_entity_type for selectableFields."
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-get-entities": {
    "server": "c4s-reader",
    "name": "get_entities",
    "description": "Fetch entities of one type by slug list — one slug is simply a list of one. Resolves <single_element type=\"...\" slug=\"...\"/>, <inline_mention .../> and <element_list type=\"...\" slugs=\"a,b,c\"/>; `select` decides how wide the answer is, and the same call answers all three. Omit `select` for the full record, pass [] for the identity skeleton a chip or a list row needs, or name the fields you will actually render. `slugs` has a hard length limit (exceeding it is INVALID_ARGUMENT stating the limit), and the response has a size budget: nothing you named is ever dropped, but an item past the budget comes back with `entity: null` AND `truncated: true`, and the envelope's `message` says how to retry. The FIRST item never degrades that way — a one-slug call is already the smallest retry, so it is emitted whole. A slug that does not exist comes back as `entity: null` WITHOUT `truncated`, which is how \"no such entity\" stays distinguishable from \"cut for size\". The response echoes the fields it used as `selectedFields`, and that list can be handed straight back as a `select`.",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": true,
        "description": "Entity type"
      },
      {
        "name": "slugs",
        "type": "string[]",
        "required": true,
        "description": "Slugs to fetch, in order"
      },
      {
        "name": "select",
        "type": "string[]",
        "required": false,
        "description": "Top-level field names to return; slug, title and tags always come back. Omit for every field except content-bearing ones; [] for the identity skeleton alone. See describe_types.selectableFields."
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "reference-tools-get-page": {
    "server": "reference-tools",
    "name": "get_page",
    "description": "Read one WHOLE page as a collection of sections, addressed by the FULL key of `rootId` plus `path`. A bare path is ambiguous across roots, so a call without `rootId` is refused with the list of page roots rather than guessing the built-in one.\n\nThe answer is an envelope `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`. `results` is a FLAT list in document order, one item per section: `anchor`, `heading_text`, `heading_level`, `body`. The anchor is a field of the item, never a comment to parse out of text. `body` excludes the anchor line and the heading line and is otherwise a literal slice of the file, so `textEdits` match it as written; a parent carries only its own body, up to its first child heading. Under a heading the indexer has not tagged yet the item has no `anchor` — readable, not addressable by `get_sections`.\n\n`frontmatter` is `{ raw, fields? }`: `raw` is the literal block, `fields` the parsed keys, absent when the YAML does not parse. `preamble` is the text before the first heading. Embeds are never expanded — a tag is an edge; fetch the entity by its slug.\n\nThe structure is computed from the file, not from the index, so this call answers even while `get_page_outline` and `get_sections` refuse with `INDEX_STALE`. `hash` is the sha256 of the WHOLE file and arms `expectedHash` on a write even when the answer was cut.\n\nOver the budget, an item that does not fit keeps its anchor and heading, loses `body` and carries `truncated: true`; the first item is never dropped — its body is cut as text. `message` names the cut anchors: fetch them with `get_sections`, and write with `update_sections` using `hash` as `expectedHash`. There is no line window: a cut read resumes only through `get_page_outline` and `get_sections`. The call is refused when `rootId` is missing, when it does not name a page root (a system root such as `plans` is refused like an unknown one), or when the page does not exist.",
    "params": [
      {
        "name": "rootId",
        "type": "string",
        "required": false,
        "description": "Which page root — required"
      },
      {
        "name": "path",
        "type": "string",
        "required": false,
        "description": "Page path relative to the root"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-get-page": {
    "server": "c4s-reader",
    "name": "get_page",
    "description": "Get one whole page as a collection of sections. Requires the full page key: both `rootId` and `path`.\n\nA call without `rootId` is refused with the list of roots rather than quietly falling back to a default root. Get the roots from `overview` and the paths from `list_pages`.\n\nThe answer carries the page `hash`, its `frontmatter` and `preamble`, and `results`: a flat list in document order with one item per section — its anchor, heading text, heading level and body. The anchor is a field of the item, so you can pass it straight to `get_sections`. A body holds neither the anchor line nor the heading line; a parent carries only its own body. An item under a heading that has no anchor yet comes without one.\n\n`frontmatter` gives the literal block (`raw`) and its parsed keys (`fields`); the keys are missing when the YAML does not parse, and `raw` is then the way to repair it.\n\nThe structure is read from the file, not from the index, so this call still answers when `get_page_outline` and `get_sections` refuse because the index is stale. `hash` is the sha256 of the whole file and works as `expectedHash` on a write even when the answer was cut.\n\nThe tool never expands embeds: an embedded entity's data is fetched separately with `get_entities`, using the slug carried in the embed tag.\n\nOn a large page, sections that do not fit keep their anchor and heading but come without a body, and the message names them so you can fetch them with `get_sections` — then write with `update_sections`, passing `hash` as `expectedHash`.\n\nThere is no line window: a cut read resumes through `get_page_outline` and `get_sections` alone. The call is refused when `rootId` is missing, when it does not name a page root, or when the page does not exist. The response is `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`; an item of `results` is `{ anchor?, heading_text, heading_level, body, truncated? }`.",
    "params": [
      {
        "name": "rootId",
        "type": "string",
        "required": false,
        "description": "Which page root — required; see overview().roots"
      },
      {
        "name": "path",
        "type": "string",
        "required": false,
        "description": "Page path relative to the root"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "reference-tools-get-page-outline": {
    "server": "reference-tools",
    "name": "get_page_outline",
    "description": "One page's headings as a TREE in document order — the cheap step between locating a page and paying for any of its text. Takes the page key and NOTHING else: no anchor variant, no fuzzy heading search, no limit/offset, no depth cap. Every node carries the section's anchor, so you can pick exactly the anchors worth fetching with get_sections. It emits no content — bodies come from get_sections. It refuses as a WHOLE: an unknown path on a known page root is PAGE_NOT_FOUND, and an unknown root — or one that is not a page root — is INVALID_ARGUMENT listing the page roots. The response is `{ rootId, path, hash, frontmatter?, preamble?, sections[], truncated?, message? }`. `frontmatter` is `{ fields?, size }` — ALL the parsed keys, with `fields` absent when the YAML does not parse — and `preamble` is `{ size }`, present when the page has text above its first heading. The frontmatter is never cut: over budget it ships whole beside a prefix of the tree, and a frontmatter that alone exceeds the budget comes back with `sections: []` and a `message` pointing at get_page. A node is `{ anchor, heading, level, size }` plus `children` ONLY when it has any. `size` is the byte length of that section's OWN body, exactly what get_sections yields at EITHER setting of `includeSubtree`. `hash` is on the ENVELOPE: the sha256 of the WHOLE page file, exactly what update_page / update_sections want as `expectedHash` — so a sectional edit closes with get_page_outline -> get_sections -> update_sections. A node carries NO `content_hash` and NO `heading_path`; the envelope carries no `total`, `hasMore`, `limit` or `offset`. Over budget, `truncated: true` and the tree comes back as a PREFIX in which every node has its parent. There is no smaller retry — go on from the anchors you already have.",
    "params": [
      {
        "name": "rootId",
        "type": "string",
        "required": true,
        "description": "Which page root. Required — the same relative path can exist in several roots."
      },
      {
        "name": "path",
        "type": "string",
        "required": true,
        "description": "Page path relative to the root."
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-get-page-outline": {
    "server": "c4s-reader",
    "name": "get_page_outline",
    "description": "One page's headings as a TREE in document order — the cheap step between locating a page and paying for any of its text. Takes the page key and NOTHING else: no anchor variant, no fuzzy heading search (to find a section by text, call search_pages, whose hit ALREADY carries the anchor), no limit/offset, no depth cap. It emits no content. It refuses as a WHOLE: an unknown path on a known page root is PAGE_NOT_FOUND, and an unknown root — or one that is not a page root — is INVALID_ARGUMENT listing the page roots. The response is `{ rootId, path, hash, frontmatter?, preamble?, sections[], truncated?, message? }`. `frontmatter` is `{ fields?, size }` — ALL the parsed keys, with `fields` absent when the YAML does not parse — and `preamble` is `{ size }`, present when the page has text above its first heading. The frontmatter is never cut: over budget it ships whole beside a prefix of the tree, and a frontmatter that alone exceeds the budget comes back with `sections: []` and a `message` pointing at get_page. A node is `{ anchor, heading, level, size }` plus `children` ONLY when it has any. `size` is the byte length of that section's OWN body, exactly what get_sections yields at EITHER setting of `includeSubtree`. `hash` is on the ENVELOPE: the sha256 of the WHOLE page file, exactly what update_page / update_sections want as `expectedHash` — so a sectional edit closes with get_page_outline -> get_sections -> update_sections. A node carries NO `content_hash` and NO `heading_path`; the envelope carries no `total`, `hasMore`, `limit` or `offset`. Over budget, `truncated: true` and the tree comes back as a PREFIX in which every node has its parent. There is no smaller retry — go on from the anchors you already have.",
    "params": [
      {
        "name": "rootId",
        "type": "string",
        "required": true,
        "description": "Which page root. Required — the same relative path can exist in several roots."
      },
      {
        "name": "path",
        "type": "string",
        "required": true,
        "description": "Page path relative to the root."
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "reference-tools-get-sections": {
    "server": "reference-tools",
    "name": "get_sections",
    "description": "Read sections BY ANCHOR — pass every anchor you need in ONE call. Each section comes back as its own item: identity, heading and body as authored — XML tags left untouched (to follow an embed, call get_entities with the slug it carries). An unknown anchor comes back as `{ anchor, error, code: \"SECTION_NOT_FOUND\" }` in its own slot rather than failing the batch. The response is `{ results: [...], truncated?, message? }` with ONE ITEM PER SECTION — the requested anchors in input order (duplicates silently collapsed), and with `includeSubtree: true` every section beneath each as its OWN item, directly behind it in document order. An item is `{ anchor, rootId, page_path, heading_text, heading_level, body, truncated?, edges? }` or `{ anchor, error, code }` — NO line numbers and no `content_hash`. A parent carries ONLY ITS OWN BODY, ending before its first child heading, at either setting of the flag. De-duplication is global: an anchor also inside another's subtree appears once, at its own input position. THREE VALVES: `anchors` longer than 50 (or empty) is INVALID_ARGUMENT; after expansion, more than 50 items is CUT to the first 50 (requested anchors keep their items; error items count) with `truncated: true` and a `message` — the rest are ABSENT: do not retry with fewer anchors, list the subtree with get_page_outline; THEN past the response budget items keep identity and heading, GAIN `edges` and lose `body`, marked `truncated: true` — retry as a smaller subset. The FIRST item never degrades that way: an over-budget body comes back shortened as text with `truncated: true` AND `edges`. `edges` accompanies an item IF AND ONLY IF it carries `truncated: true`, parsed from its FULL OWN BODY: `sectionRefs: [{ anchor }]`, `entityEmbeds: [{ tagType, type, slug?, slugs?, tags?, filter? }]`, `pageLinks: [{ rootId, path, anchor? }]`. A duplicate anchor resolves to the lowest (rootId, page_path), then the first occurrence; `check_consistency` rule 13 reports it.",
    "params": [
      {
        "name": "anchors",
        "type": "string[]",
        "required": true,
        "description": "Section anchors (6-12 lowercase alphanumerics each), in order"
      },
      {
        "name": "includeSubtree",
        "type": "boolean",
        "required": false,
        "description": "Also return every section beneath each anchor as its OWN item, in document order behind it. Widens the set of items, never an item's body — a parent carries only its own body either way."
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-get-sections": {
    "server": "c4s-reader",
    "name": "get_sections",
    "description": "Read sections BY ANCHOR — pass every anchor you need in ONE call. Each section comes back as its own item: identity, heading and body as authored — XML tags left untouched (to follow an embed, call get_entities with the slug it carries). An unknown anchor comes back as `{ anchor, error, code: \"SECTION_NOT_FOUND\" }` in its own slot rather than failing the batch. The response is `{ results: [...], truncated?, message? }` with ONE ITEM PER SECTION — the requested anchors in input order (duplicates silently collapsed), and with `includeSubtree: true` every section beneath each as its OWN item, directly behind it in document order. An item is `{ anchor, rootId, page_path, heading_text, heading_level, body, truncated?, edges? }` or `{ anchor, error, code }` — NO line numbers and no `content_hash`. A parent carries ONLY ITS OWN BODY, ending before its first child heading, at either setting of the flag. De-duplication is global: an anchor also inside another's subtree appears once, at its own input position. THREE VALVES: `anchors` longer than 50 (or empty) is INVALID_ARGUMENT; after expansion, more than 50 items is CUT to the first 50 (requested anchors keep their items; error items count) with `truncated: true` and a `message` — the rest are ABSENT: do not retry with fewer anchors, list the subtree with get_page_outline; THEN past the response budget items keep identity and heading, GAIN `edges` and lose `body`, marked `truncated: true` — retry as a smaller subset. The FIRST item never degrades that way: an over-budget body comes back shortened as text with `truncated: true` AND `edges`. `edges` accompanies an item IF AND ONLY IF it carries `truncated: true`, parsed from its FULL OWN BODY: `sectionRefs: [{ anchor }]`, `entityEmbeds: [{ tagType, type, slug?, slugs?, tags?, filter? }]`, `pageLinks: [{ rootId, path, anchor? }]`. A duplicate anchor resolves to the lowest (rootId, page_path), then the first occurrence; `check_consistency` rule 13 reports it.",
    "params": [
      {
        "name": "anchors",
        "type": "string[]",
        "required": true,
        "description": "Section anchors (6-12 lowercase alphanumerics each), in order"
      },
      {
        "name": "includeSubtree",
        "type": "boolean",
        "required": false,
        "description": "Also return every section beneath each anchor as its OWN item, in document order behind it. Widens the set of items, never an item's body — a parent carries only its own body either way."
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "entity-tools-list-entities": {
    "server": "entity-tools",
    "name": "list_entities",
    "description": "List entities of a type with optional tag filtering and pagination. Returns { items, total, hasMore } where each item is the frozen row { slug, title } — this operation takes no `select` and has no width to ask for; call get_entities with an explicit `select` when you need fields. Or { total } with mode: \"count\" — which answers \"how many entities match\" without walking them. `filters` matches on the type's own declared scalar fields: { field: value } or { field: [v1, v2] } for set membership, ANDed together and with the tag filter (e.g. ac: { status: \"active\", kind: \"edge-case\" }). See describe_entity_type's createSchema for the fields a type declares; a key naming no declared field is ignored. NOTE: a type may declare a DEFAULT filter that applies when you name no value for that field — `ac` lists only active ACs unless you ask for { status: [\"active\", \"deprecated\"] }.",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": true
      },
      {
        "name": "tags",
        "type": "string[]",
        "required": false
      },
      {
        "name": "tagFilter",
        "type": "enum(and, or)",
        "required": false
      },
      {
        "name": "filters",
        "type": "object",
        "required": false
      },
      {
        "name": "mode",
        "type": "enum(items, count)",
        "required": false
      },
      {
        "name": "limit",
        "type": "number",
        "required": false
      },
      {
        "name": "offset",
        "type": "number",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-list-entities": {
    "server": "c4s-reader",
    "name": "list_entities",
    "description": "Complete, paginated traversal of one entity type, optionally narrowed to tags. This is what lets search be best-effort rather than load-bearing: an entity with no tags is still reachable by enumeration, so tags are an accelerator and not a closure. Resolves <tagged_list type=\"...\" tags=\"a,b\" filter=\"and\"/>. `mode: \"count\"` answers \"how many entities carry tag X\" without walking them. An EMPTY tags array filters by nothing and so matches nothing; omit it for no tag filter.",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": true,
        "description": "Entity type"
      },
      {
        "name": "tags",
        "type": "string[]",
        "required": false,
        "description": "Tag slugs; omit for no filter"
      },
      {
        "name": "tagFilter",
        "type": "enum(and, or)",
        "required": false,
        "description": "How to combine tags; default \"and\""
      },
      {
        "name": "sort",
        "type": "enum(createdAt, title, slug)",
        "required": false,
        "description": "Row order; default \"createdAt\", the only one whose offset window is write-stable"
      },
      {
        "name": "dir",
        "type": "enum(asc, desc)",
        "required": false,
        "description": "Direction; default \"asc\""
      },
      {
        "name": "mode",
        "type": "enum(items, count)",
        "required": false,
        "description": "Shape of the answer; default \"items\""
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Page size; the core applies a default and a cap"
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "description": "Rows to skip; a stable sort makes it meaningful"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "reference-tools-list-pages": {
    "server": "reference-tools",
    "name": "list_pages",
    "description": "List the pages of one root, paginated, each with a title, section count, byte size and mtime — the domain replacement for globbing the specification. `rootId` is required because the same relative path can exist in several roots; `sort` is an explicit parameter (\"path\" by default and deterministic, or \"modified\"). The root list holds page roots only, so no call here can name a brief, a patch or the entity catalogue.",
    "params": [
      {
        "name": "rootId",
        "type": "string",
        "required": true,
        "description": "Which page root"
      },
      {
        "name": "prefix",
        "type": "string",
        "required": false,
        "description": "Restrict to paths starting with this prefix"
      },
      {
        "name": "sort",
        "type": "enum(path, modified)",
        "required": false,
        "description": "Order; default \"path\""
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-list-pages": {
    "server": "c4s-reader",
    "name": "list_pages",
    "description": "List the pages of one root, paginated, each with a title, section count, byte size and mtime. This is the full replacement for globbing the specification: `rootId` is required because the same relative path can exist in several roots, `sort` is an explicit parameter (\"path\" by default and deterministic, or \"modified\"), and the root list holds page roots only — there is no way to name a brief, a patch or the entity catalogue from here.",
    "params": [
      {
        "name": "rootId",
        "type": "string",
        "required": true,
        "description": "Which page root — see overview().roots"
      },
      {
        "name": "prefix",
        "type": "string",
        "required": false,
        "description": "Restrict to paths starting with this prefix"
      },
      {
        "name": "sort",
        "type": "enum(path, modified)",
        "required": false,
        "description": "Order; default \"path\" (deterministic)"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Page size; the core applies a default and a cap"
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "description": "Rows to skip; a stable sort makes it meaningful"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "reference-tools-list-tags": {
    "server": "reference-tools",
    "name": "list_tags",
    "description": "List the project tags, paginated. `withCounts` is OFF by default because full per-type counts are a cartesian product of tags by active types — ask for them when you need them, or use `minCount` to keep only tags used at least N times. `coOccurringWith` takes a tag slug and returns the tags sharing entities with it, with multiplicity: the way to discover a taxonomy without already knowing it. Returns { items, total, hasMore }.",
    "params": [
      {
        "name": "withCounts",
        "type": "boolean",
        "required": false,
        "description": "Include per-type usage counts; default false"
      },
      {
        "name": "minCount",
        "type": "integer",
        "required": false,
        "description": "Only tags used at least this many times"
      },
      {
        "name": "coOccurringWith",
        "type": "string",
        "required": false,
        "description": "Tag slug — return the tags sharing entities with it"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-list-tags": {
    "server": "c4s-reader",
    "name": "list_tags",
    "description": "List the project tags, paginated. `withCounts` is OFF by default because full counts are a cartesian product of tags by active types — turn it on when you need them, or use `minCount` to keep only tags used at least N times. `coOccurringWith` takes a tag slug and returns the tags sharing entities with it, with multiplicity: the only way to discover a taxonomy without already knowing it.",
    "params": [
      {
        "name": "withCounts",
        "type": "boolean",
        "required": false,
        "description": "Include per-type usage counts; default false"
      },
      {
        "name": "minCount",
        "type": "integer",
        "required": false,
        "description": "Only tags used at least this many times"
      },
      {
        "name": "coOccurringWith",
        "type": "string",
        "required": false,
        "description": "Tag slug — return the tags sharing entities with it"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Page size; the core applies a default and a cap"
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "description": "Rows to skip; a stable sort makes it meaningful"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-overview": {
    "server": "c4s-reader",
    "name": "overview",
    "description": "ENTRY POINT. One call that says what this specification contains: the page roots (`{ id, name, dir, builtin, pageCount }` each — only roots of kind `pages` are addressable, and every one of them has a section index, so a search hit inside a section always carries an `anchor`), the active entity types with a row count and payload version each, the tag count, and the claude4spec version. Cheap: no schemas, no views; call describe_types for those.",
    "params": [],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "entity-tools-resolve-identity": {
    "server": "entity-tools",
    "name": "resolve_identity",
    "description": "The one cross-type operation: given a fragment of a name or a slug, which entities could you have meant? It matches IDENTITY fields (slug, name, label) across types and returns ranked candidates — it will not find a phrase buried in a description. Use it when you do not know the type; once you know the type and slug, go to get_entities.",
    "params": [
      {
        "name": "query",
        "type": "string",
        "required": true,
        "description": "Name or slug fragment"
      },
      {
        "name": "types",
        "type": "string[]",
        "required": false,
        "description": "Restrict to these types; omit for all active types"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Max candidates"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-resolve-identity": {
    "server": "c4s-reader",
    "name": "resolve_identity",
    "description": "The one cross-type operation: given a fragment of a name or a slug, which entities could you have meant? It matches IDENTITY fields (slug, name, label) across types and returns ranked candidates — a façade over the per-type indexes rather than a cross-type full-text index, so it will not find a phrase buried in a description. This is the compensation for search_entities requiring a single type; once you know the type and slug, go to get_entities.",
    "params": [
      {
        "name": "query",
        "type": "string",
        "required": true,
        "description": "Name or slug fragment"
      },
      {
        "name": "types",
        "type": "string[]",
        "required": false,
        "description": "Restrict to these types; omit for all active types"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Max candidates"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "entity-tools-search-entities": {
    "server": "entity-tools",
    "name": "search_entities",
    "description": "Search within exactly ONE entity type — `type` is required; to find an entity across types by name or slug, use resolve_identity. TWO INPUTS, exactly one of them: `query` is a case-insensitive substring (a multi-word value matches only as an exact PHRASE — no tokenization, so build flexibility into `regex`, e.g. \"kaucj\\w*\"), `regex` is a JavaScript pattern body. Both, or neither, is INVALID_ARGUMENT. THREE MODES, a ladder of cost: \"count\" returns only the totals (`total` entities, `matches` occurrences); \"map\" (DEFAULT) returns `{ slug, title, matchCount }` and not one character of entity content; \"hits\" adds `hunks[]` (`{ field, text, matches }`) and `omittedChars`. A HIT IS AN ENTITY, a MATCH is an occurrence: an entity matched twice is ONE row with `matchCount: 2`, never two rows sharing a slug. There is NO `score` in any mode — the ORDER is the contract: with `query` exact > prefix > substring position > slug ascending, with `regex` slug ascending, both fully tie-broken so `limit`/`offset` return every hit exactly once. A hunk's `field` is a legal `select` value for get_entities and never a `contentBearing` field, so \"hits\" never issues content a plain get_entities would withhold. The window is fixed and measured in CHARACTERS; there is no `context` parameter. Unlike search_pages, a pattern crossing a line (`\\n`, `[\\s\\S]`) is LEGAL — it matches the full field VALUE, not a line. The scope is `fields` if you pass it, else every text path derived from the type's declared data schema; the response always carries `searchedFields` — the paths actually consulted. `filters` narrows by the type's own declared scalar fields, exactly as in list_entities, default predicate included (`ac` searches only active ACs unless you ask for { status: [\"active\",\"deprecated\"] }). An over-long `regex` is refused with INVALID_ARGUMENT naming the ceiling; a run that exhausts the core time budget answers SEARCH_BUDGET_EXCEEDED, whose message names the valves (`type`, `fields`).",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": true
      },
      {
        "name": "query",
        "type": "string",
        "required": false
      },
      {
        "name": "regex",
        "type": "string",
        "required": false
      },
      {
        "name": "fields",
        "type": "string[]",
        "required": false
      },
      {
        "name": "mode",
        "type": "enum(count, map, hits)",
        "required": false
      },
      {
        "name": "limit",
        "type": "number",
        "required": false
      },
      {
        "name": "offset",
        "type": "number",
        "required": false
      },
      {
        "name": "filters",
        "type": "object",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-search-entities": {
    "server": "c4s-reader",
    "name": "search_entities",
    "description": "Search within exactly ONE entity type — `type` is required; use resolve_identity to search identities across types. TWO INPUTS, exactly one of them: `query` (case-insensitive substring; a multi-word value matches only as an exact PHRASE — no tokenization, so build flexibility into `regex`, e.g. \"kaucj\\w*\") or `regex` (a JavaScript pattern body). Both, or neither, is INVALID_ARGUMENT. THREE MODES, a ladder of cost: \"count\" returns only the totals (`total` entities, `matches` occurrences); \"map\" (DEFAULT) returns `{ slug, title, matchCount }` with not one character of entity content; \"hits\" adds `hunks[]` (`{ field, text, matches }`) and `omittedChars`. A HIT IS AN ENTITY, a MATCH is an occurrence: an entity matched twice is ONE row with `matchCount: 2`, never two rows sharing a slug. There is NO `score` in any mode — the ORDER carries the contract: with `query` exact > prefix > substring position > slug ascending, with `regex` slug ascending, both fully tie-broken so `limit`/`offset` return every hit exactly once. A hunk's `field` is a legal `select` value for get_entities and never a `contentBearing` field, so \"hits\" issues nothing a plain get_entities would withhold; the window is character-based and fixed, so there is no `context` here. Unlike search_pages, a pattern crossing a line (`\\n`, `[\\s\\S]`) is LEGAL, because the unit here is the whole field VALUE. The scope is your `fields` if given, else the host default over every text path of the type's schema; the response always carries `searchedFields`, without which an empty result is indistinguishable from a field that was never in scope. An over-long `regex` is INVALID_ARGUMENT naming the ceiling; exhausting the core time budget answers SEARCH_BUDGET_EXCEEDED, whose message names the valves (`type`, `fields`).",
    "params": [
      {
        "name": "type",
        "type": "string",
        "required": true,
        "description": "Exactly one entity type"
      },
      {
        "name": "query",
        "type": "string",
        "required": false,
        "description": "Phrase to look for; exactly one of query/regex"
      },
      {
        "name": "regex",
        "type": "string",
        "required": false,
        "description": "JavaScript pattern body, matched against the full field value; may cross lines"
      },
      {
        "name": "fields",
        "type": "string[]",
        "required": false,
        "description": "Dotted paths to search, e.g. fields[].description; overrides the type and host scope"
      },
      {
        "name": "mode",
        "type": "enum(count, map, hits)",
        "required": false,
        "description": "Shape of the answer; default \"map\". Pass \"hits\" only when you need the fragments."
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Page size; the core applies a default and a cap"
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "description": "Rows to skip; a stable sort makes it meaningful"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "reference-tools-search-pages": {
    "server": "reference-tools",
    "name": "search_pages",
    "description": "Search the prose of the pages, by phrase (`query`) or by regex (`regex`) — the replacement for grepping the specification, and the one search the entity graph cannot stand in for (a bare HTTP path, a DTO name mentioned in running text). THREE MODES, a ladder of cost: \"count\" returns only the totals; \"map\" (DEFAULT) returns identity rows `{ rootId, path, anchor, heading, headingPath, matchCount }` with no prose; \"hits\" adds `hunks[]` + `omittedChars`. There is no \"pages\" mode — to read a section, take the `anchor` from a map row and call get_sections. A HIT IS A SECTION, a MATCH is a line: several matches in one section collapse into ONE hit carrying `matchCount`. A hit carries an `anchor` IF AND ONLY IF `kind` is \"section\"; a `kind: \"page\"` hit falls outside every section (the frontmatter, text above the first heading, or under a heading without an anchor yet), has no anchor and no line number, and is read with get_page. Branch on `kind`. Results enumerate in `(rootId, path, line_start)` order with a declared tie-break, so paging with `limit`/`offset` returns every hit exactly once. There is no `score` and no line number. THREE COST VALVES, coarse to sharp: `rootId`, then `pathInclude`/`pathExclude` (regexes over the page path, applied BEFORE the file is opened), then `anchors` (scan only these sections). A `regex` that could only match across a line boundary (`\\n`, `[\\s\\S]`, an inline flag group) is refused with INVALID_ARGUMENT rather than answered with zero hits; within-line idioms are fine, `[^\\n]` included. An over-long `regex` is refused with INVALID_ARGUMENT naming the ceiling, and a run that exhausts the core time budget answers SEARCH_BUDGET_EXCEEDED, whose message names the valves (`rootId`, `pathInclude`).",
    "params": [
      {
        "name": "query",
        "type": "string",
        "required": false,
        "description": "Phrase to look for; case-insensitive substring, matches inside words too. A UI-grade instrument — prefer `regex` for precision."
      },
      {
        "name": "regex",
        "type": "string",
        "required": false,
        "description": "Regular expression; the DEFAULT instrument here, not a fallback. Matched per line, case-insensitively."
      },
      {
        "name": "rootId",
        "type": "string",
        "required": false,
        "description": "Valve 1 — restrict to one root; omit to search all of them"
      },
      {
        "name": "mode",
        "type": "enum(count, map, hits)",
        "required": false,
        "description": "Shape of the answer; default \"map\". Pass \"hits\" explicitly when you need the prose."
      },
      {
        "name": "pathInclude",
        "type": "string",
        "required": false,
        "description": "Valve 2 — regex over the page path; non-matching pages are rejected before being opened"
      },
      {
        "name": "pathExclude",
        "type": "string",
        "required": false,
        "description": "Valve 2 — regex over the page path; matching pages are rejected before being opened"
      },
      {
        "name": "anchors",
        "type": "string[]",
        "required": false,
        "description": "Valve 3, sharpest — limit the scan to these sections"
      },
      {
        "name": "context",
        "type": "integer",
        "required": false,
        "description": "Lines of context around each match in \"hits\" mode. Overlapping windows merge into one block; no line is emitted twice."
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  },
  "c4s-reader-search-pages": {
    "server": "c4s-reader",
    "name": "search_pages",
    "description": "Search the prose of the pages, by phrase (`query`) or by regex (`regex`) — the replacement for grepping the specification, and the one search the entity graph cannot stand in for (a bare HTTP path, a DTO name mentioned in running text). THREE MODES, a ladder of cost: \"count\" returns only the totals; \"map\" (DEFAULT) returns identity rows `{ rootId, path, anchor, heading, headingPath, matchCount }` with no prose; \"hits\" adds `hunks[]` + `omittedChars`. There is no \"pages\" mode — to read a section, take the `anchor` from a map row and call get_sections. A HIT IS A SECTION, a MATCH is a line: several matches in one section collapse into ONE hit carrying `matchCount`. A hit carries an `anchor` IF AND ONLY IF `kind` is \"section\"; a `kind: \"page\"` hit falls outside every section (the frontmatter, text above the first heading, or under a heading without an anchor yet), has no anchor and no line number, and is read with get_page. Branch on `kind`. Results enumerate in `(rootId, path, line_start)` order with a declared tie-break, so paging with `limit`/`offset` returns every hit exactly once. There is no `score` and no line number. THREE COST VALVES, coarse to sharp: `rootId`, then `pathInclude`/`pathExclude` (regexes over the page path, applied BEFORE the file is opened), then `anchors` (scan only these sections). A `regex` that could only match across a line boundary (`\\n`, `[\\s\\S]`, an inline flag group) is refused with INVALID_ARGUMENT rather than answered with zero hits; within-line idioms are fine, `[^\\n]` included. An over-long `regex` is refused with INVALID_ARGUMENT naming the ceiling, and a run that exhausts the core time budget answers SEARCH_BUDGET_EXCEEDED, whose message names the valves (`rootId`, `pathInclude`).",
    "params": [
      {
        "name": "query",
        "type": "string",
        "required": false,
        "description": "Phrase to look for; case-insensitive substring, matches inside words too. A UI-grade instrument — prefer `regex` for precision."
      },
      {
        "name": "regex",
        "type": "string",
        "required": false,
        "description": "Regular expression; the DEFAULT instrument here, not a fallback. Matched per line, case-insensitively."
      },
      {
        "name": "rootId",
        "type": "string",
        "required": false,
        "description": "Valve 1 — restrict to one root; omit to search all of them"
      },
      {
        "name": "mode",
        "type": "enum(count, map, hits)",
        "required": false,
        "description": "Shape of the answer; default \"map\". Pass \"hits\" explicitly when you need the prose."
      },
      {
        "name": "pathInclude",
        "type": "string",
        "required": false,
        "description": "Valve 2 — regex over the page path; non-matching pages are rejected before being opened"
      },
      {
        "name": "pathExclude",
        "type": "string",
        "required": false,
        "description": "Valve 2 — regex over the page path; matching pages are rejected before being opened"
      },
      {
        "name": "anchors",
        "type": "string[]",
        "required": false,
        "description": "Valve 3, sharpest — limit the scan to these sections"
      },
      {
        "name": "context",
        "type": "integer",
        "required": false,
        "description": "Lines of context around each match in \"hits\" mode. Overlapping windows merge into one block; no line is emitted twice."
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "description": "Page size; the core applies a default and a cap"
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "description": "Rows to skip; a stable sort makes it meaningful"
      }
    ],
    "hints": {
      "readOnlyHint": null,
      "destructiveHint": null,
      "idempotentHint": null,
      "openWorldHint": null
    }
  }
};

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

/** The record's type notation for one JSON Schema node: `string`, `integer`, `enum(a, b)`, `string[]`, `string | number`. */
function typeOf(s: JsonSchema): string {
  if (s.enum) return `enum(${s.enum.join(', ')})`;
  if (s.anyOf) return s.anyOf.map(typeOf).join(' | ');
  if (s.type === 'array') return `${typeOf(s.items ?? {})}[]`;
  return s.type ?? '?';
}

/** A registered tool as the host holds it: the raw zod shape (or object) it was declared with. */
export interface DeclaredTool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: object;
}

/** The declared parameters in the record's notation, from the input side of the schema. */
export function declaredParams(tool: DeclaredTool): ReadToolRecord['params'] {
  const schema = tool.inputSchema instanceof z.ZodType ? tool.inputSchema : z.object(tool.inputSchema as z.ZodRawShape);
  const json = z.toJSONSchema(schema, { io: 'input' }) as JsonSchema;
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    type: typeOf(s),
    required: required.has(name),
    ...(s.description !== undefined ? { description: s.description } : {}),
  }));
}

/**
 * The registered tool matches its record: name, description verbatim, the
 * parameter set with each one's type, requiredness and description, and no
 * declared hint (every hint of these records is empty).
 */
export function expectToolMatchesRecord(tool: DeclaredTool | undefined, slug: string): void {
  const record = READ_TOOL_RECORDS[slug];
  expect(record, `record ${slug}`).toBeDefined();
  expect(tool, `tool ${record!.server} · ${record!.name}`).toBeDefined();
  expect(tool!.name).toBe(record!.name);
  expect(tool!.description).toBe(record!.description);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  expect([...declaredParams(tool!)].sort(byName)).toEqual([...record!.params].sort(byName));
  for (const hint of Object.values(record!.hints)) expect(hint).toBeNull();
  expect(tool!.annotations ?? {}).toEqual({});
}
