import type { PromptBlock } from '../types.js';

/* M01 — Project & Config: the two language directives. Each is present only when
 * its setting has a value; an unset language means no directive, not a default. */

/**
 * 0.1.51: spec-authoring language directive (config.language). Emitted verbatim —
 * `lang` is a display name from SUPPORTED_LANGUAGES. Chat/patch frames only; NOT the
 * brief frame (a brief is a separate artifact governed by conversational language).
 */
function buildSpecLanguage(lang: string): string {
  return [
    `<spec_language>`,
    `Write all specification content (pages, entity descriptions, briefs) in ${lang}. This governs the artifact, not necessarily your chat replies.`,
    `</spec_language>`,
  ].join('\n');
}

/**
 * 0.1.51: conversational language directive (config.agent.conversationalLanguage).
 * Emitted verbatim. Present in chat/patch AND brief frames.
 */
function buildConversationalLanguage(lang: string): string {
  return [
    `<conversational_language>`,
    `Always communicate with the user in ${lang}, regardless of the language they write in.`,
    `</conversational_language>`,
  ].join('\n');
}

export const M01_PROMPT_BLOCKS: readonly PromptBlock[] = [
  { name: 'spec_language', render: (c) => (c.specLanguage ? buildSpecLanguage(c.specLanguage) : null) },
  {
    name: 'conversational_language',
    render: (c) =>
      c.conversationalLanguage ? buildConversationalLanguage(c.conversationalLanguage) : null,
  },
];
