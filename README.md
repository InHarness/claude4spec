# claude4spec

Local-first spec editor — markdown + SQLite + AI agent.

`claude4spec` is a developer tool for writing and maintaining **system specifications** alongside your code. It runs entirely on your machine: a web-based editor (tiptap + React), a local SQLite database for structured entities (endpoints, DTOs, tables, acceptance criteria, UI views), and a built-in AI chat for spec authoring assistance.

## Why

- **Specifications live with the code.** No external SaaS, no copy-paste between Notion and your repo.
- **Structured entities, not just markdown.** Endpoints, DTOs, and AC are first-class records you can reference, link, and query.
- **Briefs → implementation.** Specs can produce self-contained implementation briefs that an AI coding agent (Claude Code) can execute directly.
- **Open data.** Everything is markdown files + a SQLite file in your repo. No vendor lock-in.

## Install & run

```bash
npx @inharness-ai/claude4spec
```

This launches the editor on `http://localhost:3000` and creates a `.claude4spec/` directory in the current working directory (database + config).

For a global install:

```bash
npm i -g @inharness-ai/claude4spec
claude4spec
```

## CLIs

| Command       | Purpose                                                                 |
|---------------|-------------------------------------------------------------------------|
| `claude4spec` | Launch the web editor.                                                  |
| `c4s`         | Read specification entities from the terminal (`c4s endpoint <slug>`).  |
| `c4s-mcp`     | MCP server exposing specification entities to MCP-aware clients.        |

## Claude Code integration

When used inside a Claude Code project, this package installs two skills:

- **`c4s-spec-reader`** — resolves XML entity tags (`<inline_mention/>`, `<single_element/>`, `<tagged_list/>`) in markdown pages into full entity data.
- **`c4s-brief-implementer`** — implements features described in self-contained briefs from `.claude4spec/briefs/`.

## Requirements

- Node.js >= 20

## License

MIT — see [LICENSE](./LICENSE).
