# Review — m23-list-patches (non-blocking)

- rev-0002 `src/bin/c4s/commands/list-patches.ts:47` — an unknown `--status` reaches the server as `?applied=<value>`; the VALIDATION message names `?applied` and `true|false`, not the flag and `applied|pending`. Fix: rewrite the message for the CLI, or validate locally while keeping the VALIDATION code.
