/**
 * 2.1.77 — the `Project Type (L20)` entries of the type modules, registered
 * statically in host code (M57 `5j5aunoy`). The order of
 * {@link HOST_PROJECT_TYPE_ENTRIES} is the registry order and the order of the
 * type cards on the create-project page.
 *
 * Types are added by host code only — plugins contribute no entries (M57 `ngwtfpdd`).
 */
import type { ProjectTypeEntry } from './registry.js';

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

/** M58 — Project Type: Specification. Also the type of every project that wrote none. */
export const SPEC_PROJECT_TYPE: ProjectTypeEntry = {
  slug: 'spec',
  name: 'Specification',
  description:
    'Describe a system in pages and structured entities, release changes and hand them over to implementation as briefs.',
  promptDescription: SPEC_PROMPT_DESCRIPTION,
  capabilities: ['entities', 'briefs', 'multi-root'],
  // M58 `7yg36c76`: `— brak` — the onboarding is the common steps only.
  onboarding: null,
  starterContent: {
    path: 'index.md',
    template: SPEC_WELCOME_TEMPLATE,
    // "Klucze wskazujące na stronę startową: brak."
    entryKeys: [],
  },
};

/**
 * M59 — Project Type: Skill. Its onboarding (the skill-details step and its
 * keys) and its entry-page template are filled by the onboarding-wizard unit
 * (`szablon-strony-wejscia-skilla`); here the seams stay empty.
 */
export const SKILL_PROJECT_TYPE: ProjectTypeEntry = {
  slug: 'skill',
  name: 'Skill',
  description: 'Write one package of instructions for agents and expose it to the other projects of this workspace.',
  promptDescription: SKILL_PROMPT_DESCRIPTION,
  capabilities: ['skill-exposure'],
  onboarding: null,
  starterContent: null,
};

/**
 * M60 — Project Type: Writing Style. Onboarding and entry-page template: as for
 * {@link SKILL_PROJECT_TYPE}, seams filled by the onboarding-wizard unit.
 */
export const WRITING_STYLE_PROJECT_TYPE: ProjectTypeEntry = {
  slug: 'writing-style',
  name: 'Writing Style',
  description: 'Write a writing style that other projects of this workspace can select for their agent.',
  promptDescription: WRITING_STYLE_PROMPT_DESCRIPTION,
  capabilities: ['skill-exposure'],
  onboarding: null,
  starterContent: null,
};

/** The host's entries, in registration (= registry) order. */
export const HOST_PROJECT_TYPE_ENTRIES: readonly ProjectTypeEntry[] = [
  SPEC_PROJECT_TYPE,
  SKILL_PROJECT_TYPE,
  WRITING_STYLE_PROJECT_TYPE,
];
