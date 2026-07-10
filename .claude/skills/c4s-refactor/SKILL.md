---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (a read-only plan via `c4s ask`) or to the code (an analysis brief via `c4s agent --ct chat` + `runTransagent`). Use when reconciling spec with implementation ("check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
---

# c4s-refactor

A **spec↔code drift router**. For a single topic this skill reads the claude4spec
specification, analyzes the matching code, detects **drift**, classifies it, and
routes the fix to the right place. It performs **no edits itself** — it classifies
and hands off:

1. drift that needs a **specification** change → open a read-only planning turn
   (`c4s ask`),
2. drift that needs a **code** change → describe it in an **analysis brief**
   (`c4s agent --ct chat` + `runTransagent`, see Path 2 below).

Execution is downstream: a human continues the spec plan thread, and the
`c4s-brief-implementer` skill implements the brief.

**Never implement the fix yourself, even mid-conversation.** The whole point of
this skill is that it classifies and hands off — it does not edit code or spec,
no matter how obvious the fix looks once you've found it. This holds even when
the drift surfaces *after* an initial verdict: e.g. you report "none" for the
original topic, then a follow-up question or a concrete repro from the user
reveals a real, separate defect. Treat that as a **new finding** — go back to
step 4, classify it, and route it via Path 1 or Path 2 like anything else.
Don't slide into "well, I already know the fix, let me just make the edit."
The only exception is the user explicitly telling you, for that turn, to
implement directly instead of routing — that overrides this default, but only
for what they asked for.

**CLI only — never call `curl` or the HTTP API directly.**

This skill is bound to one specification project — every `c4s` command below
carries its identity (`--project 'app-spec' --workspace 'default'`), so it works from any cwd. Do NOT `cd`
into the spec repo; the identity is baked in, not derived from cwd.

## Input — a topic is required

The argument is the **topic/scope** to analyze — a single feature, module,
endpoint, table, or behavior, e.g.:

- module — `M17 snapshots`, `M19 references`
- layer — `L5 ui`, `L2 domain`
- entity / slug — `endpoint get-api-acs`, `dto chat-message`
- tag — `entity-ac`, `releases`

**Invoked with no topic → ask the user to narrow the scope.** Do **not** scan the
whole spec at once.

## Reading the spec

Read the spec through the `c4s` reader — see the `c4s-spec-reader` skill for the
full command reference. In short:

```sh
c4s catalog --project 'app-spec' --workspace 'default'                                   # entity types + schemas
c4s list-tags --project 'app-spec' --workspace 'default'                                 # tags + counts
c4s list-slugs --type endpoint --project 'app-spec' --workspace 'default'                # slugs for a type
c4s single_element --type endpoint --slug <x> --project 'app-spec' --workspace 'default'
c4s resolve modules/<module>.md --project 'app-spec' --workspace 'default'               # expand a page's tags inline
```

**CLI-only — no filesystem fallback.** If `c4s` isn't installed, STOP and ask
the user to install it; never read the spec repo's pages directly.

## Process

### 1. Establish the topic

Confirm the scope and gather vocabulary (`c4s list-slugs`, `c4s list-tags`,
`c4s catalog`). If no topic was given, ask the user to narrow it first.

### 2. Read the spec

Read the spec for the topic — what the spec **says** is the contract side of the
comparison.

### 3. Analyze the code

Read the matching code (routes/endpoints, DTOs, domain services, UI). Establish
what the code **actually does** — the implementation side of the comparison.

### 4. Detect & classify drift

Compare the spec (contract) against the code (behavior) and put each difference in
exactly one bucket:

- **spec-fix** — the code is the intended/current behavior; the spec is missing it
  or describes it incorrectly → **Path 1**.
- **code-fix** — the spec is the intended contract and is correctly written, but
  the code doesn't meet it (real drift), OR the topic is genuinely outside the
  spec's scope (nothing meaningful to add/change there) → **Path 2**.
- **none** — report "in sync" and **STOP**.

**Never route the same difference to both paths.** If a topic has multiple
distinct differences, split it into separate sub-issues and classify each one
into exactly one bucket. If a single difference genuinely needs a spec change,
it goes to Path 1 **only** — do not also file a Path 2 brief for it. The code
side of a spec-fix is handled later, downstream: a human resolves the spec plan
thread, and either turns the result into a brief themselves or re-runs this
skill afterward (at which point the code will correctly classify as drift
against the now-updated spec, or as "none" if it already matches). Path 2 is
reserved for differences that are *not* a spec problem at all.

### 5. Path 1 — spec-fix → read-only plan (`c4s ask`)

`c4s ask` is read-only and forces plan-mode (a peer-consult), so the agent
**always produces a plan** of spec changes and never mutates the spec:

```sh
c4s ask "Spec drift on <topic>: <description>. Create a plan of specification \
changes — list the entities/pages to change and the exact edits. Plan only, do \
not execute." --project 'app-spec' --workspace 'default'
```

**Record the returned `threadId`.** This skill does **not** apply the plan — a human
continues the thread (`c4s ask "..." --thread <threadId>`, or in the UI).

### 6. Path 2 — code-fix → analysis brief (`c4s agent --ct chat` + `runTransagent`)

Route a code fix into an **analysis brief** that the `c4s-brief-implementer` skill
can implement later.

**Do not use `c4s agent --ct brief`, and there is no `--source` flag.** That
combination puts the top-level agent in brief-*attach* mode, which requires an
already-minted brief path — for a name that doesn't exist yet, the turn's
`get_brief` call fails `NOT_FOUND` inside the turn (the CLI still exits 0, but
no brief gets authored). `c4s ask` has no brief tooling at all either.

**The working route is `c4s agent --ct chat`, explicitly instructed to call the
`runTransagent` MCP tool** (deferred — the chat agent loads it via ToolSearch)
with `contextType: 'brief'`:

```sh
c4s agent "Run mcp__transagent-tools__runTransagent with contextType='brief', \
payload={ suffix: '<short-topic-slug>' }, message: 'Code drift on <topic>: the \
spec says Y but the code does X. <what the implementer must change and why>'." \
--ct chat --project 'app-spec' --workspace 'default'
```

`runTransagent(contextType, message, payload?, threadId?)` delegates to a
hidden child thread ("banka") of the spec; for `contextType: 'brief'` the child
runs the `layered-vertical-slices` brief workflow and writes a real brief
artifact into `.claude4spec/briefs/` with proper frontmatter (`type: brief`,
`source: analysis`, `to_release: null`, `implemented: false`) — exactly what
`c4s-brief-implementer` consumes. The file name prepends the release prefix,
e.g. suffix `m33-plugin-frontend-phase2-serving` →
`0-1-84-to-next-m33-plugin-frontend-phase2-serving.md`.

**Don't run `c4s agent --ct chat` without explicitly naming the transagent** —
left to its own devices the chat agent will just `Write` a loose `.md` in the
spec repo root: wrong directory, not a registered brief, invisible to
`c4s-brief-implementer`.

The turn's response (summary/messages) reports the created brief's path —
record it for handing off to `c4s-brief-implementer`.

### 7. Report + STOP

Print and **finish** (no execution):

- the topic and the drift classification (spec-fix / code-fix / none),
- the created `threadId` (Path 1) or `briefPath` (Path 2) — never both for the
  same difference,
- next step: a human continues the spec plan thread;
  `c4s-brief-implementer` implements the brief.

## Hard dependency & gotchas

- **Both routing paths require the `c4s` CLI AND a running server.** Without a server
  the skill can still read the spec and analyze the code, but it **cannot route the
  fix** (`c4s ask` / `c4s agent` delegate the turn to the server). The read-only
  `resolve` / `list-*` / `single_element` commands do not need a server.
- **The identity is baked in — never `cd`.** `--project 'app-spec' --workspace 'default'` is injected into every
  command above; `cd`-ing into the spec repo is unnecessary and, if it's reached
  through a symlink, can even break resolution.
- **`c4s ask` is read-only** — it yields a plan only and never mutates the spec;
  execution is a separate, human-driven step.
- **Path 2 mints the brief via `runTransagent`, not `c4s agent --ct brief`.**
  `--ct brief --brief <path>` is attach-mode and expects a pre-existing brief;
  there is no `--source` flag. Use `c4s agent --ct chat`, explicitly instructing
  it to call `runTransagent({contextType: 'brief', ...})` — see Path 2 above.
- **Never file the same difference to both Path 1 and Path 2**, and never
  implement a fix directly in this skill's session — classify, route, stop.

## Notes

This is a **base skill** generated by claude4spec, delivered on demand via
`c4s install-skills` or the Settings page's "External Skills" ZIP download —
nothing regenerates it automatically once it lands in your project's
`.claude/skills/`. Edits you make here are yours to keep.
