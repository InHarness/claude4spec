---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (read-only plan via `c4s ask`) or to the code (a brief via `c4s agent --ct chat` + `runTransagent`). Use when reconciling spec with implementation ("/c4s-refactor", "check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
---

# C4S Refactor

A **spec↔code drift router**. For a given topic this skill reads the CLAUDE 4 SPEC
specification, analyzes the matching code in `src/`, detects **drift**, classifies
it, and routes the fix to the right place:

1. drift requires a **specification** change → open a read-only planning turn (`c4s ask`),
2. drift requires a **code** change → describe it in a **brief** (`c4s agent --ct chat`
   driving the `runTransagent` brief tool).

**Scope: analysis + routing + STOP (hand-off).** This skill does **not** edit the
spec or the code itself. Execution is downstream: the spec agent (a human continues
the plan thread) and [`c4s-brief-implementer`](../c4s-brief-implementer/SKILL.md)
(implements the brief).

**CLI only — never use `curl` or the HTTP API directly.**

## Input / Argument

The argument is the **topic/scope** to analyze, e.g.:

- module — `M17 snapshots`, `M19 references`
- layer — `L5 ui`, `L2 domain`
- entity / slug — `endpoint get-api-acs`, `dto chat-message`
- tag — `entity-ac`, `releases`

No argument → **ask the user to narrow the topic** (don't scan the whole spec at once).

## Reading the spec

Prefer the read-only `c4s` commands, always with `--project app-spec` (the spec's
registered project name):

```sh
c4s catalog    --project app-spec          # entity types + schemas
c4s list-tags  --project app-spec          # tags + counts
c4s list-slugs --type endpoint --project app-spec
c4s single_element --type endpoint --slug <x> --project app-spec
c4s tagged_list    --type dto --tags <tag> --filter and --project app-spec
c4s resolve modules/m17-snapshots-releases.md --project app-spec
```

Manual fallback (when the CLI/server is unavailable): read `modules/*.md`,
`entities/*.md`, `layers/*.md` and entity JSON under
`.claude4spec/entities/<type>/<slug>.json`.

**See [`c4s-spec-reader`](../c4s-spec-reader/SKILL.md) for the full command reference
and the `--project` / `PROJECT_NOT_FOUND` symlink gotcha** — not repeated here.

## Process

### 1. Establish the topic

Confirm the scope and gather vocabulary: `c4s list-slugs --type <t>`, `c4s list-tags`,
`c4s catalog` (all with `--project app-spec`).

### 2. Read the spec

Read the spec for the topic (see *Reading the spec* above) — what the spec **says**
is the contract side of the comparison.

### 3. Analyze the code

Read the matching code in `src/`: routes/endpoints, DTOs, domain services, UI. Establish
what the code **actually does** — the implementation side of the comparison.

### 4. Detect & classify drift

Compare spec (contract) against code (behavior) and put each difference in one bucket:

- **spec-fix** — the code is the intended/current behavior; the spec is missing it or
  describes it incorrectly → **Path 1**.
- **code-fix** — the spec is the intended contract; the code doesn't meet it → **Path 2**.
- **both** — run both paths; note the priority (usually reconcile the spec first, then the code).
- **none** — report "in sync" and **stop**.

### 5. Path 1 — spec → plan (`c4s ask`)

`ask` is read-only and forces plan-mode, so the agent **always produces a plan** of
spec changes and never mutates the spec:

```sh
c4s ask "Create a plan of specification changes for <topic>. Drift found: <description>. \
List the entities/pages to change and the exact edits — plan only, do not execute." \
  --project app-spec --workspace default
```

Record the returned `threadId`. A human continues the thread to execute the plan
(`c4s ask "..." --thread <threadId>`, or in the UI).

### 6. Path 2 — code → brief (`c4s agent --ct chat` + `runTransagent`)

**Do NOT use `c4s agent --ct brief` to author a new brief** — that puts the top-level agent
in BRIEF mode, where the brief must already be minted (release-bound) and `get_brief` returns
`NOT_FOUND` for a new name, so it aborts. `c4s ask` has no brief tooling at all. The working
route is a **`--ct chat` turn that drives the `runTransagent` MCP tool**, which spawns a hidden
child ("banka") that authors and **saves the brief itself** into
`.claude/skills/specyfikacja/.claude4spec/briefs/`:

```sh
c4s agent --ct chat \
  "Run the brief transagent: call mcp__transagent-tools__runTransagent (load via ToolSearch \
if deferred) with contextType='brief' and payload.suffix='<brief-slug>'. Do NOT Write the \
file yourself — drive it through the transagent. Pass this as the message (it must become a \
self-contained analysis brief with a 'For implementers' section): '<drift description + \
references to spec entities/pages, exact files/lines to change>'. \
Report the runTransagent arguments and raw result (threadId + saved brief filename)." \
  --project app-spec --workspace default
```

The tool: `runTransagent(contextType: 'brief'|'chat'|'patch', message, payload?, threadId?)`.
For `contextType:'brief'` it creates an **analysis brief** (`source: analysis`, `to_release: null`)
grounded in `message`; `payload` for brief is `{ fromReleaseName?, suffix?, content? }`. The child
prepends the release prefix to `suffix`, e.g. `m33-...-phase2` →
`0-1-84-to-next-m33-...-phase2.md`. Only **one** child runs per `--ct chat` turn, so author one
brief per call (e.g. a Phase-2 call, then a Phase-3 call). The result reports a `threadId`; locate
the saved file with `ls .claude/skills/specyfikacja/.claude4spec/briefs/*<slug>*`.

Record the `briefPath`. [`c4s-brief-implementer`](../c4s-brief-implementer/SKILL.md)
implements the brief later.

### 7. Report + STOP

Print and **finish** (no execution):

- the topic and the drift classification (spec-fix / code-fix / both / none),
- the created `threadId` (Path 1) and/or `briefPath` (Path 2),
- next step: a human continues the spec plan thread; `c4s-brief-implementer` implements the brief.

## Gotchas

- **Server:** `c4s ask` and `c4s agent` need a running `npx claude4spec`; read-only
  `resolve` / `list-*` / `single_element` do not.
- **`--project app-spec`, not the symlink path:** the spec lives at
  `.claude/skills/specyfikacja`, a symlink; `cd`-ing in (or anything else that canonicalizes
  it) resolves `cwd` to the real path ≠ the registered one → `PROJECT_NOT_FOUND`. Passing the
  registered **name** (`app-spec`) sidesteps this entirely — always pass `--project app-spec`.
- **`--workspace default` for `ask`/`agent`:** name lookup is scoped to `--workspace` when
  given, else searched across all workspaces — if `app-spec` matched a project in more than
  one workspace, `c4s` would fail with `AMBIGUOUS_WORKSPACE` (exit 7). Always pass
  `--workspace default` (port 4508) to keep the lookup explicit. If your `npx claude4spec`
  server runs on a different workspace, pass that name instead (the error message lists the
  candidates and their ports).
- **`ask` is read-only** — it yields a plan only and never mutates the spec; execution is
  a separate, human-driven step.
- **CLI only — never `curl` or the HTTP API.**
- **Brief authoring = `--ct chat` + `runTransagent`, NOT `--ct brief`.** `c4s agent --ct brief`
  needs a pre-minted release-bound brief (`get_brief` → `NOT_FOUND` for a new slug → it aborts);
  `c4s ask` has no brief tools. Only the `--ct chat` turn driving
  `mcp__transagent-tools__runTransagent` (with `contextType:'brief'`) mints a real analysis brief.
  Telling a `--ct chat` agent to "just write the brief" makes it `Write` a loose `.md` in the spec
  root (wrong dir, not a registered brief) — always route through `runTransagent`.
- **Language:** agent prompts and any user-facing output in English.
- **Related skills:** [`c4s-spec-reader`](../c4s-spec-reader/SKILL.md) (reading the spec),
  [`c4s-brief-implementer`](../c4s-brief-implementer/SKILL.md) (downstream code implementation).
