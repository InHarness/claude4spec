export const REFACTOR_FRONTMATTER = `---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (a read-only plan via \`c4s ask\`) or to the code (an analysis brief via \`c4s agent --ct chat\` + \`runTransagent\`). Use when reconciling spec with implementation ("check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
---
`;

export const REFACTOR_BODY = `# c4s-refactor

A **spec↔code drift router**. For a single topic this skill reads the claude4spec
specification, analyzes the matching code, detects **drift**, classifies it, and
routes the fix to the right place. It performs **no edits itself** — it classifies
and hands off:

1. drift that needs a **specification** change → open a read-only planning turn
   (\`c4s ask\`),
2. drift that needs a **code** change → describe it in an **analysis brief**
   (\`c4s agent --ct chat\` driving the \`runTransagent\` brief tool).

Execution is downstream: a human continues the spec plan thread, and
[\`c4s-brief-implementer\`](../c4s-brief-implementer/SKILL.md) implements the brief.

**CLI only — never call \`curl\` or the HTTP API directly.**

## Input — a topic is required

The argument is the **topic/scope** to analyze — a single feature, module,
endpoint, table, or behavior, e.g.:

- module — \`M17 snapshots\`, \`M19 references\`
- layer — \`L5 ui\`, \`L2 domain\`
- entity / slug — \`endpoint get-api-acs\`, \`dto chat-message\`
- tag — \`entity-ac\`, \`releases\`

**Invoked with no topic → ask the user to narrow the scope.** Do **not** scan the
whole spec at once.

## Reading the spec

Read the spec through the \`c4s\` reader — see
[\`c4s-spec-reader\`](../c4s-spec-reader/SKILL.md) for the full command reference and
the \`--project\` / \`PROJECT_NOT_FOUND\` symlink gotcha (not repeated here). In short:

\`\`\`sh
c4s catalog                                   # entity types + schemas
c4s list-tags                                 # tags + counts
c4s list-slugs --type endpoint                # slugs for a type
c4s single_element --type endpoint --slug <x>
c4s resolve modules/<module>.md               # expand a page's tags inline
\`\`\`

Point at the spec project with the \`--project\` **flag** (not \`cd\`): the spec dir is
often a symlink, and \`cd\`-ing into it resolves \`cwd\` to the real path ≠ the
registered one → \`PROJECT_NOT_FOUND\`.

Manual fallback (when the CLI/server is unavailable): read \`modules/*.md\`,
\`entities/**\`, \`layers/*.md\`, and the entity JSON store under
\`.claude4spec/entities/<type>/<slug>.json\`.

## Process

### 1. Establish the topic

Confirm the scope and gather vocabulary (\`c4s list-slugs\`, \`c4s list-tags\`,
\`c4s catalog\`). If no topic was given, ask the user to narrow it first.

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
- **code-fix** — the spec is the intended contract; the code doesn't meet it →
  **Path 2**.
- **both** — run both paths; note the priority (usually reconcile the spec first,
  then the code).
- **none** — report "in sync" and **STOP**.

### 5. Path 1 — spec-fix → read-only plan (\`c4s ask\`)

\`c4s ask\` is read-only and forces plan-mode (a peer-consult), so the agent
**always produces a plan** of spec changes and never mutates the spec:

\`\`\`sh
c4s ask "Spec drift on <topic>: <description>. Create a plan of specification \\
changes — list the entities/pages to change and the exact edits. Plan only, do \\
not execute." --project <spec-project>
\`\`\`

**Record the returned \`threadId\`.** This skill does **not** apply the plan — a human
continues the thread (\`c4s ask "..." --thread <threadId>\`, or in the UI).

### 6. Path 2 — code-fix → analysis brief (\`c4s agent --ct chat\` + \`runTransagent\`)

Route a code fix into an **analysis brief** that
[\`c4s-brief-implementer\`](../c4s-brief-implementer/SKILL.md) can implement later.

**Use \`c4s agent --ct chat\`, NOT \`c4s agent --ct brief\`.** Brief-context requires a
**pre-existing minted brief**: \`--ct brief\` calls \`get_brief\`, which returns
\`NOT_FOUND\` for a new slug and aborts. The working route is a \`--ct chat\` turn that
drives the \`runTransagent\` MCP tool, which spawns a hidden child that authors and
**saves the brief itself** into \`.claude4spec/briefs/\`:

\`\`\`sh
c4s agent --ct chat \\
  "Run the brief transagent: call mcp__transagent-tools__runTransagent (load via \\
ToolSearch if deferred) with contextType='brief' and payload.suffix='<brief-slug>'. \\
Do NOT Write the file yourself — drive it through the transagent. Pass this as the \\
message (it must become a self-contained analysis brief with a 'For implementers' \\
section): '<drift description + references to spec entities/pages + exact files to \\
change>'. Report the runTransagent arguments and raw result (threadId + saved brief \\
filename)." --project <spec-project>
\`\`\`

The tool is \`runTransagent(contextType: 'brief'|'chat'|'patch', message, payload?, threadId?)\`.
For \`contextType: 'brief'\` it calls \`briefService.createBrief\` to mint an **analysis
brief** (\`source: analysis\`, \`to_release: null\`) grounded in \`message\`; \`payload\` for
a brief is \`{ fromReleaseName?, suffix?, content? }\`. Only **one** child runs per
\`--ct chat\` turn, so author one brief per call. Record the saved \`briefPath\`.

### 7. Report + STOP

Print and **finish** (no execution):

- the topic and the drift classification (spec-fix / code-fix / both / none),
- the created \`threadId\` (Path 1) and/or \`briefPath\` (Path 2),
- next step: a human continues the spec plan thread;
  \`c4s-brief-implementer\` implements the brief.

## Hard dependency & gotchas

- **Both routing paths require the \`c4s\` CLI AND a running server.** Without a server
  the skill can still read the spec and analyze the code, but it **cannot route the
  fix** (\`c4s ask\` / \`c4s agent\` delegate the turn to the server). The read-only
  \`resolve\` / \`list-*\` / \`single_element\` commands do not need a server.
- **\`--project\`, never \`cd\`:** the spec dir is often a symlink; \`cd\`-ing in resolves
  \`cwd\` to the real path ≠ the registered one → \`PROJECT_NOT_FOUND\`. Always pass the
  registered path with \`--project\`.
- **\`c4s ask\` is read-only** — it yields a plan only and never mutates the spec;
  execution is a separate, human-driven step.
- **Brief authoring = \`--ct chat\` + \`runTransagent\`, NOT \`--ct brief\`.** Telling a
  \`--ct chat\` agent to "just write the brief" makes it \`Write\` a loose \`.md\` in the
  wrong directory (not a registered brief) — always route through \`runTransagent\`.

## Notes

This is a **base skill** generated by claude4spec. The base copy under
\`.claude4spec/skills/\` is refreshed on bootstrap, so copy it into your project's
\`.claude/skills/\` if you want edits that stick (e.g. pinning your project's
\`--project\` path or \`--workspace\`).
`;
