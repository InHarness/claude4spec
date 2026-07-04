import type { ExternalSkillContext } from './types.js';

export const BRIEF_IMPLEMENTER_FRONTMATTER = `---
name: c4s-brief-implementer
description: Implement features described in claude4spec briefs (markdown files in .claude4spec/briefs/). Briefs are self-contained — they include all context needed for implementation (entity snapshots, section diffs, narrative). After implementation, if you discover drift between the brief and reality (missing details, incorrect assumptions, edge cases not covered), generate a patch file in .claude4spec/patches/ as feedback for the specification author. Use when implementing changes in a code repository that has a .claude4spec/briefs/ directory.
---
`;

export function briefImplementerBody(ctx: ExternalSkillContext): string {
  const identity = `--project ${ctx.slug} --workspace ${ctx.workspace}`;
  return `# c4s-brief-implementer

This skill describes how to implement a release brief in **your code repository**
(not the spec repo). A brief is a self-contained markdown file in the spec
project's \`briefsDir\` that captures everything you need to ship the change:
entity snapshots, section diffs, narrative, acceptance criteria.

This skill is bound to one specification project — every \`c4s\` invocation below
carries its identity (\`${identity}\`), so it works from any cwd, including a
foreign code repo where \`.claude4spec/\` doesn't exist. Do NOT \`cd\` into the
spec repo; the identity is baked in, not derived from cwd.

**This skill prefers the \`c4s\` CLI but has a filesystem fallback** — briefs are
self-contained, so the core loop (read brief → implement → file a patch) works
even without \`c4s\` installed, via the absolute fallback paths below.

## Workflow

### 1. Discover

\`\`\`sh
c4s list-briefs --status pending --limit 10 ${identity}
\`\`\`

Fallback (no \`c4s\`): \`ls ${ctx.briefsDirAbs}\`.

When there are multiple \`pending\` candidates and it isn't obvious which one to
implement — **ask the user, don't guess.** Only proceed automatically when
exactly one obvious candidate exists.

### 2. Read the brief as self-contained input

\`\`\`sh
c4s read-brief <brief-path> ${identity}
\`\`\`

Fallback: \`cat ${ctx.briefsDirAbs}/<brief-path>\`.

Every brief has YAML frontmatter:

\`\`\`yaml
---
type: brief
from_release: v0.1.16
to_release: v0.1.17
generator_version: brief-author@0.1
implemented: false
---
\`\`\`

The body contains everything you need — entity snapshots, section diffs, the
narrative of what changes, and acceptance criteria. **Do not read the main
specification.**

If the brief is unclear — a missing detail, an ambiguous wording, a decision
you'd otherwise have to guess — you have two paths:

**Synchronous (preferred when available).** Ask the specification agent in the
same terminal and continue once you have an answer:

\`\`\`bash
c4s ask "Brief nie precyzuje X — czy chodzi o A czy B?" --ct brief --brief <brief-path> ${identity}
\`\`\`

Continue the same thread with \`c4s ask "..." --thread <threadId>\` (the
\`threadId\` is printed with the answer). This path requires \`c4s\` installed
*and* a running \`npx @inharness-ai/claude4spec\` server. When either is unavailable, skip it.

**Asynchronous (always available).** If you cannot ask synchronously, proceed
with your best judgement and file a patch afterwards (step 4) so the
spec-author can fold the clarification into the next brief.

### 3. Implement

Standard code flow in your target repository: read existing code, plan, edit,
test. Stay focused on what the brief specifies.

### 4. Feedback loop (patches)

When you discover that the brief diverges from reality — a missing detail, an
incorrect assumption, an edge case not covered, or anything else the
spec-author should know — file a patch:

\`\`\`sh
printf '%s\\n' "$PATCH_BODY" | c4s file-patch \\
  --brief <brief-path> --desc "<short-desc>" --kind drift \\
  ${identity}
\`\`\`

Fallback (no \`c4s\`): \`mkdir -p ${ctx.patchesDirAbs}\` then write
\`${ctx.patchesDirAbs}/<brief-slug>-<short-desc>.md\` by hand with this format:

\`\`\`markdown
---
type: patch
brief: v0-1-16-to-v0-1-17.md      # path relative to briefsDir
patch_kind: drift                  # drift | missing | incorrect | clarification
created_at: 2026-05-11T17:32:00Z
created_by: claude-code            # or "cursor", "aider", ...
status: awaiting                   # awaiting spec-author review
---

# Patch — short title

## What I found

…description of the drift / missing detail / incorrect assumption…

## Suggestion

…what the spec-author should consider in a follow-up brief or entity edits…
\`\`\`

Patch-kind values:

- \`drift\` — the brief described behavior X, but the codebase already does Y.
- \`missing\` — the brief is silent on a detail you had to decide yourself.
- \`incorrect\` — the brief is factually wrong about existing code.
- \`clarification\` — the brief is ambiguous; you guessed but it should be made
  explicit for next time.

The patches directory is created **lazily** — only when you file your first
patch (\`c4s file-patch\` mkdir's it itself; the fallback needs an explicit
\`mkdir -p\`). The claude4spec server does NOT create it upfront.

### 5. Mark brief as implemented

When the implementation is genuinely finished — code committed, tests green,
merged to main / accepted by the user — flip the brief's frontmatter to
\`implemented: true\`. There is no \`c4s\` command for this — it's a direct file
edit in the spec repo's briefsDir:

\`\`\`bash
yq -i '.implemented = true' ${ctx.briefsDirAbs}/<brief-path>
\`\`\`

\`implemented: true\` is a **declaration**, not a computed fact derived from git.
A revert on main does NOT roll the flag back. Set it ONLY when implementation
is realistically done — never proactively or "just in case".

### 6. Hand-off

The spec-author reads patches manually (\`ls ${ctx.patchesDirAbs}\`, \`cat\`)
and folds them into the next brief or entity edits. There is no UI listing in
this release — patches are raw markdown.

## Errors

If any \`c4s\` command above returns \`PROJECT_SLUG_NOT_FOUND\`, the \`--project
${ctx.slug}\` baked into this skill no longer matches a project in this
machine's \`~/.claude4spec/workspaces.json\` (moved, deleted, or this skill was
copied from a different machine). Regenerate this skill from the spec repo
(\`npx @inharness-ai/claude4spec\`) and re-copy it here. \`AMBIGUOUS_WORKSPACE\` /
\`AMBIGUOUS_PROJECT\` → pass the correct \`--workspace <name>\`.

## Notes

This is a **base skill** generated by claude4spec. It already covers what you
need to discover, read, and patch briefs. Feel free to **adapt it to your own
workflow** (e.g. add a git/PR flow) or use it as-is — this base copy under
\`.claude4spec/skills/\` is refreshed on server start, so copy it into your
project's \`.claude/skills/\` if you want edits that stick.
`;
}
