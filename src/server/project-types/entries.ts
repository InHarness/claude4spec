/**
 * 2.1.77 — the `Project Type (L20)` entries of the type modules, registered
 * statically in host code (M57 `5j5aunoy`). The order of
 * {@link HOST_PROJECT_TYPE_ENTRIES} is the registry order and the order of the
 * type cards on the create-project page.
 *
 * Types are added by host code only — plugins contribute no entries (M57 `ngwtfpdd`).
 */
import type { ProjectTypeEntry } from './registry.js';
import { PROJECT_TYPE_ONBOARDING } from '../../shared/onboarding-steps.js';

/** M58 `zs0xo5cw` — code-snippet `opis-typu-spec-do-promptu`, verbatim. */
export const SPEC_PROMPT_DESCRIPTION =
  'This project is a Specification: it describes a system in markdown pages and structured entities, so that people and agents can build and change that system from one source of truth. Pages carry the prose; entities carry the shapes that other pages reference. Changes to the specification are released, and briefs hand a released change over to implementation.';

/** M59 `2qss50k7` — code-snippet `opis-typu-skill-do-promptu`, verbatim. */
export const SKILL_PROMPT_DESCRIPTION =
  'This project is a Skill: its pages are, as a whole, one package of instructions for agents, exposed to the other projects of the workspace. The entry page is what an agent reads first when the skill is loaded; every other page is a subfile of the package that the entry page may point to. Write each page for the agent that will follow it, not for a human reader of a specification. The project has no entities and no briefs.';

/** M60 `yroe6cwl` — code-snippet `opis-typu-writing-style-do-promptu`, verbatim. */
export const WRITING_STYLE_PROMPT_DESCRIPTION =
  "This project is a Writing Style: its pages are, as a whole, one writing style that other projects of the workspace can select as binding on everything their agent writes. The entry page is what an agent reads first when the style is active; every other page is a subfile of the style — a workflow, a template, a checklist — that the entry page routes to. Write each page as a rule an agent will follow in someone else's specification. The project has no entities and no briefs.";

/**
 * M58 `14wn8bnf` — code-snippet `welcome-template-index` (`pages/index.md`),
 * verbatim: the Specification's starter page. No placeholders.
 */
export const SPEC_WELCOME_TEMPLATE = `---
title: "Welcome"
order: 0
---

# Welcome to your specification

Start by creating pages in the sidebar, or use the chat to generate content with AI assistance.

## Quick start

1. Create pages in **Pages** sidebar
2. Define entities (Endpoints, DTOs) in **Entities** sidebar
3. Reference entities in pages using slash commands (\`/mention\`, \`/element\`)
4. Use **Chat** to get AI help writing your specification
`;

/**
 * M59 `4dvcvsa7` — code-snippet `szablon-strony-wejscia-skilla` (`pages/index.md`),
 * verbatim. Placeholders `{skill.name}`, `{skill.description}` (type keys).
 */
export const SKILL_ENTRY_TEMPLATE = `---
title: "{skill.name}"
order: 0
---

# {skill.name}

{skill.description}

This page is the entry of the skill: an agent that loads \`{skill.name}\` reads it first.

## When to use

Describe the situations in which an agent should load this skill.

## Procedure

1. Write the steps the agent follows.
2. Point to subpages for longer parts — every other page of this project is a file of the skill package.

## Files

List the subpages the procedure points to.
`;

/**
 * M60 `zw3gpb7p` — code-snippet `szablon-strony-wejscia-stylu` (`pages/index.md`),
 * verbatim. Placeholders `{skill.name}`, `{skill.description}` (type keys).
 */
export const WRITING_STYLE_ENTRY_TEMPLATE = `---
title: "{skill.name}"
order: 0
---

# {skill.name}

{skill.description}

This page is the entry of the writing style: a project that selects \`{skill.name}\` binds its agent to it, and the agent reads this page before its first write.

## Conventions

State the rules every page written in this style follows.

## Route

| The task | Workflow |
| --- | --- |
| describe the kind of task | point to the subpage that carries its rules |

## Files

List the workflows, templates and checklists the route points to.
`;

/** M58 — Project Type: Specification. Also the type of every project that wrote none. */
export const SPEC_PROJECT_TYPE: ProjectTypeEntry = {
  slug: 'spec',
  name: 'Specification',
  description:
    'Describe a system in pages and structured entities, release changes and hand them over to implementation as briefs.',
  promptDescription: SPEC_PROMPT_DESCRIPTION,
  capabilities: ['entities', 'briefs', 'multi-root'],
  // M58 `7yg36c76`: `— brak` — the onboarding is the common steps only.
  onboarding: PROJECT_TYPE_ONBOARDING.spec ?? null,
  starterContent: {
    path: 'index.md',
    template: SPEC_WELCOME_TEMPLATE,
    // "Klucze wskazujące na stronę startową: brak."
    entryKeys: [],
  },
};

/**
 * M59 — Project Type: Skill. Onboarding (`wt5a7bbe`): the `Skill details` step
 * after `Project name`, writing `skill.name` and `skill.description`. Starter
 * content (`4dvcvsa7`): the skill's entry page; `skill.entry` points at it.
 */
export const SKILL_PROJECT_TYPE: ProjectTypeEntry = {
  slug: 'skill',
  name: 'Skill',
  description: 'Write one package of instructions for agents and expose it to the other projects of this workspace.',
  promptDescription: SKILL_PROMPT_DESCRIPTION,
  capabilities: ['skill-exposure'],
  onboarding: PROJECT_TYPE_ONBOARDING.skill ?? null,
  starterContent: {
    path: 'index.md',
    template: SKILL_ENTRY_TEMPLATE,
    // "Klucze wskazujące na stronę startową: `skill.entry`."
    entryKeys: ['skill.entry'],
  },
};

/**
 * M60 — Project Type: Writing Style. Onboarding (`usl75l6i`): the `Style details`
 * step after `Project name`, writing `skill.name` and `skill.description`.
 * Starter content (`zw3gpb7p`): the style's entry page; `skill.entry` points at it.
 */
export const WRITING_STYLE_PROJECT_TYPE: ProjectTypeEntry = {
  slug: 'writing-style',
  name: 'Writing Style',
  description: 'Write a writing style that other projects of this workspace can select for their agent.',
  promptDescription: WRITING_STYLE_PROMPT_DESCRIPTION,
  capabilities: ['skill-exposure'],
  onboarding: PROJECT_TYPE_ONBOARDING['writing-style'] ?? null,
  starterContent: {
    path: 'index.md',
    template: WRITING_STYLE_ENTRY_TEMPLATE,
    // "Klucze wskazujące na stronę startową: `skill.entry`."
    entryKeys: ['skill.entry'],
  },
};

/** The host's entries, in registration (= registry) order. */
export const HOST_PROJECT_TYPE_ENTRIES: readonly ProjectTypeEntry[] = [
  SPEC_PROJECT_TYPE,
  SKILL_PROJECT_TYPE,
  WRITING_STYLE_PROJECT_TYPE,
];
