import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Share2, Maximize2 } from 'lucide-react';
import { renderDiagram, hashSource, sanitizeRenderId, isSupportedFormat } from '../diagramRender.js';
import { openPopover } from '../../../ui/events.js';
import { DiagramFullscreen } from '../../../components/DiagramFullscreen.js';

type ViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string; line?: number };

export function DiagramView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const format = String(node.attrs.format || 'mermaid');
  const caption = String(node.attrs.caption ?? '');
  const source = String(node.attrs.source ?? '');

  const [state, setState] = useState<ViewState>(
    source ? { status: 'loading' } : { status: 'idle' },
  );
  const [fullscreen, setFullscreen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(
    () => sanitizeRenderId(`${format}-${hashSource(source)}-${Math.random().toString(36).slice(2, 6)}`),
    [format, source],
  );

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) {
      setState({ status: 'idle' });
      return;
    }
    if (!isSupportedFormat(format)) {
      setState({
        status: 'error',
        message: `Unsupported format: ${format}. Supported: mermaid`,
      });
      return;
    }
    setState({ status: 'loading' });
    renderDiagram(format, source, renderId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ status: 'rendered', svg: result.svg });
      } else {
        setState({ status: 'error', message: result.message, line: result.line });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [format, source, renderId]);

  async function openEditPopover(e?: React.MouseEvent) {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const x = e?.clientX ?? rect?.left ?? 100;
    const y = e?.clientY ?? (rect?.bottom ?? 100) + 4;
    const result = await openPopover('diagram', { x, y }, {
      mode: 'edit',
      initial: { format, caption, source },
    });
    if (!result) return;
    if ('__action' in result && result.__action === 'remove') {
      deleteNode();
      return;
    }
    if (!('__action' in result)) {
      updateAttributes({
        format: result.format,
        caption: result.caption,
        source: result.source,
      });
    }
  }

  function handleClick(e: React.MouseEvent) {
    if (state.status === 'idle' || state.status === 'error') {
      void openEditPopover(e);
      return;
    }
    if (e.altKey) {
      e.preventDefault();
      void openEditPopover(e);
    }
  }

  function handleDoubleClick(e: React.MouseEvent) {
    e.preventDefault();
    void openEditPopover(e);
  }

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className="my-3 not-prose"
      contentEditable={false}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {state.status === 'idle' && (
        <div
          className="flex items-center justify-center gap-2 rounded cursor-pointer py-6"
          style={{
            background: 'var(--c-panel)',
            color: 'var(--c-muted)',
            border: '1px dashed var(--c-hair)',
            fontSize: 13,
          }}
          title="Click to edit diagram"
        >
          <Share2 size={14} aria-hidden="true" />
          <span>Empty diagram — click to edit</span>
        </div>
      )}

      {state.status === 'loading' && (
        <div
          className="rounded py-8 text-center"
          style={{
            background: 'var(--c-panel)',
            color: 'var(--c-subtle)',
            border: '1px solid var(--c-hair)',
            fontSize: 12,
            animation: 'pulse 1.4s ease-in-out infinite',
          }}
        >
          Rendering diagram…
        </div>
      )}

      {state.status === 'rendered' && (
        <figure style={{ margin: 0, position: 'relative' }}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFullscreen(true);
            }}
            title="Expand (fullscreen with zoom & pan)"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              zIndex: 2,
              padding: 6,
              background: 'var(--c-card)',
              color: 'var(--c-muted)',
              border: '1px solid var(--c-hair)',
              borderRadius: 3,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.75,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.color = 'var(--c-ink)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.75';
              e.currentTarget.style.color = 'var(--c-muted)';
            }}
          >
            <Maximize2 size={13} />
          </button>
          <div
            className="c4s-diagram-svg"
            style={{
              background: '#FFFBF4',
              border: '1px solid var(--c-hair)',
              borderRadius: 4,
              padding: 12,
              overflow: 'auto',
              cursor: 'pointer',
            }}
            title="Double-click or Alt+click to edit · top-right icon to expand"
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
          {caption && (
            <figcaption
              style={{
                color: 'var(--c-muted)',
                fontStyle: 'italic',
                fontSize: 13,
                textAlign: 'center',
                marginTop: 6,
              }}
            >
              {caption}
            </figcaption>
          )}
          {fullscreen && (
            <DiagramFullscreen
              svg={state.svg}
              caption={caption}
              onClose={() => setFullscreen(false)}
            />
          )}
        </figure>
      )}

      {state.status === 'error' && (
        <div style={{ cursor: 'pointer' }} title="Click to fix">
          <div
            className="rounded px-3 py-2"
            style={{
              background: 'var(--c-red-soft, #f7dcd3)',
              color: 'var(--c-red, #c45a3b)',
              border: '1px solid var(--c-red, #c45a3b)',
              fontSize: 12.5,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <strong>Diagram error</strong>
            {state.line !== undefined ? ` (line ${state.line})` : ''}: {state.message}
          </div>
          <pre
            style={{
              background: 'var(--c-panel)',
              color: 'var(--c-ink)',
              border: '1px solid var(--c-hair)',
              borderTop: 'none',
              borderRadius: '0 0 4px 4px',
              padding: 8,
              fontSize: 12,
              whiteSpace: 'pre',
              overflow: 'auto',
              margin: 0,
            }}
          >
            {source}
          </pre>
        </div>
      )}
    </NodeViewWrapper>
  );
}
