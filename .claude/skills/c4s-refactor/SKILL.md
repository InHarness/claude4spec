---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (a read-only plan via `c4s ask`) or to the code (a brief against the current state via `c4s agent --ct brief`). Use when reconciling spec with implementation ("check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
---

# c4s-refactor

A **spec↔code drift router**. For a single topic this skill reads the claude4spec
specification, analyzes the matching code, detects **drift**, classifies it, and
routes the fix to the right place. It performs **no edits itself** — it classifies
and hands off:

1. drift that needs a **specification** change → open a read-only planning turn
   (`c4s ask`),
2. drift that needs a **code** change → describe it in a **brief against the
   current state** (`c4s agent --ct brief`).

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
c4s list-tags --with-counts --project 'app-spec' --workspace 'default'                   # tags + counts (counts are opt-in)
c4s list-entities --type endpoint --project 'app-spec' --workspace 'default'             # { slug, title } rows for a type
c4s single_element --type endpoint --slug <x> --project 'app-spec' --workspace 'default'
c4s resolve modules/<module>.md --project 'app-spec' --workspace 'default'               # expand a page's tags inline
```

**CLI-only — no filesystem fallback.** If `c4s` isn't installed, STOP and ask
the user to install it; never read the spec repo's pages directly.

## Process

### 1. Establish the topic

Confirm the scope and gather vocabulary (`c4s list-entities`, `c4s list-tags`,
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

### 6. Path 2 — code → brief (`c4s create-brief`)

Route a code fix into a **brief against the current state** that the
`c4s-brief-implementer` skill implements later. You write the body yourself;
no agent turn is involved at any point.

**Step 1 — write the body to a file.** The implementer starts in a fresh
terminal with none of your findings, so the body must be **self-contained**.
Four parts, in this order:

1. **What the specification says** — the quote, plus the slugs of the acceptance
   criteria and entities that carry the intent.
2. **What the code does** — files with line numbers, and the behaviour that
   diverges.
3. **What the implementer must change** — the concrete edit, file by file.
4. **How to verify it** — the tests or commands that must pass.

**Step 2 — save the brief.** One call, no turn:

```sh
c4s create-brief --body-file /tmp/drift-<topic>.md --project 'app-spec' --workspace 'default'
```

It prints `briefPath` (and the brief's `hash`). Passing no release window is
what makes this a brief **against the current state**: the window's `to` end
stays open, so there is no second release to diff against.

Hard rules for this path:

- **`--body-file`, never an inline body.** Multi-line markdown full of
  backticks does not survive a shell.
- **Path 2 calls `c4s agent` in no mode** — not create, not attach. A turn in a
  `brief` thread operates on `release_diff` alone: it sees neither the current
  specification nor the code, so it may legitimately refuse to write anything,
  and the caller is handed exit 0 and a brief containing only a heading. Feeding
  it the context you already hold does not improve the result, it only adds a
  point of failure. `c4s file-patch` is the precedent for the shape: it, too,
  takes the caller's intent rather than a turn's output.
- **`VALIDATION` from `c4s create-brief` means exactly one thing:** the file you
  passed was empty.

### 7. Report + STOP

Print and **finish** (no execution):

- the topic and the drift classification (spec-fix / code-fix / none),
- the created `threadId` (Path 1) or the `briefPath` returned by
  `c4s create-brief` (Path 2) — never both for the same difference,
- next step: a human continues the spec plan thread;
  `c4s-brief-implementer` implements the brief.

## Server required — for every step

Every `c4s` command in this skill talks to a running `npx @inharness-ai/claude4spec` server. There is no filesystem-scoped subset: since 0.2.13 the CLI opens no database and reads no specification file, so reading a brief, listing entities and running an agent turn all fail the same way when the server is down.

**`SERVER_NOT_RUNNING` (exit 8) from any command — stop.** Ask the user to start the server, and wait. Do not start one yourself (a CLI-spawned server is an unsupervised second process on the user's machine), and do not work around the failure by reading or writing the spec repo's files by hand — that is the thing this skill exists to prevent, and the reason it is CLI-only.

Two neighbouring codes mean something else, and starting a server will not fix either: `SERVER_NOT_RECOGNIZED` (something is listening, but it is not claude4spec) and `PROJECT_NOT_IN_WORKSPACE` (the server is fine; this project is not registered in the workspace you named). Report those as they are.

Reading the spec and analyzing the code are not an exception to it: `resolve`, the `list-*` readers and `single_element` delegate to the server exactly as `c4s ask` / `c4s agent` do. With the server down this skill cannot detect drift, let alone route it.

## Hard dependency & gotchas

- **The identity is baked in — never `cd`.** `--project 'app-spec' --workspace 'default'` is injected into every
  command above; `cd`-ing into the spec repo is unnecessary and, if it's reached
  through a symlink, can even break resolution.
- **`c4s ask` is read-only** — it yields a plan only and never mutates the spec;
  execution is a separate, human-driven step.
- **Path 2 uses create-mode, not attach-mode.** Mint the brief via
  `c4s agent --ct brief` with no window flags. Don't pass `--brief <path>` —
  that's attach-mode, which expects a pre-existing brief.
- **Never file the same difference to both Path 1 and Path 2**, and never
  implement a fix directly in this skill's session — classify, route, stop.

## Notes

This is a **base skill** generated by claude4spec, delivered on demand via
`c4s install-skills` or the Settings page's "External Skills" ZIP download —
nothing regenerates it automatically once it lands in your project's
`.claude/skills/`. Edits you make here are yours to keep.
