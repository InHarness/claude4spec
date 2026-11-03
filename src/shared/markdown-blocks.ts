import MarkdownIt from 'markdown-it';
import { JSX_BLOCK_RULE_NAME, jsxBlockRule, type JsxBlockMeta } from './jsx-passthrough.js';
import { XML_BLOCK_RULE_NAME, registeredTagBlockRule } from './xml-markup/block-rule.js';
import type { CodeRange, ExcludedBlock } from './code-ranges.js';

/**
 * M51 — the block structure the non-content scanner works on (`sjjkc8bt`, step
 * 1). The server does not recognise tags with a markdown tokenizer, but it
 * takes the BLOCKS from one: markdown-it configured like the editor's
 * (`html: true`, GFM tables) plus the block rules shared with it — the JSX
 * region rule from `jsx-passthrough.ts` and the registered-tag rule from
 * `xml-markup/block-rule.ts`. The tokenizer gives block boundaries
 * in lines; byte positions inside them are the scanner's own job.
 *
 * Pure: no DOM, no Node-only API — compiled into both builds via `src/shared`.
 */

export interface BlockStructure {
  /** Fenced and indented code blocks and multi-line HTML comments, in document order. */
  blocks: ExcludedBlock[];
  /** Block JSX regions — exact `[start, end)` from the opening `<` to past the closing tag. */
  jsxBlocks: CodeRange[];
  /**
   * Inline blocks — paragraphs, headings and table cells, inside list items and
   * block quotes too — as `[start, end)` in document order. Inline code pairs
   * and inline JSX regions never cross one.
   */
  inlineBlocks: CodeRange[];
}

/**
 * Token type the shared registered-tag block rule pushes on the server: a
 * `block`-form tag alone on its line, an inline block of its own.
 */
const TAG_BLOCK_TOKEN = 'c4s_tag_block';

let tokenizer: MarkdownIt | null = null;

/** The server's block tokenizer: the editor's markdown-it options plus the shared block rules. */
export function blockTokenizer(): MarkdownIt {
  if (tokenizer) return tokenizer;
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false });
  md.block.ruler.before('html_block', JSX_BLOCK_RULE_NAME, jsxBlockRule());
  md.block.ruler.before('html_block', XML_BLOCK_RULE_NAME, registeredTagBlockRule({ tokenType: TAG_BLOCK_TOKEN }));
  tokenizer = md;
  return md;
}

const COMMENT_OPEN_RE = /^[ \t]*<!--/;

/**
 * Cell boundaries of one table row `[start, end)` (GFM): a `|` not preceded by
 * a backslash ends a cell — inside backticks too; `\|` does not.
 */
function tableCells(text: string, start: number, end: number): CodeRange[] {
  const cells: CodeRange[] = [];
  let from = start;
  for (let i = start; i < end; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x5c /* \ */) {
      i++;
      continue;
    }
    if (ch === 0x7c /* | */) {
      if (i > from) cells.push([from, i]);
      from = i + 1;
    }
  }
  if (end > from) cells.push([from, end]);
  return cells;
}

/**
 * Block structure of `text`. Offsets are char offsets into `text` itself: the
 * tokenizer gets a copy with every `\r` turned into a space (same length), so
 * a CRLF file keeps its positions and its fences.
 */
export function scanBlockStructure(text: string): BlockStructure {
  const src = text.includes('\r') ? text.replace(/\r/g, ' ') : text;
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineCount = lineStarts.length;
  const lineEnd = (l: number): number => {
    const next = lineStarts[l + 1];
    return next === undefined ? src.length : next - 1;
  };
  const md = blockTokenizer();
  // Block level only: inline content is the scanner's own job (positions).
  const tokens: Array<any> = [];
  md.block.parse(src, md, {}, tokens);
  // `block.parse` treats a trailing newline as ending the last line, as we do.
  const lineMax = (() => {
    let n = lineCount;
    if (src.endsWith('\n')) n--;
    return n;
  })();

  const blocks: ExcludedBlock[] = [];
  const jsxBlocks: CodeRange[] = [];
  const inlineBlocks: CodeRange[] = [];
  let inTable = 0;
  for (const t of tokens) {
    const map = t.map as [number, number] | null;
    switch (t.type) {
      case 'table_open':
        inTable++;
        break;
      case 'table_close':
        inTable--;
        break;
      case 'tr_open':
        if (map) for (const cell of tableCells(src, lineStarts[map[0]]!, lineEnd(map[0]))) inlineBlocks.push(cell);
        break;
      case 'inline':
      case TAG_BLOCK_TOKEN:
        if (inTable === 0 && map) inlineBlocks.push([lineStarts[map[0]]!, lineEnd(map[1] - 1)]);
        break;
      case 'fence': {
        if (!map) break;
        // Every content line ends with `\n`, except the document's last line
        // when the file has no trailing newline: count that one too, or a
        // fence running to the end of such a file looks closed.
        const content = t.content as string;
        const contentLines = content.split('\n').length - 1 + (content !== '' && !content.endsWith('\n') ? 1 : 0);
        const hasCloser = map[1] - map[0] - 1 - contentLines === 1;
        blocks.push({
          kind: 'fence',
          start: lineStarts[map[0]]!,
          end: lineEnd(map[1] - 1),
          startLine: map[0] + 1,
          endLine: map[1],
          // A fence nothing closes ends with its container (list item, block
          // quote) or with the document; only the latter is `closed: false`.
          closed: hasCloser || map[1] < lineMax,
          // 2.1.65 (M19 rule 16) — no closing fence of its own, whatever ended it.
          endsWithContainer: !hasCloser && map[1] < lineMax,
        });
        break;
      }
      case 'code_block':
        if (!map) break;
        blocks.push({
          kind: 'indented-code',
          start: lineStarts[map[0]]!,
          end: lineEnd(map[1] - 1),
          startLine: map[0] + 1,
          endLine: map[1],
          closed: true,
          endsWithContainer: false,
        });
        break;
      case 'html_block': {
        if (!map) break;
        const meta = t.meta as JsxBlockMeta | null;
        if (meta && meta.jsxRegion) {
          jsxBlocks.push(meta.jsxRegion);
          break;
        }
        // A multi-line HTML comment: `<!--` opening a block whose first line
        // carries no `-->`. Other HTML blocks are no range — the editor shows
        // the tags inside them as chips.
        // `content` is the block without its container prefixes (`> `, list indent).
        const [first = '', ...rest] = (t.content as string).split('\n');
        if (!COMMENT_OPEN_RE.test(first)) break;
        if (first.slice(first.indexOf('<!--') + 4).includes('-->')) break;
        const closed = rest.some((l) => l.includes('-->'));
        blocks.push({
          kind: 'html-comment',
          start: lineStarts[map[0]]!,
          end: lineEnd(map[1] - 1),
          startLine: map[0] + 1,
          endLine: map[1],
          closed: closed || map[1] < lineMax,
          // ASSUMPTION:dev-0005 — a comment with no `-->` that its list item or
          // quote ends is reported by rule 16 like a fence ended the same way.
          endsWithContainer: !closed && map[1] < lineMax,
        });
        break;
      }
      default:
        break;
    }
  }
  return { blocks, jsxBlocks, inlineBlocks };
}
