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
  /**
   * 0.2.50 — the `language` alias table is gone from the block.
   *
   * It described the WRITE PATH's normalisation ("`TypeScript`, `TS` and `ts`
   * all store as `typescript`; an unknown value is kept as written") — validation
   * mechanics, which the slot's budget excludes by name, and which change no
   * decision the agent makes: whatever it writes, the right thing happens, and
   * it finds out from `describe_entity_type` if it ever needs to care.
   *
   * The promotion threshold stays whole and unabbreviated, because it is the one
   * rule in this type that no validator can enforce — half a line count, half a
   * judgement — and the agent is the only thing in the system positioned to make
   * the second half.
   */
  narrativeBlock:
    `Lift a code block out of a fence into a \`code-snippet\` entity ONLY when BOTH hold: it is ` +
    `at least ${PROMOTION_MIN_LINES} lines long, AND it is an EXAMPLE OF A FORM — the canonical ` +
    `shape of something named elsewhere (a manifest, a contract, a schema, a convention). The ` +
    `deciding test for the second half is "would this block make sense on a page other than the ` +
    `one I am writing it on?" If not, it stays an ordinary fence. A one-off quotation of an ` +
    `implementation belonging to a single section is NOT a snippet, however long it is. ` +
    `Embed one with the generic reference tags and never paste the same code beside a reference ` +
    `to it — the reference is the point.`,
};
