# Harness — a Claude Code interactive session as the orchestrator

No driver and no `claude -p`: the Claude Code session that ran `setup.md` **is** the orchestrator. Every implementer, verifier and reviewer run is a fresh subagent, so the separation of contexts still holds.

## The loop inside one session

The session context is long-lived, so it **never holds packets, diffs or verdict reasoning**. It executes `resume()` from `loop-protocol.md` literally, every iteration starting from the files, not from memory:

```
loop:
  read .c4s-impl/*                       → derive the next step (resume())
  if gate / done / waiting → stop and tell the human why
  subagent per role run — fresh context; prompt = the materialized prompt + the scope block; returns JSON only
  validate the JSON against .c4s-impl/schemas/<schema>.json; invalid or missing → stoppedEarly, the portion stays in-progress
  update state.json; ship deviations with c4s create-patch
  commit the checkpoint; when the unit was verified, squash u.baseCommit..HEAD into "unit(<unit>): …"
```

- **A subagent's prompt is the role's file plus its scope**: the content of `.c4s-impl/prompts/<role>.md`, then the scope block (`loop-protocol.md`, "Scope of a run"), then "Return only the JSON per `<schema>`." Nothing is copied into `CLAUDE.md`; the repo's own `CLAUDE.md` stays as it is.
- **The verifier never receives the implementer's report**, and the reviewer never receives either — only their scope and the state dir.
- **After a context compaction** the session re-reads `.c4s-impl/` before the next step; by construction it loses nothing the protocol needs.
- **Gates** are the session stopping and reporting (with `review/*.md` when there is one); the human answers "continue" in the same thread — the file protocol's "delete `gate`".
- **`waiting`**: the session stops, lists the blocking deviations and tells `release.json`'s `waiting.recipient`. The answer comes through the specification: edit, release, and a new brief for the next window.
- **A subagent that returns without JSON** (turn limit, context overflow, error) counts as `stoppedEarly`; the next iteration runs the implementer on the same portion again.
- **No parallel units** (`defaults.md` → `parallelUnits: off`).
- **The running app** (`ensureApp()` in `loop-protocol.md`): the session brings it up itself, never a subagent — with `app: command:<cmd>` it runs the command and takes the last line as the URL; with `app: skill:<name>` it follows that skill, doing first whatever the skill needs (a pushed branch, say), and takes the URL it answers with. The URL goes into the verifier's scope block as `app`.

## Tools

- the `c4s` CLI on PATH, and the specification server running;
- the test commands from `release.json`, and what `build.app` needs;
- the extra verifier tools (a browser MCP server, say) configured in the session's `.mcp.json`, which subagents inherit;
- the reviewer: with `reviewer: same-harness` a subagent; with another harness, that harness's reviewer invocation from its file.

## Status mapping

| Subagent outcome | Iteration status |
| --- | --- |
| valid JSON per schema | as reported |
| no JSON, or partial | `progressed`, `stoppedEarly: true`, the portion stays in-progress |
| tool failure, specification server down | `error`; retry per `retries.error`, then stop and tell the human |
