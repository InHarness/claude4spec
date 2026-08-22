import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * `highlight.js/lib/core` plus an EXPLICIT grammar list, never the `highlight.js`
 * barrel — the same pattern the host's `SystemPromptView` uses. The barrel pulls
 * all ~190 grammars into the bundle; this pulls fourteen.
 *
 * The list is not a promise. A language outside it is not an error and not a
 * missing feature: the card renders it as plaintext, which is exactly what the
 * type's contract says happens to an unrecognised `language`. Adding one here is
 * a one-line change with no migration, because `language` is a free string and
 * not an enum.
 */
const GRAMMARS: ReadonlyArray<readonly [string, Parameters<typeof hljs.registerLanguage>[1]]> = [
  ['bash', bash],
  ['css', css],
  ['diff', diff],
  ['go', go],
  ['java', java],
  ['javascript', javascript],
  ['json', json],
  ['markdown', markdown],
  ['python', python],
  ['rust', rust],
  ['sql', sql],
  ['typescript', typescript],
  ['xml', xml],
  ['yaml', yaml],
];

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  for (const [name, grammar] of GRAMMARS) hljs.registerLanguage(name, grammar);
  registered = true;
}

/** Whether this grammar is one we can colour. A `false` here is a normal state. */
export function canHighlight(language: string): boolean {
  ensureRegistered();
  return hljs.getLanguage(language) !== undefined;
}

/**
 * Highlight `code`, or hand back escaped plaintext when the grammar is unknown
 * or the highlighter throws.
 *
 * Returns HTML, so BOTH branches must escape. The plaintext branch is the one
 * that would otherwise be an injection: `hljs.highlight` escapes what it emits,
 * a raw fallback would not.
 */
export function highlightToHtml(code: string, language: string): string {
  ensureRegistered();
  if (canHighlight(language)) {
    try {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    } catch {
      // A grammar that throws is a colouring problem, never a rendering one.
    }
  }
  return escapeHtml(code);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
