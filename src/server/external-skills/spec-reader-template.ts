import type { ExternalSkillContext } from './types.js';

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

## Discovery

- \`c4s catalog ${identity}\` — active entity types with counts + version + description + roleNoun + mcpToolsLine per type (smoke test).
- \`c4s describe --type <t> [--view <v>] ${identity}\` — JSON Schema per view for one type (on-demand).
- \`c4s list-tags ${identity}\` — all tags with per-type counts.
- \`c4s list-slugs --type endpoint ${identity}\` — all slugs for a given type.

All output is JSON (pretty) by default. Use \`--compact\` for pipelines and
\`--format text\` for terminal-friendly output. Errors go to stderr as JSON with
an exit code > 0.

The database is opened **read-only** — \`c4s\` never mutates the project.

## Asking the spec agent

When a question goes beyond resolving entities or pages, \`c4s ask\` runs a
synchronous agent turn against the specification:

\`\`\`sh
c4s ask "<question>" --ct chat ${identity}
\`\`\`

Unlike the read-only commands above, \`c4s ask\` requires a running
\`npx @inharness-ai/claude4spec\` server (it delegates the turn to the server's agent).

## Errors

### \`PROJECT_SLUG_NOT_FOUND\` — this skill's identity no longer resolves

If any \`c4s\` command above returns \`PROJECT_SLUG_NOT_FOUND\`, the \`--project
'${ctx.slug}'\` baked into this skill no longer matches a project in this
machine's \`~/.claude4spec/workspaces.json\` (the spec project was moved, deleted,
or this skill was copied from a different machine). Regenerate the skill from
the spec repo (\`npx @inharness-ai/claude4spec\`) and re-copy it here.

### \`AMBIGUOUS_WORKSPACE\` / \`AMBIGUOUS_PROJECT\`

The project (or its registered name) matches more than one entry in the
registry — pass the correct \`--workspace <name>\` to disambiguate.

### \`SERVER_NOT_RECOGNIZED\` / \`PROJECT_BUILD_FAILED\` — the project failed to build

If \`c4s ask\` reports the server is "not a claude4spec server", or
\`GET /api/projects/<id>/config\` returns \`PROJECT_BUILD_FAILED\`, the server IS
running but **that project failed to build**. A common cause is the configured
\`writingStyle\` skill failing to load: a skill under \`.claude/skills/\` whose
frontmatter \`version\` exceeds the supported version is skipped at scan time, so
the style is "not a selectable writing-style skill".

\`c4s ask\` surfaces the real \`PROJECT_BUILD_FAILED\` message, which names the cause
(e.g. \`writingStyle "X" was found on disk but skipped: version 2 > supported 1\`).
Fix the skill's frontmatter (\`version\` is a format-compat gate — keep it \`1\`, don't
use it as a content counter) and restart the server.
`;
}
