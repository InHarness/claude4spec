# Defaults — your choices, filled once

This repo versions this skill, so these values are yours. Fill the **Value** column once; `setup.md` asks only for a row left as `ask`, and writes the result to `.c4s-impl/release.json` (`build`). A row's value can be overridden per brief at setup.

<!-- Using one harness only? Delete the other harness rows below, the other files in harness/,
     and — for a session harness — harness/driver.md and harness/driver-reference.mjs. -->

| Choice | Value | Options and notes |
| --- | --- | --- |
| `harness` | `claude-code-session` | `claude-code-session` (one interactive session is the orchestrator; roles are subagents) · `claude-code-headless` (`claude -p`, driven by the driver) · `codex` (`codex exec`, driven by the driver) |
| `tests.suite` | `ask` | the command that runs the whole test suite, e.g. `npm test` |
| `tests.filtered` | `ask` | the command that runs tests whose name matches a pattern; `<pattern>` marks where it goes, e.g. `npx vitest run -t "<pattern>"` |
| `tests.e2e` | `ask` when `app` is not `none` | the command that runs end-to-end tests against the running app; `<url>` marks where the app's base URL goes, `<pattern>` where a test-name pattern goes |
| `tests.smoke` | `ask` when `app` is not `none` | the command that proves the app at `<url>` is up and usable; exit 0 is green. A red smoke stops the loop at a gate |
| `app` | `none` | how the loop brings the app up for end-to-end tests: `none` (no running app; an end-to-end test starts what it needs itself) · `command:<cmd>` (brings the app up from the current checkout and prints its base URL as the last line of its output; run again, it brings up the current HEAD) · `skill:<name>` (a skill that does the same and answers with the URL — session harness only) |
| `app.down` | `keep` | `keep` (the app stays up for the human after the loop ends) · `command:<cmd>` (takes it down when the loop is done) |
| `isolation` | `worktree` | `worktree` (a git worktree under `.worktrees/<brief-slug>`) · `container` · `main-checkout` (only for a throw-away clone) |
| `budget.packetKB` | `150` | a unit packet above this is split into portions (`reading-the-spec.md`, split mode); below it the unit is one portion |
| `budget.implementer` | `60` | turns (Claude Code) or minutes (Codex) per implementer run |
| `budget.verifier` | `40` | turns or minutes per verifier run |
| `budget.reviewer` | `30` | turns or minutes per reviewer run |
| `gates` | `["wave"]` | any of `wave0` (after wave 0), `wave` (every wave boundary), `every:<N>` (every N iterations). Always on regardless: red baseline, next window, `stuck`, `blocked(review)`, `waiting` |
| `review` | `per-unit` | `off` · `per-unit` (after the unit-scope verifier passes) · `per-wave` (once per wave, over the wave's diff) |
| `reviewer` | `same-harness` | `same-harness` · `<other harness>` (e.g. `codex` reviews Claude's code) · `command:<cmd>` (e.g. `command:/code-review high`) — **not supported yet**: a command needs a converter to `review.json`; setup refuses it |
| `verifierTools` | `none` | `none` · `browser` (an MCP browser server) · `db` (a DB client) · several; configured per harness file |
| `startMode` | `detect` | `detect` (setup decides: a delta window is `resume`; an initial window asks) · `greenfield` · `resume` |
| `waiting.recipient` | `ask` | who answers a blocking deviation (a person, a channel) |
| `waiting.channel` | `stdout` | `stdout` (the session or terminal says so) · `notify:<command>` (a command run with the message) |
| `git.stateDir` | `commit-then-remove` | `.c4s-impl/` is committed on the branch, so `resume()` works from another machine, and removed in the last commit before merge. Do **not** gitignore it — only `.c4s-impl/packets/` is ignored |
| `parallelUnits` | `off` | units of one wave run one at a time: one `state.json` has no merge rule yet |
| `retries.error` | `2` | an `error` status is retried this many times, then `gate` |
| `stuck.rounds` | `3` | unit-verifier rounds without the uncovered list shrinking before a unit is `stuck`; the same cap counts review rounds and consecutive stopped-early runs of one portion |

Where and how a command runs is this project's business, written into the command itself: on this machine, in a container, in a remote environment, through a wrapper script. The loop knows only that it runs, its exit code and the tail of its output. A project whose tests may not run on the developer's machine says so here, in `tests.*`, not in the skill.
