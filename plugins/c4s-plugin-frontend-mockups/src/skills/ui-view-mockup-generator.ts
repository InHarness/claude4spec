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
   The record carries \`title\`, \`url\`, \`params[]\`, \`states[]\` and \`designSystemSlug\`. It
   does **not** carry \`mockupHtml\`: the field is content-bearing, so no read emits it. You
   get \`hasMockupHtml\` and \`mockupHtmlBytes\` instead — a descriptor, not a value.

   \`states[]\` is the view's **domain declaration of its alternative screen states**, not a
   wish list addressed to you, and it carries **no entry for the default state**. Treat it
   the way you treat \`url\` and \`params[]\`: a fact about the screen you are drawing.

2. **The design system**, when the view names one.
   \`get_entities({ type: 'design-system', slugs: ['<designSystemSlug>'] })\`
   The record carries token **names**, **types**, the \`value\` shape of each composite
   token and the list of \`modes\`. It does **not** carry custom property names — those
   exist only in the sheet the route generates. So you **derive** them, by the rule in
   step 2; never invent them, and never go looking for them in the record.

3. **The existing mockup**, only when you intend to revise rather than replace it.
   \`get_field_content({ type: 'ui-view', slug: '<slug>', field: 'mockupHtml' })\`
   This is the **only** read channel for the value. The mockup document route
   (\`GET /api/ui-views/:slug/mockup\`) is not one — its subject is a derived document,
   not the field.

4. **Domain context**, so the mockup shows the right fields rather than a generic
   screen. Two different tools, and they answer two different questions:
   \`list_entities({ type: 'endpoint', tags: [...], tagFilter: 'or' })\` — repeated per
   type you care about (\`endpoint\`, \`dto\`, \`ac\`) — finds the entities that share
   the view's tags. \`find_references({ target: 'entity', type: 'ui-view', slug })\`
   finds the spec pages that cite the view itself. \`find_references\` takes no tags and
   requires the \`target\` discriminator; calling it without one is an error.

## 2. Write a \`<body>\` fragment — not a document

Three hard rules. Each one exists because the mockup route composes the rest.

**A fragment, never a full document.** No \`<!doctype>\`, no \`<html>\`, no \`<head>\`,
no \`<style>\` reset. The route supplies the doctype, the head, a minimal reset and a
stylesheet of the design system's custom properties, then pastes your fragment into
\`<body>\` verbatim. A full document nested inside one is invalid markup.

**Every visual value through a CSS custom property.** \`var(--color-action-primary)\`,
\`var(--space-4)\` — never a literal hex, never a literal px.

**DERIVE the property name from the token; do not look it up.** The design system record
read in step 1.2 gives you token names and, for a composite token, the keys of its
\`value\` object. The sheet's names follow from those by one rule, with no prefixing and
no rewriting of any kind:

- a **scalar** token \`space-4\` → \`var(--space-4)\`;
- a **composite** token (\`typography\`, \`shadow\`) is flattened **one property per
  field**, \`--<token>-<fieldKey>\`, the field key **verbatim** — camelCase and all.

So a \`typography\` token \`heading-1\` is consumed field by field:

\`\`\`css
font-size: var(--heading-1-fontSize);
line-height: var(--heading-1-lineHeight);
\`\`\`

Never \`var(--heading-1)\` and never \`var(--heading-1-font-size)\`. The generator has no
per-type knowledge, so it composes **no** shorthand: there is no single
\`var(--shadow-card)\` to reach for — you assemble it yourself from the fields. A
\`var()\` naming a property that was never emitted fails in silence, which is why the
rule is worth getting exactly right rather than approximately.

*A view with no \`designSystemSlug\` gets a fragment with no token references at all.*
Plain, unstyled, semantic markup beats guessing the names of a design system that does
not exist.

**Mode variants usually need nothing from you.** A mode does not restyle elements — it
**redefines the tokens**, which the route emits as \`[data-preview-mode="dark"] { --color-surface: … }\`.
A fragment that already reads every value through \`var(--…)\` therefore switches modes
for free; that is the second reason for the rule above.

Reach for \`[data-preview-mode="<name>"]\` yourself only when a mode has to change
something no token value can carry — a raised card that goes flat in dark, say — and
write it as one selector in the fragment rather than as a second fragment:

\`\`\`html
<div class="card">…</div>
<style>
  .card {
    background: var(--color-surface);
    /* \`shadow-raised\` is a composite token: composed per field, because the sheet
       holds no single collective property for it. */
    box-shadow: var(--shadow-raised-offsetX) var(--shadow-raised-offsetY)
                var(--shadow-raised-blur) var(--shadow-raised-spread)
                var(--shadow-raised-color);
  }
  [data-preview-mode="dark"] .card { box-shadow: none; }
</style>
\`\`\`

**States through an attribute selector, never through script.** The variant selector is
\`[data-preview-state="<name>"]\`, which the mockup route sets on \`<html>\` from the
\`?state=\` query param — there is no \`<script>\` slot any more, and no harness is coming.
ONE fragment covers every state the view declares in \`states[]\`. Blocks for alternative
states live **in the DOM beside the default content** and are switched off by an ancestor
selector; that is the sanctioned pattern here, not the hidden-sibling smell it resembles:

\`\`\`html
<main class="results">…</main>
<p class="empty">No results match this filter.</p>
<style>
  .empty { display: none; }
  [data-preview-state="empty"] .results { display: none; }
  [data-preview-state="empty"] .empty  { display: block; }
</style>
\`\`\`

**The default state must render a complete screen.** The fragment with no
\`data-preview-*\` attribute in play is a whole, sensible view on its own. Alternative
states are an OVERRIDE of it — never a precondition for it rendering correctly.

**Mode is one click away, so every mode has to work.** The reviewer picks the mode in the
preview's variant box now; the author no longer hard-codes it in a wrapper. Your fragment
has to look right in **every** mode the design system declares, not just in the one you
had in mind.

## 3. Save

\`\`\`
update_entities({ type: 'ui-view', updates: [{ slug: '<slug>', data: {
  states: [{ name: 'empty', label: 'Empty', description: 'No results after filtering.' }],
  mockupHtml: '<fragment>',
} }] })
\`\`\`

**\`states[]\` and \`mockupHtml\` go in ONE call.** Splitting them across two would leave the
entity inconsistent in between — a mockup illustrating a state the view does not declare,
or a declared state nothing illustrates. Send \`states\` only when you are changing it;
omitting it leaves it alone, and \`[]\` is a value (no states declared), not a clear.

A partial update. The fields go **inside \`data\`** — a key
placed beside \`slug\` is not an update, it is dropped. Omitting the field means "no
change"; \`data: { mockupHtml: null }\` clears the mockup — the field is clearable, and
that is how you remove one.

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
