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
  narrativeBlock:
    'An `mcp-tool` record is the WIRE CONTRACT of one tool and nothing else: `description`, ' +
    '`params[]`, `returns`/`sampleReturn` and the four annotation hints transfer verbatim into ' +
    'a tool definition in code. Everything about the OPERATION — canonical name, scope, mediation ' +
    'class, channels, error codes, idempotence — belongs to the `## Operacje (L3)` row of the ' +
    'owning module, never here; the protocol has no error-code dictionary, so a refusal condition ' +
    'is one sentence in `logic`, never a table. `logic` describes the inside of the tool and is ' +
    'never sent to a model. `returns` describes the PAYLOAD, never the `content[]`/`isError` ' +
    'envelope, and `sampleReturn` is filled ONLY when the return is nested or carries an array of ' +
    'objects. An empty annotation hint means the server declares nothing — it is not `false`. ' +
    'Every record must also carry the tag `srv-{server}` matching its `server` field: nothing ' +
    'validates that pair, and a mismatch silently drops the tool from its server’s list.',
};
