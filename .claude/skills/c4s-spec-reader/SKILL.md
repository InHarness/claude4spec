---
name: c4s-spec-reader
description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Use when working in a repository whose pages/ contain these tags or whose .claude4spec/ directory exists. Resolves entity slugs to full data via the c4s CLI.
---

# c4s-spec-reader

This skill is bound to one claude4spec specification project — every `c4s`
command below carries its identity (`--server 'http://localhost:4508' --project 'app-spec'`), so it works from any cwd,
including a foreign code repo whose pages reference this spec's entities. Do
NOT `cd` into the spec repo; the identity is baked in, not derived from cwd.

**CLI-only — no filesystem fallback.** Every command below goes through
`c4s`. If `c4s` isn't installed, STOP and ask the user to install it —
never read the spec repo's pages or entity files directly.

## Server required — for every step

Every `c4s` command in this skill talks to a running `npx @inharness-ai/claude4spec` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.

`SERVER_NOT_RUNNING` **(exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.

Three neighbouring codes mean something else, and starting a server will not fix any of them: `SERVER_NOT_RECOGNIZED` (something is listening, but it is not claude4spec), `PROJECT_NOT_IN_WORKSPACE` (the server is fine, but it does not serve this skill's project — see "Stale address" below) and `WORKSPACE_NOT_REGISTERED` (the project lies in a workspace home directory this machine has never registered). Report those as they are.

## Stale address — `PROJECT_NOT_IN_WORKSPACE`

`PROJECT_NOT_IN_WORKSPACE` means the server at `http://localhost:4508` does not serve the project `app-spec` — the address baked into this skill is stale. **Stop and ask the user to regenerate this skill** (Settings → External Integrations, or `c4s install-skills`). Do not guess another `--project` or `--server` value.

## Resolving a tag

Install `claude4spec` (Node 20+) and use the `c4s` CLI. Subcommand names match
XML tag names 1:1 — append `--server 'http://localhost:4508' --project 'app-spec'` to every command below.

| XML tag | CLI equivalent |
|---------|----------------|
| `<inline_mention type="endpoint" slug="X"/>` | `c4s inline_mention --type endpoint --slug X --server 'http://localhost:4508' --project 'app-spec'` |
| `<single_element type="dto" slug="X"/>` | `c4s single_element --type dto --slug X --server 'http://localhost:4508' --project 'app-spec'` |
| `<element_list type="endpoint" slugs="a,b,c"/>` | `c4s element_list --type endpoint --slugs a,b,c --server 'http://localhost:4508' --project 'app-spec'` |
| `<tagged_list type="dto" tags="auth" filter="and"/>` | `c4s tagged_list --type dto --tags auth --filter and --server 'http://localhost:4508' --project 'app-spec'` |
| `<tagged_list_mixed tags="public"/>` | `c4s tagged_list_mixed --tags public --server 'http://localhost:4508' --project 'app-spec'` |

## Expanding a whole page

```sh
c4s resolve some-page.md --server 'http://localhost:4508' --project 'app-spec'                # writes markdown with tags expanded inline
c4s resolve some-page.md --format json --server 'http://localhost:4508' --project 'app-spec'   # writes { format, text, resolved: [...] } — the original text plus what each tag resolved to
```

This is a RENDER convenience, and the only surface that still offers it. It takes a path to a markdown file **you already have** — a page in the repo you are working in, for instance. It is not how you read the specification's own pages, and there is no MCP equivalent: expanding a tag pastes the entity's payload over the reference, and the reference is the more useful half. To read a spec page, ask for it with `get-page` (tags stay unexpanded) and follow the embeds you care about by slug (`c4s single_element --type <t> --slug <s>`).

## Navigating pages and sections

A whole page is often more than you need. Pages are addressed by the full key
`(rootId, path)` — the same relative path can exist in several roots, so
`--root-id` is required and there is no silent fallback. Sections are addressed
by `anchor` alone (globally unique), so section commands take no root.

The normal path from "I have a phrase" to "I have the text" is TWO commands,
not three — a search hit already carries the anchor, so there is nothing to look
up in between:

```sh
c4s search-pages --query "<phrase>" --server 'http://localhost:4508' --project 'app-spec'   # hits carry an anchor
c4s get-sections --anchors a,b,c --server 'http://localhost:4508' --project 'app-spec'      # bodies of several sections in ONE call
```

Fetch sections in **batches** — `get-sections` takes a comma-separated list and
returns `{ results: [...] }` in input order. An unknown anchor comes back as an
error **inside its own item**, so one bad anchor does not lose the other
sections. Asking anchor-by-anchor costs one command per section for no benefit.

To see what a page contains before pulling any of it, ask for its outline. It
comes back as a tree in document order — a table of contents — and every node
carries the section's anchor, its heading, its level and the size of its own
body, so you can pick exactly the anchors worth fetching:

```sh
c4s get-page-outline --root-id pages --path some/page.md --server 'http://localhost:4508' --project 'app-spec'
c4s list-pages --root-id pages [--prefix modules/] --server 'http://localhost:4508' --project 'app-spec'
```

Whole page, when you really want all of it:

```sh
c4s get-page --root-id pages --path some/page.md --server 'http://localhost:4508' --project 'app-spec'
```

The page comes back as **structure**, not as one text: `{ rootId, path, hash, frontmatter?, preamble?, results[] }`. Each item of `results` is one section — `anchor`, `heading_text`, `heading_level`, `body` — in document order. The anchor is a field, so you pass it straight to `get-sections`; `body` holds neither the anchor line nor the heading line. `frontmatter.raw` is the frontmatter verbatim and `frontmatter.fields` its parsed keys (absent when the YAML does not parse); `preamble` is the text above the first heading. `hash` is what a write expects. Add `--format text` to get the page assembled back into markdown for reading.

XML tags in `body` are left untouched — the tag is the edge to another entity, so expanding it would replace a link with a payload. Resolve the tags you care about with the commands above. On a page over the response budget, some items come back with `truncated: true` and no `body`, and `message` names their anchors — fetch those with `get-sections`. There is no line window on `get-page`: to continue a cut read, go through `get-page-outline` and `get-sections`.

## Discovery

- `c4s catalog --server 'http://localhost:4508' --project 'app-spec'` — the ENTRY POINT: page roots (`id`, `name`, `dir`, `builtin`, `pageCount`), active entity types with counts + version + description + roleNoun + mcpToolsLine per type, tag count. Start here; it is cheap and it tells you what else is worth asking.
- `c4s describe --type <t> --server 'http://localhost:4508' --project 'app-spec'` — what a type IS: JSON Schemas, the value `constraints` a write must satisfy, `selectableFields` (the names `--select` accepts), `contentFields` (fields no generic read carries, each with the operation that issues them) and `searchableFields`. Worth calling before a READ, not just before a write.
- `c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>] --server 'http://localhost:4508' --project 'app-spec'` — the project tags. Counts are OFF by default (they are a product of tags by types); `--co-occurring-with` returns the tags sharing entities with one you name, which is how you discover a taxonomy without already knowing it.
- `c4s list-entities --type endpoint [--tags auth] [--tag-filter and|or] [--sort createdAt|title|slug] [--dir asc|desc] [--mode items|count] --server 'http://localhost:4508' --project 'app-spec'` — full paginated traversal of one type. Rows are `{ slug, title }`: discovery answers with keys, and you follow up with `get-entities` for content. `--mode count` answers "how many" without listing. Only the default `createdAt` order has a write-stable offset window.
- `c4s get-entities --type dto --slugs a,b,c [--select <f1,f2>] --server 'http://localhost:4508' --project 'app-spec'` — several entities in one call. `--select` names top-level fields (`slug`, `title` and `tags` always come back); omit it for every field except content-bearing ones, or pass `--select=` for the identity skeleton alone.
- `c4s get-field-content --type diagram --slug <s> --field source --server 'http://localhost:4508' --project 'app-spec'` — the content of ONE content-bearing field. Such a field is carried by no generic read (you get `has<Field>` / `<field>Bytes` instead), so this is the only way to read one.
- `c4s search-entities --type ac --query "<phrase>" [--fields <f1,f2>] --server 'http://localhost:4508' --project 'app-spec'` — text search inside one type (the type is required); the output always declares `searchedFields`, so an empty result is distinguishable from an unsearched field.
- `c4s resolve-identity --query "<fragment>" [--types endpoint,dto] --server 'http://localhost:4508' --project 'app-spec'` — the only cross-type command: "what is this called?" from a fragment of a name.
- `c4s check-consistency [--severity <s>] [--rule <r>] --server 'http://localhost:4508' --project 'app-spec'` — the spec's own diagnostics (broken references, drift between disk and index).

Every list command accepts `--limit` / `--offset` and reports `total` +
`hasMore` — measure before you fetch.

Every command above is one of the fifteen read-only **discovery operations**
under a CLI name. The operation owns the behaviour — pagination, response
budget, sort order, and what an error suggests you do next; the command is a
transport over it. The mapping, when you need to read the operation's contract:

| CLI command | Operation |
|-------------|-----------|
| `c4s catalog` | `overview` |
| `c4s describe` | `describe_types` |
| `c4s list-tags` | `list_tags` |
| `c4s inline_mention` / `single_element` / `element_list` / `detail` | `get_entities` (one projection each) |
| `c4s get-field-content` | `get_field_content` |
| `c4s tagged_list` / `tagged_list_mixed` | `list_entities` (tag-filtered) |
| `c4s get-entities` / `c4s list-entities` | `get_entities` / `list_entities` (the canonical surface the aliases above sit on) |
| `c4s list-pages` / `c4s get-page` | `list_pages` / `get_page` |
| `c4s get-page-outline` / `c4s get-sections` | `get_page_outline` / `get_sections` |
| `c4s search-pages` / `c4s search-entities` | `search_pages` / `search_entities` |
| `c4s check-consistency` / `c4s resolve-identity` | `check_consistency` / `resolve_identity` |
| `c4s find-references` | `find_references` |

All output is JSON (pretty) by default. Use `--compact` for pipelines and
`--format text` for terminal-friendly output. Errors go to stderr as JSON with
an exit code > 0, and an error is navigable rather than merely a refusal: a
`*_NOT_FOUND` names the alternatives it knows about, and an
`INVALID_ARGUMENT` names the call that would have worked. Read the `hint`
before guessing again.

None of these commands mutates the project: they render read operations of the specification, and `c4s` opens no database of its own.

## Asking the spec agent

When a question goes beyond resolving entities or pages, `c4s ask` runs a
synchronous agent turn against the specification:

```sh
c4s ask "<question>" --server 'http://localhost:4508' --project 'app-spec'
```

It needs the same running server every other command here needs — see "Server
required" above. What is different about it is the cost, not the requirement:
it runs a full agent turn rather than answering from the index, so it can also
come back `AGENT_UNAVAILABLE` or `TIMEOUT`.

## Errors

If `c4s` reports `PROJECT_NOT_IN_WORKSPACE` or `PROJECT_ID_NOT_FOUND`, this
skill's baked-in address (`--server 'http://localhost:4508' --project 'app-spec'`) is stale — stop and ask the user to
regenerate the skill (see "Stale address" above). If `c4s ask` reports the server isn't recognized
as a claude4spec server, or that the project failed to build
(`PROJECT_BUILD_FAILED`), that's a problem on the spec repo/server side —
report it to the user; don't try to fix the spec repo from here.

If `c4s` reports `WORKSPACE_NOT_REGISTERED`, the project lives in a workspace
home directory that is not registered on this machine. Do not start the server
yourself: tell the user to start it once with `--cwd <home>` (the directory
holding `.claude4spec/workspace.json`), then retry.
