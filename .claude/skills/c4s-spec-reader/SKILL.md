---
name: c4s-spec-reader
description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Use when working in a repository whose pages/ contain these tags or whose .claude4spec/ directory exists. Resolves entity slugs to full data via the c4s CLI.
---

# c4s-spec-reader

This skill is bound to one claude4spec specification project — every `c4s`
command below carries its identity (`--project 'app-spec' --workspace 'default'`), so it works from any cwd,
including a foreign code repo whose pages reference this spec's entities. Do
NOT `cd` into the spec repo; the identity is baked in, not derived from cwd.

**CLI-only — no filesystem fallback.** Every command below goes through
`c4s`. If `c4s` isn't installed, STOP and ask the user to install it —
never read the spec repo's pages or entity files directly.

## Resolving a tag

Install `claude4spec` (Node 20+) and use the `c4s` CLI. Subcommand names match
XML tag names 1:1 — append `--project 'app-spec' --workspace 'default'` to every command below.

| XML tag | CLI equivalent |
|---------|----------------|
| `<inline_mention type="endpoint" slug="X"/>` | `c4s inline_mention --type endpoint --slug X --project 'app-spec' --workspace 'default'` |
| `<single_element type="dto" slug="X"/>` | `c4s single_element --type dto --slug X --project 'app-spec' --workspace 'default'` |
| `<element_list type="endpoint" slugs="a,b,c"/>` | `c4s element_list --type endpoint --slugs a,b,c --project 'app-spec' --workspace 'default'` |
| `<tagged_list type="dto" tags="auth" filter="and"/>` | `c4s tagged_list --type dto --tags auth --filter and --project 'app-spec' --workspace 'default'` |
| `<tagged_list_mixed tags="public"/>` | `c4s tagged_list_mixed --tags public --project 'app-spec' --workspace 'default'` |

## Expanding a whole page

```sh
c4s resolve some-page.md --project 'app-spec' --workspace 'default'                # writes markdown with tags expanded inline
c4s resolve some-page.md --format json --project 'app-spec' --workspace 'default'   # writes { content, resolved: [...] }
```

This is a RENDER convenience, and the only surface that still offers it. It
takes a path to a markdown file **you already have** — a page in the repo you
are working in, for instance. It is not how you read the specification's own
pages, and there is no MCP equivalent: expanding a tag pastes the entity's
payload over the reference, and the reference is the more useful half. To read a
spec page, ask for it as authored and follow the embeds you care about by slug
(`c4s single_element --type <t> --slug <s>`).

## Navigating pages and sections

A whole page is often more than you need. Pages are addressed by the full key
`(rootId, path)` — the same relative path can exist in several roots, so
`--root-id` is required and there is no silent fallback. Sections are addressed
by `anchor` alone (globally unique), so section commands take no root.

The normal path from "I have a phrase" to "I have the text":

```sh
c4s search-pages --query "<phrase>" --project 'app-spec' --workspace 'default'          # hits carry an anchor (indexed root)
c4s list-sections --by anchor --anchor <a> --project 'app-spec' --workspace 'default'   # subtree below that section, with per-section size
c4s get-sections --anchors a,b,c --project 'app-spec' --workspace 'default'             # bodies of several sections in ONE call
```

Fetch sections in **batches** — `get-sections` takes a comma-separated list and
returns `{ results: [...] }` in input order. An unknown anchor comes back as an
error **inside its own item**, so one bad anchor does not lose the other
sections. Asking anchor-by-anchor costs one command per section for no benefit.

To list what a page contains before pulling it, use `--by page`:

```sh
c4s list-sections --by page --root-id pages --path some/page.md --project 'app-spec' --workspace 'default'
c4s list-pages --root-id pages [--prefix modules/] --project 'app-spec' --workspace 'default'
```

Whole page, when you really want the file:

```sh
c4s get-page --root-id pages --path some/page.md --project 'app-spec' --workspace 'default'
```

The page comes back **as authored**, with XML tags left untouched — the tag is
the edge to another entity, so expanding it would replace a link with a payload.
Resolve the tags you care about with the commands above. `--range <from:to>` is
only accepted on a non-section-indexed root; on an indexed one the command
refuses and tells you to use `list-sections` + `get-sections` instead.

## Discovery

- `c4s catalog --project 'app-spec' --workspace 'default'` — the ENTRY POINT: page roots with their properties, active entity types with counts + version + description + roleNoun + mcpToolsLine per type, tag count. Start here; it is cheap and it tells you what else is worth asking.
- `c4s describe --type <t> [--view <v>] --project 'app-spec' --workspace 'default'` — JSON Schema per view for one type, plus the paths a search would cover (on-demand).
- `c4s list-tags [--with-counts] [--min-count <n>] [--co-occurring-with <slug>] --project 'app-spec' --workspace 'default'` — the project tags. Counts are OFF by default (they are a product of tags by types); `--co-occurring-with` returns the tags sharing entities with one you name, which is how you discover a taxonomy without already knowing it.
- `c4s list-slugs --type endpoint --project 'app-spec' --workspace 'default'` — all slugs for a given type.
- `c4s list-entities --type endpoint [--tags auth] [--view <v>] [--mode items|count] --project 'app-spec' --workspace 'default'` — full paginated traversal of one type; `--mode count` answers "how many" without listing.
- `c4s get-entities --type dto --slugs a,b,c --view detail --project 'app-spec' --workspace 'default'` — several entities in one call, any view.
- `c4s search-entities --type ac --query "<phrase>" [--fields <f1,f2>] --project 'app-spec' --workspace 'default'` — text search inside one type (the type is required); the output always declares `searchedFields`, so an empty result is distinguishable from an unsearched field.
- `c4s resolve-identity --query "<fragment>" [--types endpoint,dto] --project 'app-spec' --workspace 'default'` — the only cross-type command: "what is this called?" from a fragment of a name.
- `c4s check-consistency [--severity <s>] [--rule <r>] --project 'app-spec' --workspace 'default'` — the spec's own diagnostics (broken references, drift between disk and index).

Every list command accepts `--limit` / `--offset` and reports `total` +
`hasMore` — measure before you fetch.

Every command above is one of the fourteen read-only **discovery operations**
under a CLI name. The operation owns the behaviour — pagination, response
budget, sort order, and what an error suggests you do next; the command is a
transport over it. The mapping, when you need to read the operation's contract:

| CLI command | Operation |
|---|---|
| `c4s catalog` | `overview` |
| `c4s describe` | `describe_types` |
| `c4s list-tags` | `list_tags` |
| `c4s list-slugs` | `list_entities` (minimal view) |
| `c4s inline_mention` / `single_element` / `element_list` / `detail` | `get_entities` (one view each) |
| `c4s tagged_list` / `tagged_list_mixed` | `list_entities` (tag-filtered) |
| `c4s get-entities` / `c4s list-entities` | `get_entities` / `list_entities` (the canonical surface the aliases above sit on) |
| `c4s list-pages` / `c4s get-page` | `list_pages` / `get_page` |
| `c4s list-sections` / `c4s get-sections` | `list_sections` / `get_sections` |
| `c4s search-pages` / `c4s search-entities` | `search_pages` / `search_entities` |
| `c4s check-consistency` / `c4s resolve-identity` | `check_consistency` / `resolve_identity` |
| `c4s find-references` | `find_references` |

All output is JSON (pretty) by default. Use `--compact` for pipelines and
`--format text` for terminal-friendly output. Errors go to stderr as JSON with
an exit code > 0, and an error is navigable rather than merely a refusal: a
`*_NOT_FOUND` names the alternatives it knows about, and an
`INVALID_ARGUMENT` names the call that would have worked. Read the `hint`
before guessing again.

The database is opened **read-only** — `c4s` never mutates the project.

## Asking the spec agent

When a question goes beyond resolving entities or pages, `c4s ask` runs a
synchronous agent turn against the specification:

```sh
c4s ask "<question>" --project 'app-spec' --workspace 'default'
```

Unlike the read-only commands above, `c4s ask` requires a running
`npx @inharness-ai/claude4spec` server (it delegates the turn to the server's agent).

## Errors

If `c4s` reports `PROJECT_SLUG_NOT_FOUND` or `AMBIGUOUS_WORKSPACE` /
`AMBIGUOUS_PROJECT`, this skill's baked-in `--project 'app-spec' --workspace 'default'` identity no longer
resolves — regenerate the skill from the spec repo and re-copy it, or pass the
correct `--workspace <name>`. If `c4s ask` reports the server isn't recognized
as a claude4spec server, or that the project failed to build
(`PROJECT_BUILD_FAILED`), that's a problem on the spec repo/server side —
report it to the user; don't try to fix the spec repo from here.
