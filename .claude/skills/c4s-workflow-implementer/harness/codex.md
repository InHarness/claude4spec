# Harness — Codex CLI (`codex exec`)

Same protocol, different flags. The driver (`driver.md`) is the orchestrator and calls one non-interactive run per role.

## Prompt

Each run's prompt is `.c4s-impl/prompts/<role>.md` followed by the driver's scope block. No instruction file carries the protocol: the repo's own `AGENTS.md` loads as usual and stays untouched.

## MCP configuration

A config file under `.c4s-impl/`, selected per run, holding only the extra verifier tools from `release.json` → `build.verifierTools`; run with `--ignore-user-config` so the loop does not depend on the user's global configuration. The roles read the specification through the `c4s` CLI.

## Invocation per role

```sh
# implementer (schema: iteration-status.json, or split.json in split mode)
codex exec "$(cat .c4s-impl/prompts/implementer.md .c4s-impl/runs/<n>-implementer.scope.md)" \
  --json --output-schema .c4s-impl/schemas/<iteration-status|split>.json -o .c4s-impl/runs/<n>-implementer.json \
  --sandbox workspace-write --ignore-user-config

# verifier, verifier-system (schema: verdict.json); reviewer (schema: review.json)
codex exec "$(cat .c4s-impl/prompts/<role>.md .c4s-impl/runs/<n>-<role>.scope.md)" \
  --json --output-schema .c4s-impl/schemas/<verdict|review>.json -o .c4s-impl/runs/<n>-<role>.json \
  --sandbox workspace-write --ignore-user-config
```

The verifier needs `workspace-write` to run the test runner. Its prompt says it edits nothing; the driver diffs the worktree after every verifier and reviewer run and writes `gate("<role> wrote files")` if anything outside `.c4s-impl/deviations/` changed.

Codex has no turn cap: the driver enforces the wall-clock limit from `build.budget` (minutes) and kills the process. A killed run is `progressed` with `stoppedEarly: true`.

As a **reviewer of another harness's code** (`reviewer: codex` with `harness: claude-code-*`), only the reviewer invocation above is used.

## The running app

The driver brings it up (`ensureApp()` in `loop-protocol.md`) with `app: command:<cmd>`, taking the last line of the command's output as the URL, and passes it in the verifier's scope as `app`. `app: skill:…` needs a session to follow the skill; set-up refuses it for this harness.

## Permissions

Worktree or container. The sandbox is the whole permission model and there is no per-tool allow-list, so isolation matters more here than with Claude Code.

## Status mapping

| Harness outcome | Iteration status |
| --- | --- |
| the final message parses against the schema | as reported by the role |
| wall-clock kill | `progressed`, `stoppedEarly: true` |
| non-zero exit, auth error, specification server down | `error` (retry cap `retries.error`, then `gate`) |
| worktree changed after a verifier or reviewer run | `gate("<role> wrote files")` |
