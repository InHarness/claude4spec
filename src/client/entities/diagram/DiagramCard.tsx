import { useEffect, useMemo, useState } from 'react';
import { Share2, Maximize2 } from 'lucide-react';
import type { Diagram } from '../../../shared/entities.js';
import {
  renderDiagram,
  hashSource,
  sanitizeRenderId,
  isSupportedFormat,
} from '../../tiptap/extensions/diagramRender.js';
import { DiagramFullscreen } from '../../components/DiagramFullscreen.js';
import { useDiagram } from '../../hooks/useDiagrams.js';
import { useTheme } from '../../state/tweaks.js';
import type { EntityCardProps } from '../registry.js';

type RenderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string; line?: number };

/**
 * 0.2.15 — the diagram's block appearance, rendered wherever a
 * `<single_element type="diagram" …/>` appears.
 *
 * This is the successor to the old `DiagramView` NodeView. The difference is
 * where it hangs: the NodeView belonged to a `<diagram/>` tag the entity
 * contributed, this belongs to the entity's `renderCard` slot and is dispatched
 * generically on the `type` attribute. What it draws — mermaid SVG, caption in
 * a `<figcaption>`, a `Maximize2` button onto the fullscreen surface — is the
 * same picture.
 *
 * `mermaid` stays lazy: `renderDiagram` imports it on first use and memoises the
 * module, so a page with no diagram on it never pays for the bundle.
 *
 * Editing is NOT here. A diagram's DSL is edited through the entity, via the
 * `/diagram` popover (`diagramAuthoringExtension`); a card is a read surface.
 */
export function DiagramCard({ slug, entity, caption, onOpen }: EntityCardProps<Diagram>) {
  const { effectiveTheme } = useTheme();
  const format = entity?.format ?? 'mermaid';
  const source = entity?.source ?? '';
  const [state, setState] = useState<RenderState>({ status: 'loading' });

  const renderId = useMemo(
    () => sanitizeRenderId(`card-${format}-${hashSource(source)}-${slug}`),
    [format, source, slug, effectiveTheme],
  );

  useEffect(() => {
    let cancelled = false;
    if (!entity) return;
    if (!source.trim()) {
      setState({ status: 'idle' });
      return;
    }
    if (!isSupportedFormat(format)) {
      setState({ status: 'error', message: `Unsupported format: ${format}. Supported: mermaid` });
      return;
    }
    setState({ status: 'loading' });
    void renderDiagram(format, source, renderId, effectiveTheme).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { status: 'rendered', svg: result.svg }
          : { status: 'error', message: result.message, line: result.line },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [entity, format, source, renderId, effectiveTheme]);

  if (!entity) {
    return (
      <div
        className="rounded-md p-3"
        style={{
          background: 'var(--c-red-soft, rgba(196,90,59,0.08))',
          border: '1px dashed var(--c-red, #c45a3b)',
          color: 'var(--c-red, #c45a3b)',
        }}
      >
        <div className="text-[12px] font-mono">⚠ broken: diagram "{slug}"</div>
      </div>
    );
  }

  return (
    <figure style={{ margin: 0, position: 'relative' }}>
      {onOpen && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpen();
          }}
          title="Expand (fullscreen with zoom & pan)"
          aria-label={`Expand diagram ${slug}`}
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
        >
          <Maximize2 size={13} />
        </button>
      )}

      {state.status === 'idle' && (
        <div
          className="flex items-center justify-center gap-2 rounded py-6"
          style={{
            background: 'var(--c-panel)',
            color: 'var(--c-muted)',
            border: '1px dashed var(--c-hair)',
            fontSize: 13,
          }}
        >
          <Share2 size={14} aria-hidden="true" />
          <span>Empty diagram</span>
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
          }}
        >
          Rendering diagram…
        </div>
      )}

      {state.status === 'rendered' && (
        <div
          className="c4s-diagram-svg"
          style={{
            border: '1px solid var(--c-hair)',
            borderRadius: 4,
            padding: 12,
            overflow: 'auto',
          }}
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}

      {state.status === 'error' && (
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
      )}

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
    </figure>
  );
}

/**
 * 0.2.15 — the fullscreen surface a diagram chip or card opens, resolved from
 * the entity's `renderOverlay` slot by `EntityOverlayHost`.
 *
 * It re-renders the SVG itself rather than being handed one: the overlay is
 * opened from an event carrying only `{ slug, caption }`, precisely so a chip in
 * chat — which never rendered an SVG — can open it too.
 */
export function DiagramOverlay({
  slug,
  caption,
  onClose,
}: {
  slug: string;
  caption?: string;
  onClose: () => void;
}) {
  const { effectiveTheme } = useTheme();
  const { data: entity } = useDiagram(slug);
  const [svg, setSvg] = useState('');
  const source = entity?.source ?? '';
  const format = entity?.format ?? 'mermaid';

  useEffect(() => {
    let cancelled = false;
    if (!source.trim() || !isSupportedFormat(format)) return;
    const id = sanitizeRenderId(`overlay-${format}-${hashSource(source)}-${slug}`);
    void renderDiagram(format, source, id, effectiveTheme).then((result) => {
      if (!cancelled && result.ok) setSvg(result.svg);
    });
    return () => {
      cancelled = true;
    };
  }, [source, format, slug, effectiveTheme]);

  return <DiagramFullscreen svg={svg} caption={caption} onClose={onClose} />;
}
