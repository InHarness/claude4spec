import type { SystemPromptContribution } from '@c4s/plugin-runtime';

/**
 * No `mcpToolsLine` — the package contributes no MCP server of its own, so there
 * are no custom tools to announce; everything this type can do is the host's
 * generic `entity-tools` CRUD.
 *
 * No `defaultPredicate` — the count is unfiltered. Every record of this type is
 * a described tool; there is no draft state, no archive and nothing to hide from
 * a list.
 *
 * `narrativeBlock` says the ONE thing no validator can: where the boundary runs.
 * The rest of this type's rules are enforceable (limits, required fields) or are
 * authoring discipline an acceptance criterion owns — neither belongs in a
 * system prompt.
 */
export const mcpToolSystemPrompt: SystemPromptContribution = {
  roleNoun: 'MCP tools',
  /**
   * 0.2.50 — the reference to "the `## Operacje (L3)` row of the owning module"
   * is gone. `L3` is a heading in ONE project's page layout ("Layered Vertical
   * Slices"), and every other installation was being sent to a section that does
   * not exist there. The BOUNDARY it was drawing is real and stays; where the
   * other side of the boundary lives is a project convention, and belongs to the
   * active writing style.
   *
   * Also trimmed: the `logic`-is-never-sent-to-a-model line, which is a fact
   * about the host rather than a decision for the author.
   */
  narrativeBlock:
    'An `mcp-tool` record is the WIRE CONTRACT of one tool and nothing else: `description`, ' +
    '`params[]`, `returns`/`sampleReturn` and the annotation hints transfer verbatim into a tool ' +
    'definition in code. Everything about the OPERATION — canonical name, scope, mediation class, ' +
    'channels, error codes, idempotence — belongs with the owning module, never here. `returns` ' +
    'describes the PAYLOAD, never the `content[]`/`isError` envelope; a refusal condition is one ' +
    'sentence in `logic`, never a table; and an empty annotation hint means the server declares ' +
    'nothing, which is not the same as `false`.',
};
