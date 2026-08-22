import React from 'react';
import { Check, Copy, X } from 'lucide-react';
import { DEFAULT_LANGUAGE } from '../../../identity.js';
import { fetchCodeSnippet, type CodeSnippet } from './hooks.js';
import { CodeSnippetView } from './view.js';

/**
 * The read-only fullscreen surface. `code-snippet` is a HIDDEN type — no detail
 * route, no detail panel — so this is where a chip or a card's maximise button
 * sends the reader instead of navigating.
 *
 * Two entrances, and they differ only in whether a record is already in hand:
 * the card passes the one it fetched, the chip passes nothing and this fetches
 * on open.
 *
 * ALWAYS FULL CONTENT: `alwaysExpanded` is passed unconditionally. The card's
 * collapse threshold is about not letting one embed swallow a page; a surface
 * whose entire job is "show me all of it" has no business collapsing.
 *
 * Not the kit's `Dialog`, for the same reason `DiagramFullscreen` is not: this
 * is an immersive read surface rather than a modal asking for a decision, and
 * the host's one-implementation guard already records that exception.
 */
export function CodeSnippetFullscreen({
  slug,
  entity,
  caption,
  onClose,
}: {
  slug: string;
  entity?: CodeSnippet | null;
  caption?: string;
  onClose: () => void;
}) {
  const [record, setRecord] = React.useState<CodeSnippet | null>(entity ?? null);
  const [loading, setLoading] = React.useState(!entity);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (entity) {
      setRecord(entity);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    void fetchCodeSnippet(slug).then((next) => {
      if (!live) return;
      setRecord(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [slug, entity]);

  const code = record?.code ?? '';

  const copyAll = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission may simply refuse; not worth an error surface.
    }
  }, [code]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      /*
       * Cmd/Ctrl+C copies the SELECTION when there is one, and the whole snippet
       * when there is not.
       *
       * The guard matters: without the emptiness check this would hijack an
       * ordinary copy of a few highlighted lines and silently replace it with
       * the entire file, which is the kind of thing a reader only notices after
       * pasting.
       */
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        const selection = window.getSelection()?.toString() ?? '';
        if (selection.trim() === '') {
          e.preventDefault();
          void copyAll();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, copyAll]);

  const heading = record?.filename?.trim() || record?.title || slug;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Code snippet: ${heading}`}
      data-testid="code-snippet-fullscreen"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(47,42,37,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="flex flex-col overflow-hidden rounded-lg"
        style={{
          background: 'var(--c-card)',
          border: '1px solid var(--c-hair-strong)',
          width: 'min(1100px, 100%)',
          maxHeight: '100%',
          boxShadow: '0 16px 48px rgba(0,0,0,0.32)',
        }}
      >
        <header
          className="flex shrink-0 items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid var(--c-hair)' }}
        >
          <span
            className="min-w-0 flex-1 truncate font-mono text-[12.5px]"
            style={{ color: 'var(--c-ink)' }}
          >
            {heading}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider"
            style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
          >
            {record?.language || DEFAULT_LANGUAGE}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1"
            style={{ color: 'var(--c-muted)' }}
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <CodeSnippetView
            code={code}
            language={record?.language}
            loading={loading}
            alwaysExpanded
            hideCopy
          />
        </div>

        <footer
          className="flex shrink-0 items-center gap-2 px-3 py-2"
          style={{ borderTop: '1px solid var(--c-hair)' }}
        >
          {caption ? (
            <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: 'var(--c-muted)' }}>
              {caption}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={copyAll}
            className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11.5px]"
            style={{
              border: '1px solid var(--c-hair)',
              background: 'var(--c-panel)',
              color: copied ? 'var(--c-green)' : 'var(--c-ink)',
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </footer>
      </div>
    </div>
  );
}
