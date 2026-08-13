import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Share2, Maximize2, Pencil } from 'lucide-react';
import type { Diagram } from '../../../shared/entities.js';
import {
  renderDiagram,
  hashSource,
  sanitizeRenderId,
  isSupportedFormat,
} from '../../tiptap/extensions/diagramRender.js';
import { DiagramFullscreen } from '../../components/DiagramFullscreen.js';
import { useDiagram, useDiagramSource, useUpdateDiagram } from '../../hooks/useDiagrams.js';
import { openPopover, toast } from '../../ui/events.js';
import type { DiagramFormat } from '../../../shared/entities.js';
import { useTheme } from '../../state/tweaks.js';
import type { EntityCardProps } from '../registry.js';

/** Shared by the two corner affordances; only `right` differs. */
const OVERLAY_BUTTON: React.CSSProperties = {
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
};

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
 * The DSL is edited from the pencil, which opens the same `diagram` popover the
 * old NodeView opened on double-click and writes back through `useUpdateDiagram`.
 * It edits the ENTITY — source and format. The caption is per-reference, lives
 * on the embedding tag, and is edited with the chip (Alt+click), which is the
 * one thing the old view conflated.
 */
export function DiagramCard({ slug, entity, caption, onOpen }: EntityCardProps<Diagram>) {
  const { effectiveTheme } = useTheme();
  const format = entity?.format ?? 'mermaid';
  /**
   * 0.2.22 — the body comes from its own operation, not from the entity.
   *
   * `source` is content-bearing, so `entity` carries `hasSource`/`sourceBytes`
   * and nothing else. Fetching it here means a card renders in two steps, which
   * is the honest cost of not shipping kilobytes of DSL to every surface that
   * merely LISTS diagrams.
   */
  const sourceQuery = useDiagramSource(entity ? slug : null);
  const source = sourceQuery.data ?? '';
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const figureRef = useRef<HTMLElement>(null);
  const updateDiagram = useUpdateDiagram();

  /**
   * The repair path. A diagram whose source no longer parses renders as an
   * error box, and an error box with no way into the source is a dead end: the
   * only remaining move would be `/diagram`, which mints a NEW entity under a
   * new slug and orphans this one.
   */
  async function openEditPopover(e?: React.MouseEvent) {
    const rect = figureRef.current?.getBoundingClientRect();
    const result = await openPopover(
      'diagram',
      { x: e?.clientX ?? rect?.left ?? 100, y: e?.clientY ?? (rect?.bottom ?? 100) + 4 },
      { mode: 'edit', initial: { format, title: entity?.title ?? '', caption: caption ?? '', source } },
    );
    if (!result || '__action' in result) return;
    if (result.source === source && result.format === format && result.title === entity?.title) return;
    updateDiagram.mutate(
      {
        slug,
        input: { title: result.title, source: result.source, format: result.format as DiagramFormat },
      },
      { onError: (err) => toast.error((err as Error).message) },
    );
  }

  /**
   * Unique per MOUNTED CARD, not per diagram. Mermaid stamps this id into the
   * SVG it returns and derives every internal `id` from it — markers, cluster
   * fills, gradients — which the markup then references as `url(#…)`. Two
   * embeds of the same diagram on one page therefore inject the same ids into
   * one document, and the second copy's arrowheads resolve against the first
   * copy's defs. `useId` is what keeps them apart; the old `DiagramView` mixed
   * in `Math.random()` for the same reason.
   */
  const instanceId = useId();
  const renderId = useMemo(
    () => sanitizeRenderId(`card-${format}-${effectiveTheme}-${hashSource(source)}-${slug}-${instanceId}`),
    [format, source, slug, effectiveTheme, instanceId],
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
    <figure ref={figureRef} style={{ margin: 0, position: 'relative' }}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void openEditPopover(e);
        }}
        title="Edit diagram source"
        aria-label={`Edit diagram ${slug}`}
        style={{ ...OVERLAY_BUTTON, right: onOpen ? 34 : 6 }}
      >
        <Pencil size={13} />
      </button>
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
          style={OVERLAY_BUTTON}
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
          {/* The offending source, so the pencil above has something to aim at. */}
          <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', fontSize: 11.5, opacity: 0.85 }}>
            {source}
          </pre>
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
  const instanceId = useId();
  const { data: entity } = useDiagram(slug);
  const [svg, setSvg] = useState('');
  const source = entity?.source ?? '';
  const format = entity?.format ?? 'mermaid';

  useEffect(() => {
    let cancelled = false;
    if (!source.trim() || !isSupportedFormat(format)) return;
    const id = sanitizeRenderId(`overlay-${format}-${effectiveTheme}-${hashSource(source)}-${slug}-${instanceId}`);
    void renderDiagram(format, source, id, effectiveTheme).then((result) => {
      if (!cancelled && result.ok) setSvg(result.svg);
    });
    return () => {
      cancelled = true;
    };
  }, [source, format, slug, effectiveTheme, instanceId]);

  return <DiagramFullscreen svg={svg} caption={caption} onClose={onClose} />;
}
