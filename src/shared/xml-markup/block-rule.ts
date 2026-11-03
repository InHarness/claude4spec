import { getXmlTag } from './registry.js';
import { registeredTagRegexAnchored } from './pattern.js';

/**
 * M51 — THE block rule of a registered tag opening a line, one config for both
 * tokenizers: the editor's (M20 — `xmlNodes.ts`) and the server scanner's
 * (`markdown-blocks.ts`), so the two cannot drift (`sjjkc8bt`), like the JSX
 * region rule in `jsx-passthrough.ts`.
 *
 *  - a `block`-form tag alone on its line is its own block (one token, one line);
 *  - a `block`-form tag followed by text on the same line is no block: the rule
 *    declines and the later rules decide (in practice a paragraph);
 *  - any other registered tag opening a line is prose: it starts a paragraph.
 *    Without that, a registered name markdown-it accepts as an HTML tag
 *    (`todo` has no underscore) alone on its line would be taken by
 *    `html_block` as raw HTML — not inline content. Never a terminator.
 *
 * Pure: no DOM, no Node-only API, no markdown-it import — compiled into both builds.
 */

/** Name under which the rule sits in the markdown-it block ruler (before `html_block`). */
export const XML_BLOCK_RULE_NAME = 'xml_block';

export interface RegisteredTagBlockRuleOptions {
  /** Type of the token pushed for a block-form tag alone on its line (`html_block` in the editor). */
  tokenType: string;
  /** Content of that token from the tag's name and attribute body; `''` by default. */
  content?: (name: string, attrBody: string | undefined) => string;
}

/** A registered tag matching at the start of `text`, or null. */
export function matchRegisteredTagAt(text: string): RegExpExecArray | null {
  return registeredTagRegexAnchored()?.exec(text) ?? null;
}

/** markdown-it's own `paragraph` block rule of the parser `state` belongs to. */
function paragraphRule(state: any): (state: any, start: number, end: number, silent: boolean) => boolean {
  const rule = state.md.block.ruler.__rules__.find((r: { name: string }) => r.name === 'paragraph');
  return rule.fn;
}

export function registeredTagBlockRule(options: RegisteredTagBlockRuleOptions) {
  const content = options.content ?? (() => '');
  // markdown-it's StateBlock — typed loosely, as everywhere in the editor rules.
  return (state: any, startLine: number, endLine: number, silent: boolean): boolean => {
    const pos: number = state.bMarks[startLine] + state.tShift[startLine];
    const max: number = state.eMarks[startLine];
    const line: string = state.src.slice(pos, max);
    const match = matchRegisteredTagAt(line);
    if (!match) return false;
    if (getXmlTag(match[1]!)?.form !== 'block') {
      if (silent) return false;
      return paragraphRule(state)(state, startLine, endLine, false);
    }
    if (line.slice(match[0].length).trim() !== '') return false;
    if (silent) return true;
    const token = state.push(options.tokenType, '', 0);
    token.content = content(match[1]!, match[2]);
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  };
}
