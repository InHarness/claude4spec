import React from 'react';
import { Check, Copy, Maximize2 } from 'lucide-react';
import type { EntityCardProps } from '@c4s/plugin-runtime';
import { DEFAULT_LANGUAGE } from '../../../identity.js';
import { fetchCodeSnippet, useEntityChanged, type CodeSnippet } from './hooks.js';
import { CodeSnippetFullscreen } from './fullscreen.js';
import { CodeSnippetView } from './view.js';
import { openEditPopover } from './popover.js';

/**
 * The block card for `<single_element type="code-snippet" slug="…" caption="…"/>`.
 *
 * ONE READ, and that is a direct consequence of `code` not being
 * `contentBearing`: `GET /api/code-snippets/:slug` already carries the body, so
 * unlike `DiagramCard` — which fetches metadata and then the DSL through a
 * second content operation — there is nothing to follow up with.
 *
 * `caption` renders as a `<figcaption>` and is NEVER written back to the entity.
 * It belongs to this reference; the same snippet on another page carries its own.
 */
export function CodeSnippetCard({ slug, entity, caption, onOpen }: EntityCardProps<unknown>) {
  // `unknown` by contract — the host resolved the slug without knowing the shape.
  const injected = entity as CodeSnippet | null;
  const [record, setRecord] = React.useState<CodeSnippet | null>(injected ?? null);
  const [loading, setLoading] = React.useState(!injected);
  const [copied, setCopied] = React.useState(false);
  const [overlay, setOverlay] = React.useState(false);

  const reload = React.useCallback(() => {
    let live = true;
    void fetchCodeSnippet(slug).then((next) => {
      if (!live) return;
      setRecord(next);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  React.useEffect(() => {
    setLoading(true);
    return reload();
  }, [reload]);

  // An external edit of the entity file lands here: watcher → reindex → WS.
  useEntityChanged(slug, reload);

  const copy = async () => {
    if (!record) return;
    try {
      await navigator.clipboard.writeText(record.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission may refuse; a failed copy needs no error surface.
    }
  };

  /*
   * Alt+click and double-click open the edit popover — the same two gestures the
   * diagram card uses, so the editor has one habit rather than one per type.
   * A plain single click is left alone: it must still place the caret.
   */
  const openEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!record) return;
    openEditPopover({ entity: record, caption, onSaved: reload });
  };

  const heading = record?.filename?.trim() || record?.title || slug;

  return (
    <figure
      className="my-2 overflow-hidden rounded-md"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)' }}
      data-testid="code-snippet-card"
      data-slug={slug}
      onDoubleClick={openEdit}
      onClick={(e) => {
        if (e.altKey) openEdit(e);
      }}
    >
      <header
        className="flex items-center gap-2 px-2.5 py-1.5"
        style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-panel)' }}
      >
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11.5px]"
          style={{ color: 'var(--c-muted)' }}
        >
          {heading}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
          style={{ background: 'var(--c-card)', color: 'var(--c-muted)', border: '1px solid var(--c-hair)' }}
          data-testid="code-snippet-language-badge"
        >
          {record?.language || DEFAULT_LANGUAGE}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void copy();
          }}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="shrink-0 rounded p-1"
          style={{ color: copied ? 'var(--c-green)' : 'var(--c-muted)' }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // Prefer the host's handler when it gave us one, so the overlay goes
            // through `EntityOverlayHost` exactly as a chip click does. The local
            // state is the fallback for a surface that passes no `onOpen`.
            if (onOpen) onOpen();
            else setOverlay(true);
          }}
          aria-label="Open fullscreen"
          className="shrink-0 rounded p-1"
          style={{ color: 'var(--c-muted)' }}
        >
          <Maximize2 size={13} />
        </button>
      </header>

      <CodeSnippetView code={record?.code ?? ''} language={record?.language} loading={loading} hideCopy />

      {caption ? (
        <figcaption
          className="px-2.5 py-1.5 text-[11.5px]"
          style={{ color: 'var(--c-muted)', borderTop: '1px solid var(--c-hair)' }}
        >
          {caption}
        </figcaption>
      ) : null}

      {overlay ? (
        <CodeSnippetFullscreen
          slug={slug}
          entity={record}
          {...(caption ? { caption } : {})}
          onClose={() => setOverlay(false)}
        />
      ) : null}
    </figure>
  );
}
