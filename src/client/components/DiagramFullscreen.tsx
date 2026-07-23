import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, Maximize, RotateCcw } from 'lucide-react';

const MIN_SCALE = 0.1;
const MAX_SCALE = 12;

interface Props {
  svg: string;
  caption?: string;
  onClose: () => void;
}

export function DiagramFullscreen({ svg, caption, onClose }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(1.2);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(1 / 1.2);
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        fitToScreen();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useLayoutEffect(() => {
    fitToScreen();
  }, []);

  function fitToScreen() {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const svgEl = content.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;
    const stageRect = stage.getBoundingClientRect();
    const bbox = svgEl.getBoundingClientRect();
    const naturalW = bbox.width / scale || svgEl.clientWidth || 800;
    const naturalH = bbox.height / scale || svgEl.clientHeight || 600;
    const padding = 40;
    const fit = Math.min(
      (stageRect.width - padding * 2) / naturalW,
      (stageRect.height - padding * 2) / naturalH,
      4,
    );
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, fit));
    setScale(next);
    setOffset({
      x: (stageRect.width - naturalW * next) / 2,
      y: (stageRect.height - naturalH * next) / 2,
    });
  }

  function reset() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function zoomBy(factor: number, anchor?: { x: number; y: number }) {
    setScale((prev) => {
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * factor));
      if (anchor && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        const cx = anchor.x - rect.left;
        const cy = anchor.y - rect.top;
        setOffset((o) => ({
          x: cx - ((cx - o.x) * next) / prev,
          y: cy - ((cy - o.y) * next) / prev,
        }));
      }
      return next;
    });
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomBy(factor, { x: e.clientX, y: e.clientY });
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset({ x: dragStart.current.ox + dx, y: dragStart.current.oy + dy });
  }
  function handleMouseUp() {
    setDragging(false);
    dragStart.current = null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diagram fullscreen"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(47, 42, 37, 0.55)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--c-card)',
          borderBottom: '1px solid var(--c-hair-strong)',
        }}
      >
        <span
          style={{
            color: 'var(--c-subtle)',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          Diagram
        </span>
        {caption && (
          <span
            style={{
              color: 'var(--c-muted)',
              fontSize: 13,
              fontStyle: 'italic',
              marginLeft: 4,
            }}
          >
            — {caption}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ToolbarButton title="Zoom out (−)" onClick={() => zoomBy(1 / 1.2)}>
          <ZoomOut size={14} />
        </ToolbarButton>
        <span
          style={{
            color: 'var(--c-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            minWidth: 48,
            textAlign: 'center',
          }}
        >
          {Math.round(scale * 100)}%
        </span>
        <ToolbarButton title="Zoom in (+)" onClick={() => zoomBy(1.2)}>
          <ZoomIn size={14} />
        </ToolbarButton>
        <ToolbarButton title="Fit to screen (F)" onClick={fitToScreen}>
          <Maximize size={14} />
        </ToolbarButton>
        <ToolbarButton title="Reset to 100% (0)" onClick={reset}>
          <RotateCcw size={14} />
        </ToolbarButton>
        <ToolbarButton title="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </ToolbarButton>
      </div>

      <div
        ref={stageRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1,
          overflow: 'hidden',
          background: '#FFFBF4',
          cursor: dragging ? 'grabbing' : 'grab',
          position: 'relative',
        }}
      >
        <div
          ref={contentRef}
          // same hook as the embedded NodeView (DiagramView) and the detail panel:
          // this overlay is NOT portalled — it renders inside the NodeView's <figure>,
          // so it sits under `.prose-spec` and `.prose-spec p` would recolor mermaid's
          // labels here too. The containment rule in theme.css is keyed on this class,
          // so without it the overlay keeps the bug the embedded view no longer has.
          className="c4s-diagram-svg"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div
        style={{
          padding: '6px 14px',
          background: 'var(--c-card)',
          borderTop: '1px solid var(--c-hair)',
          color: 'var(--c-subtle)',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
        }}
      >
        Scroll = zoom · drag = pan · F = fit · 0 = 100% · Esc = close
      </div>
    </div>
  );
}

function ToolbarButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        padding: 4,
        color: 'var(--c-muted)',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 3,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--c-panel)';
        e.currentTarget.style.color = 'var(--c-ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--c-muted)';
      }}
    >
      {children}
    </button>
  );
}
