# Harness — Claude Code headless (`claude -p`)

The driver (`driver.md`) is the orchestrator and calls one headless run per role. Everything below is adapter configuration; the protocol does not change.

## Prompt

Each run's prompt is `.c4s-impl/prompts/<role>.md` followed by the scope block the driver writes to `.c4s-impl/runs/<n>-<role>.scope.md`. No instruction file carries the protocol: the repo's own `CLAUDE.md` loads as usual and stays untouched.

## MCP configuration

`.c4s-impl/mcp.json`, passed with `--mcp-config`. It holds only the extra verifier tools from `release.json` → `build.verifierTools` (a browser server, say); the roles read the specification through the `c4s` CLI.

## Invocation per role

```sh
# implementer (build mode → iteration-status.json; split mode → split.json)
claude -p "$(cat .c4s-impl/prompts/implementer.md .c4s-impl/runs/<n>-implementer.scope.md)" \
  --output-format json --json-schema "$(cat .c4s-impl/schemas/<iteration-status|split>.json)" \
  --permission-mode dontAsk \
  --allowedTools "Read,Edit,Write,Glob,Grep,Bash(c4s *),Bash(<filtered test command> *),Bash(<whole-suite command>),Bash(git status*),Bash(git diff*)" \
  --disallowedTools "Agent,AskUserQuestion" \
  --max-turns <budget.implementer>

# verifier (unit) and verifier-system
claude -p "$(cat .c4s-impl/prompts/verifier.md .c4s-impl/runs/<n>-verifier.scope.md)" \
  --output-format json --json-schema "$(cat .c4s-impl/schemas/verdict.json)" \
  --permission-mode dontAsk \
  --allowedTools "Read,Glob,Grep,Bash(c4s *),Bash(<filtered test command> *),Bash(<whole-suite command>),Bash(<e2e command> *)" \
  --disallowedTools "Edit,Write,Agent,AskUserQuestion" \
  --mcp-config .c4s-impl/mcp.json \
  --max-turns <budget.verifier>

# reviewer
claude -p "$(cat .c4s-impl/prompts/reviewer.md .c4s-impl/runs/<n>-reviewer.scope.md)" \
  --output-format json --json-schema "$(cat .c4s-impl/schemas/review.json)" \
  --permission-mode dontAsk \
  --allowedTools "Read,Glob,Grep,Write(.c4s-impl/deviations/*),Bash(git diff*),Bash(git log*)" \
  --disallowedTools "Edit,Agent,AskUserQuestion" \
  --max-turns <budget.reviewer>
```

The role's JSON arrives in `structured_output` of the result.

## Resume inside a role

A run that hit `--max-turns` is not resumed: the next iteration runs a fresh implementer on the same portion, which finishes what the repo still lacks. `--resume` is for a human debugging a run.

## The running app

The driver brings it up (`ensureApp()` in `loop-protocol.md`) with `app: command:<cmd>`, taking the last line of the command's output as the URL, and passes it in the verifier's scope as `app`. `app: skill:…` needs a session to follow the skill; set-up refuses it for this harness.

## Permissions

Run in a worktree or a container. `dontAsk` denies every tool outside `--allowedTools`, so the allow-list is the whole permission model. No hooks, skills or subagents are part of the protocol.

## Status mapping

| Harness outcome | Iteration status |
| --- | --- |
| a result with valid `structured_output` | as reported by the role |
| `--max-turns` reached, partial output | `progressed`, `stoppedEarly: true` |
| non-zero exit, auth error, specification server down | `error` (retry cap `retries.error`, then `gate`) |
