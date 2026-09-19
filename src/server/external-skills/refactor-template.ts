import type { ExternalSkillContext } from './types.js';
import { SERVER_REQUIRED_BLOCK } from './server-required.js';

export const REFACTOR_FRONTMATTER = `---
name: c4s-refactor
description: Detect drift between the claude4spec specification and the code for a given topic, then route the fix — to the spec (a read-only plan via \`c4s ask\`) or to the code (a brief against the current state via \`c4s create-brief\`). Use when reconciling spec with implementation ("check spec vs code for X", "reconcile topic Y"). Optional argument — the topic/scope (module, entity, slug, tag).
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
2. drift that needs a **code** change → describe it in a **brief against the
   current state** (\`c4s create-brief\`).

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
c4s list-tags --with-counts ${identity}                   # tags + counts (counts are opt-in)
c4s list-entities --type endpoint ${identity}             # { slug, title } rows for a type
c4s single_element --type endpoint --slug <x> ${identity}
c4s resolve modules/<module>.md ${identity}               # expand a page's tags inline
\`\`\`

**CLI-only — no filesystem fallback.** If \`c4s\` isn't installed, STOP and ask
the user to install it; never read the spec repo's pages directly.

## Process

### 1. Establish the topic

Confirm the scope and gather vocabulary (\`c4s list-entities\`, \`c4s list-tags\`,
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

### 6. Path 2 — code → brief (\`c4s create-brief\`)

Route a code fix into a **brief against the current state** that the
\`c4s-brief-implementer\` skill implements later. You write the body yourself;
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

\`\`\`sh
c4s create-brief --body-file /tmp/drift-<topic>.md ${identity}
\`\`\`

It prints \`briefPath\` (and the brief's \`hash\`). Passing no release window is
what makes this a brief **against the current state**: the window's \`to\` end
stays open, so there is no second release to diff against.

Hard rules for this path:

- **\`--body-file\`, never an inline body.** Multi-line markdown full of
  backticks does not survive a shell.
- **Path 2 calls \`c4s agent\` in no mode** — not create, not attach. A turn in a
  \`brief\` thread operates on \`release_diff\` alone: it sees neither the current
  specification nor the code, so it may legitimately refuse to write anything,
  and the caller is handed exit 0 and a brief containing only a heading. Feeding
  it the context you already hold does not improve the result, it only adds a
  point of failure. \`c4s create-patch\` is the precedent for the shape: it, too,
  takes the caller's intent rather than a turn's output.
- **\`VALIDATION\` from \`c4s create-brief\` is usually the body file:** it was
  empty, or whitespace only. It also fires when the project has **no releases at
  all** — a window needs an end, and there is none to resolve — which no rewrite
  of the body will fix; cut a release first.

### 7. Report + STOP

Print and **finish** (no execution):

- the topic and the drift classification (spec-fix / code-fix / both / none),
- the created \`threadId\` (Path 1) and/or the \`briefPath\` returned by
  \`c4s create-brief\` (Path 2),
- next step: a human continues the spec plan thread;
  \`c4s-brief-implementer\` implements the brief.

${SERVER_REQUIRED_BLOCK}

Reading the spec and analyzing the code are not an exception to it: \`resolve\`, the \`list-*\` readers and \`single_element\` delegate to the server exactly as \`c4s ask\` / \`c4s agent\` do. With the server down this skill cannot detect drift, let alone route it.

## Hard dependency & gotchas

- **The identity is baked in — never \`cd\`.** \`${identity}\` is injected into every
  command above; \`cd\`-ing into the spec repo is unnecessary and, if it's reached
  through a symlink, can even break resolution.
- **\`c4s ask\` is read-only** — it yields a plan only and never mutates the spec;
  execution is a separate, human-driven step.
- **Path 2 mints the brief itself; it starts no turn.** \`c4s create-brief\`
  writes the body you hand it and nothing else. The older route, which minted
  the file and then asked a brief-scoped turn to fill it, is not an alternative
  here: such a turn sees only \`release_diff\`, so it can legitimately decline and
  leave you a heading.

## Notes

This is a **base skill** generated by claude4spec, delivered on demand via
\`c4s install-skills\` or the Settings page's "External Skills" ZIP download —
nothing regenerates it automatically once it lands in your project's
\`.claude/skills/\`. Edits you make here are yours to keep.
`;
}
