export const SPEC_READER_FRONTMATTER = `---
name: c4s-spec-reader
description: Read claude4spec specification entities (endpoints, DTOs, tables, AC, UI views) referenced from markdown pages through XML tags like <inline_mention/>, <single_element/>, <tagged_list/>. Use when working in a repository whose pages/ contain these tags or whose .claude4spec/ directory exists. Resolves entity slugs to full data via c4s CLI or c4s-reader MCP server.
---
`;

export const SPEC_READER_BODY = `# c4s-spec-reader

This repository contains a claude4spec specification. Pages (\`*.md\`) reference
entities stored in \`.claude4spec/db.sqlite\` through XML tags. This skill teaches
you how to resolve them.

All commands below walk up from the agent's cwd to the nearest \`.claude4spec/\` —
no absolute paths are required.

## Resolving a tag

Install \`claude4spec\` (Node 20+) and use the \`c4s\` CLI. Subcommand names match
XML tag names 1:1.

| XML tag | CLI equivalent |
|---------|----------------|
| \`<inline_mention type="endpoint" slug="X"/>\` | \`c4s inline_mention --type endpoint --slug X\` |
| \`<single_element type="dto" slug="X"/>\` | \`c4s single_element --type dto --slug X\` |
| \`<element_list type="endpoint" slugs="a,b,c"/>\` | \`c4s element_list --type endpoint --slugs a,b,c\` |
| \`<tagged_list type="dto" tags="auth" filter="and"/>\` | \`c4s tagged_list --type dto --tags auth --filter and\` |
| \`<tagged_list_mixed tags="public"/>\` | \`c4s tagged_list_mixed --tags public\` |

## Expanding a whole page

\`\`\`sh
c4s resolve some-page.md              # writes markdown with tags expanded inline
c4s resolve some-page.md --format json   # writes { content, resolved: [...] }
\`\`\`

## Discovery

- \`c4s catalog\` — active entity types with counts + version + description + roleNoun + mcpToolsLine per type (smoke test).
- \`c4s describe --type <t> [--view <v>]\` — JSON Schema per view for one type (on-demand).
- \`c4s list-tags\` — all tags with per-type counts.
- \`c4s list-slugs --type endpoint\` — all slugs for a given type.

All output is JSON (pretty) by default. Use \`--compact\` for pipelines and
\`--format text\` for terminal-friendly output. Errors go to stderr as JSON with
an exit code > 0.

The database is opened **read-only** — \`c4s\` never mutates the project.

## Asking the spec agent

When a question goes beyond resolving entities or pages, \`c4s ask\` runs a
synchronous agent turn against the specification:

\`\`\`sh
c4s ask "<question>" --ct chat
\`\`\`

Unlike the read-only commands above, \`c4s ask\` requires a running
\`npx @inharness-ai/claude4spec\` server (it delegates the turn to the server's agent).

### \`PROJECT_NOT_FOUND\` when the project dir is a symlink

If \`c4s ask\` (or any \`c4s\` command) returns \`PROJECT_NOT_FOUND\` even though a
server is running, your cwd is most likely reached through a **symlink** (common
for \`.claude/skills/<name>\` that points elsewhere). \`c4s\` resolves \`process.cwd()\`
through the symlink to the real path, which is NOT the path registered in
\`~/.claude4spec/workspaces.json\`. Pass the registered (symlink) path explicitly —
\`--project\` is run through \`path.resolve\`, which does NOT canonicalize symlinks, so
it matches the registry exactly:

\`\`\`sh
c4s ask "<question>" --ct chat --project /abs/path/to/registered/project-dir
\`\`\`
`;
