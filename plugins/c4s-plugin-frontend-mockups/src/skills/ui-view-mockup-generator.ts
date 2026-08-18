import type { PluginSkillContribution } from '@c4s/plugin-runtime';

/**
 * `ui-view-mockup-generator` — the envelope's contribution to `contributes.skills[]`.
 *
 * The FIRST thing this file is evidence of: an envelope contributes more than
 * entity types. The loader fans this into the M37 `SkillRegistry` with
 * `source: 'plugin'`, and it is that marker alone — not an entry in any
 * `attachInternalSkills` table — that makes `resolveForContext` pick it up, in
 * every one of the four context types. It rides `inlineSkills` only; a
 * `<project_skill/>` block belongs to the writing-style slot and this is not
 * one. The model opens it itself, off `description`, via `Skill(<slug>)`.
 *
 * Which is why `description` is load-bearing and not decoration: it is the ONLY
 * thing the model sees before deciding to open the body.
 *
 * The body is carried INLINE rather than as a `SKILL.md` on disk, because a
 * plugin skill is pushed at load time rather than discovered by an FS scan —
 * there is no directory for the registry to find. Authoring markdown as a TS
 * template literal follows the host's own `src/server/external-skills/*-template.ts`.
 *
 * Distribution is the envelope, not the type: `registry.unregisterPlugin` takes
 * this skill down together with `ui-view` and `design-system`. That coupling is
 * the point — a skill teaching how to author a `ui-view` mockup has no subject
 * once `ui-view` is gone. It carries NO activation gate of its own; `config.entities`
 * gates the types, not this.
 */
export const uiViewMockupGeneratorSkill: PluginSkillContribution = {
  slug: 'ui-view-mockup-generator',
  title: 'UI View Mockup Generator',
  description:
    'Generate or update the HTML mockup of a `ui-view` entity from its design system tokens. Use when asked to draft, refresh or clear a screen mockup for a view.',
  version: 1,
  language: 'en',
  scope: 'contextual',
  content: `# UI View Mockup Generator

Author the \`mockupHtml\` of a \`ui-view\` entity: a static HTML sketch of the screen,
built entirely from its design system's tokens.

You need no special tooling for this. This envelope ships no MCP server of its own —
everything below is a generic host entity tool.

## 1. Read, in this order

1. **The view.**
   \`get_entities({ type: 'ui-view', slugs: ['<slug>'] })\`
   The record carries \`title\`, \`url\`, \`params[]\` and \`designSystemSlug\`. It does
   **not** carry \`mockupHtml\`: the field is content-bearing, so no read emits it. You
   get \`hasMockupHtml\` and \`mockupHtmlBytes\` instead — a descriptor, not a value.

2. **The design system**, when the view names one.
   \`get_entities({ type: 'design-system', slugs: ['<designSystemSlug>'] })\`
   This is where the custom property names and the list of \`modes\` come from. Read
   them; never invent them.

3. **The existing mockup**, only when you intend to revise rather than replace it.
   \`get_field_content({ type: 'ui-view', slug: '<slug>', field: 'mockupHtml' })\`
   This is the **only** read channel for the value. The mockup document route
   (\`GET /api/ui-views/:slug/mockup\`) is not one — its subject is a derived document,
   not the field.

4. **Domain context.** \`find_references\` for entities and pages sharing the view's
   tags — endpoints, DTOs, acceptance criteria. This is what makes the mockup show the
   right fields and the right states rather than a generic screen.

## 2. Write a \`<body>\` fragment — not a document

Three hard rules. Each one exists because the mockup route composes the rest.

**A fragment, never a full document.** No \`<!doctype>\`, no \`<html>\`, no \`<head>\`,
no \`<style>\` reset. The route supplies the doctype, the head, a minimal reset and a
stylesheet of the design system's custom properties, then pastes your fragment into
\`<body>\` verbatim. A full document nested inside one is invalid markup.

**Every visual value through a CSS custom property.** \`var(--color-action-primary)\`,
\`var(--space-4)\` — never a literal hex, never a literal px. The tokens come from step
1.2; use the names you read there.

*A view with no \`designSystemSlug\` gets a fragment with no token references at all.*
Plain, unstyled, semantic markup beats guessing the names of a design system that does
not exist.

**Mode variants through one attribute selector**, not through separate fragments:

\`\`\`html
<div class="card">…</div>
<style>
  .card { background: var(--color-surface); }
  [data-preview-mode="dark"] .card { background: var(--color-surface-inverse); }
</style>
\`\`\`

This matches how the \`design-system\` side emits its stylesheet, so a mode switch is a
single attribute flip on the root rather than a different document.

**No state harness.** The document's \`<script>\` slot stays empty. Loading, empty and
error states are not modelled here — they are waiting on a \`states\` field of the
\`ui-component\` entity. Do not simulate them with script.

## 3. Save

\`\`\`
update_entities({ type: 'ui-view', updates: [{ slug: '<slug>', mockupHtml: '<fragment>' }] })
\`\`\`

A partial update of \`mockupHtml\` alone. Omitting the field means "no change";
passing \`null\` clears the mockup — the field is clearable, and that is how you
remove one.

Do **not** write a file to disk, and do **not** call the mockup route. The entity is
the only store; the document is generated from it on request.

## 4. When you cannot save

Two contexts reach this skill without a write path, and both are normal rather than
an error to work around:

- **\`ask\`** — pinned to plan mode. Nothing is written, by design.
- **\`brief\`** — the MCP whitelist does not carry \`entity-tools\` at all, so
  \`update_entities\` is not merely refused, it is absent.

In either case: **describe** the mockup you would write — its structure, the tokens it
would consume, the modes it would carry — and stop. Do not attempt the write, and do
not hunt for another channel to smuggle it through; there is not one.
`,
};
