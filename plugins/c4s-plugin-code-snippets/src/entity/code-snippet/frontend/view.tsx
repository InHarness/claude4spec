import React from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { COLLAPSE_LINES, DEFAULT_LANGUAGE } from '../../../identity.js';
import { canHighlight, highlightToHtml } from './highlight.js';
import './tokens.css';

export interface CodeSnippetViewProps {
  code: string;
  language?: string | null;
  /** `true` while the record is still being fetched. */
  loading?: boolean;
  /**
   * Render everything, ignoring the collapse threshold. The fullscreen overlay
   * passes this: it exists precisely to show the whole thing.
   */
  alwaysExpanded?: boolean;
  /** Hide the copy action — the fullscreen overlay carries its own, in the footer. */
  hideCopy?: boolean;
  maxHeight?: number | string;
}

/**
 * The body every code-snippet surface shares: card, fullscreen and the popover's
 * live preview all render this and nothing else.
 *
 * FOUR STATES, and the fourth is the one most likely to be misread as a bug:
 *
 *   - `loading`   — no record yet.
 *   - `rendered`  — coloured, with a line-number gutter and a copy action.
 *   - `collapsed` — over `COLLAPSE_LINES`, shown short with an expand action and
 *                   a count of what is hidden.
 *   - `plaintext` — the grammar is unknown, so the same surface without token
 *                   colours. THIS IS NOT AN ERROR STATE. No banner, no warning,
 *                   no red. `language` is a free string by design and an unknown
 *                   value is a legal value; colouring is a convenience.
 */
export function CodeSnippetView({
  code,
  language,
  loading = false,
  alwaysExpanded = false,
  hideCopy = false,
  maxHeight,
}: CodeSnippetViewProps) {
  const lang = (language ?? DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE;
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // A new snippet re-collapses. Without this, expanding one embed and then
  // navigating to another shows the second one already open for no reason.
  React.useEffect(() => setExpanded(false), [code]);

  const lines = React.useMemo(() => code.split('\n'), [code]);
  const collapsible = !alwaysExpanded && lines.length > COLLAPSE_LINES;
  const showAll = alwaysExpanded || expanded || !collapsible;
  const visible = showAll ? lines : lines.slice(0, COLLAPSE_LINES);
  const hidden = lines.length - visible.length;

  const html = React.useMemo(
    () => highlightToHtml(visible.join('\n'), lang),
    [visible, lang],
  );
  const plain = !canHighlight(lang);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is permission-gated and may simply refuse. Failing to copy is
      // not worth an error surface on a read-only view.
    }
  }, [code]);

  if (loading) {
    return (
      <div
        className="c4s-code-snippet flex items-center gap-2 px-3 py-6 text-[12.5px]"
        style={{ color: 'var(--c-muted)' }}
        data-testid="code-snippet-view"
        data-state="loading"
      >
        Loading snippet…
      </div>
    );
  }

  return (
    <div
      className="c4s-code-snippet relative"
      data-testid="code-snippet-view"
      data-state={collapsible && !showAll ? 'collapsed' : plain ? 'plaintext' : 'rendered'}
      data-language={lang}
    >
      {!hideCopy && (
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded px-1.5 py-1 text-[11px]"
          style={{
            background: 'var(--c-panel)',
            color: copied ? 'var(--c-green)' : 'var(--c-muted)',
            border: '1px solid var(--c-hair)',
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : null}
        </button>
      )}

      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <div className="flex min-w-full">
          {/* The gutter is a sibling of the code, not a ::before on each line:
              it must not enter the selection when the user drags across the
              block, or a copy yields line numbers interleaved with code. */}
          <pre
            aria-hidden="true"
            className="c4s-code-snippet-gutter shrink-0 px-2 py-3 text-[12.5px] leading-[1.6]"
            style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo, monospace)' }}
          >
            {visible.map((_, i) => `${i + 1}`).join('\n')}
          </pre>
          <pre className="min-w-0 flex-1 overflow-x-auto px-3 py-3 text-[12.5px] leading-[1.6]">
            <code
              className="hljs"
              style={{ background: 'transparent' }}
              // Both branches of `highlightToHtml` escape; see its note.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        </div>
      </div>

      {collapsible && !showAll && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-1 py-1.5 text-[11.5px]"
          style={{
            color: 'var(--c-accent-ink)',
            borderTop: '1px solid var(--c-hair)',
            background: 'var(--c-panel)',
          }}
        >
          <ChevronDown size={12} />
          Show {hidden} more {hidden === 1 ? 'line' : 'lines'}
        </button>
      )}
    </div>
  );
}
