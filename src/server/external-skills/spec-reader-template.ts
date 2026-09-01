import type { ExternalSkillContext } from './types.js';
import { SERVER_REQUIRED_BLOCK } from './server-required.js';

export const SPEC_READER_FRONTMATTER = `---
name: c4s-spec-reader
description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Use when working in a repository whose pages/ contain these tags or whose .claude4spec/ directory exists. Resolves entity slugs to full data via the c4s CLI.
---
`;

export function specReaderBody(ctx: ExternalSkillContext): string {
  // Quoted: ProjectRecord.name (the slug) is an unvalidated directory basename
  // and can contain spaces/shell metacharacters — unquoted interpolation here
  // would break argv parsing when these example commands are run verbatim.
  const identity = `--project '${ctx.slug}' --workspace '${ctx.workspace}'`;
  return `# c4s-spec-reader

This skill is bound to one claude4spec specification project — every \`c4s\`
command below carries its identity (\`${identity}\`), so it works from any cwd,
including a foreign code repo whose pages reference this spec's entities. Do
NOT \`cd\` into the spec repo; the identity is baked in, not derived from cwd.

**CLI-only — no filesystem fallback.** Every command below goes through
\`c4s\`. If \`c4s\` isn't installed, STOP and ask the user to install it —
never read the spec repo's pages or entity files directly.

${SERVER_REQUIRED_BLOCK}

## Resolving a tag

Install \`claude4spec\` (Node 20+) and use the \`c4s\` CLI. Subcommand names match
XML tag names 1:1 — append \`${identity}\` to every command below.

| XML tag | CLI equivalent |
|---------|----------------|
| \`<inline_mention type="endpoint" slug="X"/>\` | \`c4s inline_mention --type endpoint --slug X ${identity}\` |
| \`<single_element type="dto" slug="X"/>\` | \`c4s single_element --type dto --slug X ${identity}\` |
| \`<element_list type="endpoint" slugs="a,b,c"/>\` | \`c4s element_list --type endpoint --slugs a,b,c ${identity}\` |
| \`<tagged_list type="dto" tags="auth" filter="and"/>\` | \`c4s tagged_list --type dto --tags auth --filter and ${identity}\` |
| \`<tagged_list_mixed tags="public"/>\` | \`c4s tagged_list_mixed --tags public ${identity}\` |

## Expanding a whole page

\`\`\`sh
c4s resolve some-page.md ${identity}                # writes markdown with tags expanded inline
c4s resolve some-page.md --format json ${identity}   # writes { content, resolved: [...] }
\`\`\`

This is a RENDER convenience, and the only surface that still offers it. It
takes a path to a markdown file **you already have** — a page in the repo you
are working in, for instance. It is not how you read the specification's own
pages, and there is no MCP equivalent: expanding a tag pastes the entity's
payload over the reference, and the reference is the more useful half. To read a
spec page, ask for it as authored and follow the embeds you care about by slug
(\`c4s single_element --type <t> --slug <s>\`).

## Navigating pages and sections

A whole page is often more than you need. Pages are addressed by the full key
\`(rootId, path)\` — the same relative path can exist in several roots, so
\`--root-id\` is required and there is no silent fallback. Sections are addressed
by \`anchor\` alone (globally unique), so section commands take no root.

The normal path from "I have a phrase" to "I have the text" is TWO commands,
not three — a search hit already carries the anchor, so there is nothing to look
up in between:

\`\`\`sh
c4s search-pages --query "<phrase>" ${identity}   # hits carry an anchor (indexed root)
c4s get-sections --anchors a,b,c ${identity}      # bodies of several sections in ONE call
\`\`\`

Fetch sections in **batches** — \`get-sections\` takes a comma-separated list and
returns \`{ results: [...] }\` in input order. An unknown anchor comes back as an
error **inside its own item**, so one bad anchor does not lose the other
sections. Asking anchor-by-anchor costs one command per section for no benefit.

To see what a page contains before pulling any of it, ask for its outline. It
comes back as a tree in document order — a table of contents — and every node
carries the section's anchor, its heading, its level and the size of its own
body, so you can pick exactly the anchors worth fetching:

\`\`\`sh
c4s get-page-outline --root-id pages --path some/page.md ${identity}
c4s list-pages --root-id pages [--prefix modules/] ${identity}
\`\`\`

Whole page, when you really want the file:

\`\`\`sh
c4s get-page --root-id pages --path some/page.md ${identity}
\`\`\`

The page comes back **as authored**, with XML tags left untouched — the tag is
the edge to another entity, so expanding it would replace a link with a payload.
Resolve the tags you care about with the commands above. \`--range <from:to>\` is
only accepted on a non-section-indexed root; on an indexed one the command
refuses and tells you to use \`get-page-outline\` + \`get-sections\` instead.

## Discovery

- \`c4s catalog ${identity}\` — the ENTRY POINT: page roots with their properties, active entity types with counts + version + description + roleNoun + mcpToolsLine per type, tag count. Start here; it is cheap and it tells you what else is worth asking.
- \`c4s describe --type <t> ${identity}\` — what a type IS: JSON Schemas, the value \`constraints\` a write must satisfy, \`selectableFields\` (the names \`--select\` accepts), \`contentFields\` (fields no generic read carries, each with the operation that issues them) and \`searchableFields\`. Worth calling before a READ, not just before a write.
- \`c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>] ${identity}\` — the project tags. Counts are OFF by default (they are a product of tags by types); \`--co-occurring-with\` returns the tags sharing entities with one you name, which is how you discover a taxonomy without already knowing it.
- \`c4s list-entities --type endpoint [--tags auth] [--tag-filter and|or] [--sort createdAt|title|slug] [--dir asc|desc] [--mode items|count] ${identity}\` — full paginated traversal of one type. Rows are \`{ slug, title }\`: discovery answers with keys, and you follow up with \`get-entities\` for content. \`--mode count\` answers "how many" without listing. Only the default \`createdAt\` order has a write-stable offset window.
- \`c4s get-entities --type dto --slugs a,b,c [--select <f1,f2>] ${identity}\` — several entities in one call. \`--select\` names top-level fields (\`slug\`, \`title\` and \`tags\` always come back); omit it for every field except content-bearing ones, or pass \`--select=\` for the identity skeleton alone.
- \`c4s get-field-content --type diagram --slug <s> --field source ${identity}\` — the content of ONE content-bearing field. Such a field is carried by no generic read (you get \`has<Field>\` / \`<field>Bytes\` instead), so this is the only way to read one.
- \`c4s search-entities --type ac --query "<phrase>" [--fields <f1,f2>] ${identity}\` — text search inside one type (the type is required); the output always declares \`searchedFields\`, so an empty result is distinguishable from an unsearched field.
- \`c4s resolve-identity --query "<fragment>" [--types endpoint,dto] ${identity}\` — the only cross-type command: "what is this called?" from a fragment of a name.
- \`c4s check-consistency [--severity <s>] [--rule <r>] ${identity}\` — the spec's own diagnostics (broken references, drift between disk and index).

Every list command accepts \`--limit\` / \`--offset\` and reports \`total\` +
\`hasMore\` — measure before you fetch.

Every command above is one of the fifteen read-only **discovery operations**
under a CLI name. The operation owns the behaviour — pagination, response
budget, sort order, and what an error suggests you do next; the command is a
transport over it. The mapping, when you need to read the operation's contract:

| CLI command | Operation |
|---|---|
| \`c4s catalog\` | \`overview\` |
| \`c4s describe\` | \`describe_types\` |
| \`c4s list-tags\` | \`list_tags\` |
| \`c4s inline_mention\` / \`single_element\` / \`element_list\` / \`detail\` | \`get_entities\` (one projection each) |
| \`c4s get-field-content\` | \`get_field_content\` |
| \`c4s tagged_list\` / \`tagged_list_mixed\` | \`list_entities\` (tag-filtered) |
| \`c4s get-entities\` / \`c4s list-entities\` | \`get_entities\` / \`list_entities\` (the canonical surface the aliases above sit on) |
| \`c4s list-pages\` / \`c4s get-page\` | \`list_pages\` / \`get_page\` |
| \`c4s get-page-outline\` / \`c4s get-sections\` | \`get_page_outline\` / \`get_sections\` |
| \`c4s search-pages\` / \`c4s search-entities\` | \`search_pages\` / \`search_entities\` |
| \`c4s check-consistency\` / \`c4s resolve-identity\` | \`check_consistency\` / \`resolve_identity\` |
| \`c4s find-references\` | \`find_references\` |

All output is JSON (pretty) by default. Use \`--compact\` for pipelines and
\`--format text\` for terminal-friendly output. Errors go to stderr as JSON with
an exit code > 0, and an error is navigable rather than merely a refusal: a
\`*_NOT_FOUND\` names the alternatives it knows about, and an
\`INVALID_ARGUMENT\` names the call that would have worked. Read the \`hint\`
before guessing again.

None of these commands mutates the project: they render read operations of the specification, and \`c4s\` opens no database of its own.

## Asking the spec agent

When a question goes beyond resolving entities or pages, \`c4s ask\` runs a
synchronous agent turn against the specification:

\`\`\`sh
c4s ask "<question>" ${identity}
\`\`\`

It needs the same running server every other command here needs — see "Server
required" above. What is different about it is the cost, not the requirement:
it runs a full agent turn rather than answering from the index, so it can also
come back \`AGENT_UNAVAILABLE\` or \`TIMEOUT\`.

## Errors

If \`c4s\` reports \`PROJECT_SLUG_NOT_FOUND\` or \`AMBIGUOUS_WORKSPACE\` /
\`AMBIGUOUS_PROJECT\`, this skill's baked-in \`${identity}\` identity no longer
resolves — regenerate the skill from the spec repo and re-copy it, or pass the
correct \`--workspace <name>\`. If \`c4s ask\` reports the server isn't recognized
as a claude4spec server, or that the project failed to build
(\`PROJECT_BUILD_FAILED\`), that's a problem on the spec repo/server side —
report it to the user; don't try to fix the spec repo from here.
`;
}
