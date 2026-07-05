import type { ExternalSkillContext } from './types.js';

export const REFACTOR_FRONTMATTER = `---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (a read-only plan via \`c4s ask\`) or to the code (an analysis brief via \`c4s agent --ct chat\` + \`runTransagent\`). Use when reconciling spec with implementation ("check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
---
`;

export function refactorBody(ctx: ExternalSkillContext): string {
  // Quoted: ProjectRecord.name (the slug) is an unvalidated directory basename
  // and can contain spaces/shell metacharacters — unquoted interpolation here
  // would break argv parsing when these example commands are run verbatim.
  const identity = `--project '${ctx.slug}' --workspace '${ctx.workspace}'`;
  return `# c4s-refactor

A **spec↔code drift router**. For a single topic this skill reads the claude4spec
specification, analyzes the matching code, detects **drift**, classifies it, and
routes the fix to the right place. It performs **no edits itself** — it classifies
and hands off:

1. drift that needs a **specification** change → open a read-only planning turn
   (\`c4s ask\`),
2. drift that needs a **code** change → describe it in an **analysis brief**
   (\`c4s agent --ct chat\` driving the \`runTransagent\` brief tool).

Execution is downstream: a human continues the spec plan thread, and the
\`c4s-brief-implementer\` skill implements the brief.

**CLI only — never call \`curl\` or the HTTP API directly.**

This skill is bound to one specification project — every \`c4s\` command below
carries its identity (\`${identity}\`), so it works from any cwd. Do NOT \`cd\`
into the spec repo; the identity is baked in, not derived from cwd.

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

Read the spec through the \`c4s\` reader — see the \`c4s-spec-reader\` skill for the
full command reference. In short:

\`\`\`sh
c4s catalog ${identity}                                   # entity types + schemas
c4s list-tags ${identity}                                 # tags + counts
c4s list-slugs --type endpoint ${identity}                # slugs for a type
c4s single_element --type endpoint --slug <x> ${identity}
c4s resolve modules/<module>.md ${identity}               # expand a page's tags inline
\`\`\`

Manual fallback (when \`c4s\`/the server is unavailable): read markdown pages
directly under \`'${ctx.pagesDirAbs ?? '<pages-dir-abs>'}'\` (absolute — works from
any cwd).

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
not execute." ${identity}
\`\`\`

**Record the returned \`threadId\`.** This skill does **not** apply the plan — a human
continues the thread (\`c4s ask "..." --thread <threadId>\`, or in the UI).

### 6. Path 2 — code-fix → analysis brief (\`c4s agent --ct chat\` + \`runTransagent\`)

Route a code fix into an **analysis brief** that the \`c4s-brief-implementer\` skill
can implement later.

**Use \`c4s agent --ct chat\`, NOT \`c4s agent --ct brief\`.** Brief-context requires a
**pre-existing minted brief**: \`--ct brief\` calls \`get_brief\`, which returns
\`NOT_FOUND\` for a new slug and aborts. The working route is a \`--ct chat\` turn that
drives the \`runTransagent\` MCP tool, which spawns a hidden child that authors and
**saves the brief itself**:

\`\`\`sh
c4s agent --ct chat \\
  "Run the brief transagent: call mcp__transagent-tools__runTransagent (load via \\
ToolSearch if deferred) with contextType='brief' and payload.suffix='<brief-slug>'. \\
Do NOT Write the file yourself — drive it through the transagent. Pass this as the \\
message (it must become a self-contained analysis brief with a 'For implementers' \\
section): '<drift description + references to spec entities/pages + exact files to \\
change>'. Report the runTransagent arguments and raw result (threadId + saved brief \\
filename)." ${identity}
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
- **The identity is baked in — never \`cd\`.** \`${identity}\` is injected into every
  command above; \`cd\`-ing into the spec repo is unnecessary and, if it's reached
  through a symlink, can even break resolution.
- **\`c4s ask\` is read-only** — it yields a plan only and never mutates the spec;
  execution is a separate, human-driven step.
- **Brief authoring = \`--ct chat\` + \`runTransagent\`, NOT \`--ct brief\`.** Telling a
  \`--ct chat\` agent to "just write the brief" makes it \`Write\` a loose \`.md\` in the
  wrong directory (not a registered brief) — always route through \`runTransagent\`.
- **\`PROJECT_SLUG_NOT_FOUND\`** — the injected \`--project '${ctx.slug}'\` no longer
  matches a project in this machine's \`~/.claude4spec/workspaces.json\` (moved,
  deleted, or copied from another machine). Regenerate this skill from the spec
  repo and re-copy it here. \`AMBIGUOUS_WORKSPACE\` / \`AMBIGUOUS_PROJECT\` → pass the
  correct \`--workspace <name>\`.

## Notes

This is a **base skill** generated by claude4spec, delivered on demand via
\`c4s install-skills\` or the Settings page's "External Skills" ZIP download —
nothing regenerates it automatically once it lands in your project's
\`.claude/skills/\`. Edits you make here are yours to keep.
`;
}
