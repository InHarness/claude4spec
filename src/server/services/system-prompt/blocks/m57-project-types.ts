import { DEFAULT_PROJECT_TYPE } from '../../../config.js';
import { hostProjectTypeRegistry } from '../../../project-types/registry.js';
import type { PromptBlock } from '../types.js';

/*
 * M57 — Project Types (L16 `7ngvgv5z`): `<project_type>`, template
 * `szablon-project-type`. Its body is the prompt description of the current
 * project's type entry (L20 "Opis do promptu", `opis-typu-*-do-promptu`),
 * inserted verbatim: the text is fixed per type — no insertion from the
 * project's data, and no repetition of the slug, which `<project type="…">`
 * already carries.
 */

/** The rendered block for a type slug, or `null` when no entry carries it. */
export function buildProjectTypeBlock(projectType: string): string | null {
  const entry = hostProjectTypeRegistry().get(projectType);
  if (!entry) return null;
  return `<project_type>\n${entry.promptDescription}\n</project_type>`;
}

export const M57_PROMPT_BLOCKS: readonly PromptBlock[] = [
  {
    name: 'project_type',
    /**
     * Emission: always. Every project has a type — explicit or the default — and
     * a project whose type the current version does not know is never activated,
     * so no thread composes a prompt for it; the `null` branch is unreachable
     * from a live context.
     */
    render: (c) => buildProjectTypeBlock(c.projectType ?? DEFAULT_PROJECT_TYPE),
  },
];
