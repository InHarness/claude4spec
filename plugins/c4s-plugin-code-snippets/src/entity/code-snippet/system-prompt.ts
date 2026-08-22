import type { SystemPromptContribution } from '@c4s/plugin-runtime';
import { PROMOTION_MIN_LINES } from '../../identity.js';

/**
 * No `mcpToolsLine` — the package contributes no MCP server of its own (it has
 * no `backend` slot at all), so there are no custom tools to announce. Everything
 * this type can do is the host's generic `entity-tools` CRUD.
 *
 * No `defaultPredicate` — the count is unfiltered. Every record of this type is
 * a snippet; there is no draft state and nothing to hide from a count.
 *
 * The `narrativeBlock` carries the ONE rule no validator can enforce: the
 * promotion threshold. Half of it is mechanical (a line count) and half is a
 * judgement ("is this an example of a form?"), and the agent is the only thing
 * in the system positioned to make the second half. Without this slot
 * `buildSystemPrompt` skips the type entirely and the agent never learns it can
 * author one.
 */
export const codeSnippetSystemPrompt: SystemPromptContribution = {
  roleNoun: 'Code snippets',
  narrativeBlock:
    `Lift a code block out of a fence into a \`code-snippet\` entity ONLY when BOTH hold: it is ` +
    `at least ${PROMOTION_MIN_LINES} lines long, AND it is an EXAMPLE OF A FORM — the canonical ` +
    `shape of something named elsewhere (a manifest, a contract, a schema, a convention). The ` +
    `deciding test for the second half is "would this block make sense on a page other than the ` +
    `one I am writing it on?" If not, it stays an ordinary fence. A one-off quotation of an ` +
    `implementation belonging to a single section is NOT a snippet, however long it is. ` +
    `Embed one with \`<single_element type="code-snippet" slug="…" caption="…"/>\` for a block ` +
    `card, or \`<inline_mention type="code-snippet" slug="…"/>\` for an inline chip; \`caption\` ` +
    `belongs to the REFERENCE, not to the entity, so the same snippet may carry a different ` +
    `caption in each place it appears. Never paste the same code beside a reference to it — the ` +
    `reference is the point. \`language\` is lower-cased and passed through a closed alias table ` +
    `on write, so \`TypeScript\`, \`TS\` and \`ts\` all store as \`typescript\`; an unknown value ` +
    `is kept as written and simply renders without colouring.`,
};
