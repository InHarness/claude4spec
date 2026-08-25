import type { PluginSkillContribution } from '@c4s/plugin-runtime';

/**
 * `research.md` — the "what belongs on the screen" layer, kept OUT of the body.
 *
 * It is a sub-file rather than a fifth section because it is only needed before
 * drawing a NEW mockup; a one-element revision of an existing one pays nothing
 * for it. `Skill(<slug>)` hands the model the `files` manifest with the byte and
 * line cost, so the decision to fetch is an informed one.
 */
const RESEARCH_MD = `# What belongs on the screen

A mockup is not a drawing exercise: it FOLLOWS from the specification. Before you write a single
element of the fragment, answer three questions — and answer each from a NAMED SOURCE, never from
what a screen of this kind usually carries.

## Which types can even contribute?

Read the \`<entities>\` block in your system prompt. It carries one row per entity type this project
actually has, with the narrative of what each is for. That IS the roster; it needs no discovery.
Pick the types whose records carry field shapes, columns, signatures or criteria, and reach for
\`describe_entity_type\` only on those, and only for what the narrative did not say
(\`searchableFields\`, default filters, \`contentFields\`). Never wholesale.

Exactly two types are guaranteed: \`ui-view\` and \`design-system\` — they arrive and leave with this
skill. Everything else is conditional. One project keeps its contracts in \`endpoint\` + \`dto\`,
another in a single \`api\` type of its own, another in no type at all with all the knowledge in
prose. Names like \`endpoint\`, \`dto\`, \`database-table\` or \`ac\` are examples of a typical layout in
what follows — never types you may assume are there.

## DATA — what feeds this screen?

Every visible field needs a named source. Find the entities that share the view's tags with
\`list_entities({ type: '<type>', tags: [...], tagFilter: 'or' })\`, one call per type you chose
above; find them by name with \`search_entities\`, which takes ONE type per call. Read \`params[]\` for
the split that shapes the whole screen: what is known up front, and what the screen has to fetch.
A field you cannot trace to a record or a sentence does not get invented — it gets left out.

## LOOK — how should it look, and what must it be consistent with?

The design system from step 1.2 is only half of it; the other half is the SIBLINGS. Ask
\`list_entities({ type: 'ui-view', filters: { designSystemSlug: '<slug>' } })\` for the views sharing
this design system, and for the closest of them read
\`get_field_content({ type: 'ui-view', slug: '<sibling>', field: 'mockupHtml' })\`. Inherit their
shell, their navigation and their terminology instead of inventing a second vocabulary for the same
product. The user journey is not an entity anywhere — neighbouring views are its only record.
The presentation paradigm and the requirements on copy live in prose: read them, never assume, and
in particular never assume mobile.

## BEHAVIOUR — what happens on it?

\`states[]\` with the \`description\` of each entry — the schema is explicit that this is
"specification content, not a hint for the mockup generator", so it is evidence, not a brief
addressed to you. Then \`ui-view.description\`, then the prose. If the project has a type binding
criteria to entities, that bond is ENTITY DATA rather than a document edge, so \`find_references\`
will not return it; the route there is \`search_entities\` by the view's slug.

## Channels that hold whatever the type roster looks like

\`search_pages\` with \`mode: 'map'\` to find the prose, then collect the \`anchor\`s and spend ONE
\`get_sections\` on all of them. \`find_references({ target: 'entity', type: 'ui-view', slug })\` for
the pages citing the view — it takes no tags, and entities by tag are \`list_entities\`'s job.
\`resolve_identity\` when you do not yet know which type a name lives in.

Sweeping many pages or many types is worth handing to the \`spec-explore\` subagent, one per
question, in parallel — but that is your call, not a rule. What is mandatory is going through the
three questions; whose hands do the reading is not.
`;

/**
 * `principles.md` — the four rules, kept out of the body for the same reason,
 * but on a different schedule: they are read before drawing AND before saving.
 */
const PRINCIPLES_MD = `# Binding rules

Four rules, binding for every mockup this skill produces — and binding on YOU. A subagent you
delegate to cannot read this file: it has no access to this package. It may locate things for you;
it never decides what goes on the screen.

1. **Invent values, never features.** A concrete value for a field the specification HAS — a name,
   an amount, a date — yes, and you should: a screen of empty labels is not a mockup. A field,
   column, widget, badge, metric, filter or concept the specification does NOT have — no, however
   natural it looks on a screen of this kind. An element with no named source does not reach the
   screen. WHEN IN DOUBT, OMIT.

2. **Production fidelity.** The screen must look like a shipped product rather than a sketch of
   one: no lorem, no placeholders, no "sample" or "demo" captions, no annotations addressed to a
   developer. Realistic means CONCRETE, not embellished — and the fidelity is owed to the product
   AS THE SPECIFICATION DEFINES IT, never to the genre of application it happens to resemble.

3. **Sample data is coherent.** One set of invented records serves the whole fragment: a counter
   agrees with the number of rows beneath it, the same record is named identically in every state,
   an \`empty\` state matches the filter the default state is showing, and the naming agrees with the
   sibling mockups you read. Incoherent data reads as a bug in the product, not as a rough edge in
   the mockup.

4. **States are opt-in and spec-driven.** \`states[]\` is the view's declaration, not a wish list you
   may extend — do not add a loading view merely because the screen fetches something. If you have
   a PROPOSAL (one more state, a missing column, better copy), ASK THE USER AND STOP UNTIL THEY
   ANSWER; it enters neither the fragment nor \`states[]\` before it is confirmed. The channel is
   open in every context: \`AskUserQuestion\` is an ungated built-in, so plan mode in \`ask\` does not
   take it away.

**A proposal and a discrepancy leave by different doors.** A PROPOSAL is yours — something you
would add — so it goes to the user as a question and waits. A DISCREPANCY is the specification's —
a contradiction between two entities, a reference pointing at nothing, a state no field can carry —
so you REPORT it in your answer. Neither one gets patched over quietly in the fragment.
`;

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
 *
 * WHY IT IS A PACKAGE AND NOT ONE BODY. The body is mechanics — the shape of the
 * output. `research.md` and `principles.md` are the layer before it: what belongs
 * on the screen, and how the agent knows. They are sub-files because their cost is
 * only worth paying before a NEW mockup, and because `files` gives the model the
 * byte cost up front (`skill-tools.ts` returns the manifest when the skill opens).
 *
 * And the split has a HARD constraint that must survive later tidying: THE RULES
 * BIND THE PARENT; THE SUBAGENT ONLY LOCATES. `spec-explore` carries `Read`/`Grep`/
 * `Glob` plus read-only MCP and NO skill tools, and these files live in the registry
 * rather than on disk — so a subagent cannot be handed them, and delegating the
 * JUDGEMENT of what belongs on the screen would delegate it to something that never
 * read the rules. This is the same stance as the host's own `<delegation_policy/>`.
 * Folding the sub-files back into the body would not fix it; it would only make the
 * always-on context pay for a layer most turns do not need.
 */
export const uiViewMockupGeneratorSkill: PluginSkillContribution = {
  slug: 'ui-view-mockup-generator',
  title: 'UI View Mockup Generator',
  description:
    'Author the HTML mockup of a `ui-view` entity: research what belongs on the screen from the specification, then emit a fragment built from its design system tokens. Use when asked to draft, refresh or clear a screen mockup for a view.',
  version: 2,
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
   \`list_entities({ type: '<type>', tags: [...], tagFilter: 'or' })\` — repeated per
   type that can contribute — finds the entities that share the view's tags.
   \`find_references({ target: 'entity', type: 'ui-view', slug })\`
   finds the spec pages that cite the view itself. \`find_references\` takes no tags and
   requires the \`target\` discriminator; calling it without one is an error.

   **This package carries two more files, and you open them yourself.**
   \`research.md\` turns those channels into answers: three questions (what feeds this
   screen, how it must look and what it must be consistent with, what happens on it),
   which entity types can contribute at all in THIS project, and when a sweep is worth
   delegating. Read it before drawing a NEW mockup; a small revision of an existing one
   can skip it. \`principles.md\` carries four binding rules about what may reach the
   screen — read it before drawing **and** again before saving.

   **The rule that holds even if you open neither: invent VALUES, never FEATURES.** A
   concrete value for a field the specification has, yes; a field, widget, badge or metric
   it does not have, no. An element with no named source does not go on the screen.

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

Three things to confirm before you send anything. Every entry in \`states[]\` produces a
difference you can actually SEE in the fragment. Every mode the design system declares
still renders. Nothing on the screen lacks a named source in the specification.

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

They differ in one further way, and it decides how much you can say. A \`brief\` thread
gets the \`diff-explore\` subagent, which sees NEITHER the entity graph NOR the pages at
HEAD — the research in \`research.md\` cannot be carried out there at all, and your
description rests on the brief's own content. In \`ask\` it is the reverse: \`spec-explore\`
is present, the research proceeds exactly as described, and only the write is closed.
`,
  files: {
    'research.md': RESEARCH_MD,
    'principles.md': PRINCIPLES_MD,
  },
};
