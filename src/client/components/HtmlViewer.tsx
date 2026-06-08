import { useEffect } from 'react';
import { ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useHtmlViewerStore } from '../state/htmlViewer.js';

interface Props {
  path: string;
}

/**
 * M30 (L5): read-only preview of a static `.html` file from `pagesDir`.
 *
 * The raw HTML is served by `GET /api/static/<path>` (same origin as the app) and loaded
 * into a sandboxed iframe. `sandbox="allow-scripts"` deliberately OMITS `allow-same-origin`,
 * so the page gets an opaque origin: in-page JS runs and relative assets load, but it has no
 * cookies/localStorage, no same-origin fetch, and no access to `window.parent`.
 *
 * No HTML editing/rename/delete in v1. Expand/collapse is an in-app overlay (not the native
 * Fullscreen API) backed by local UI state outside the URL.
 */
export function HtmlViewer({ path }: Props) {
  const segments = path.split('/');
  const expanded = useHtmlViewerStore((s) => s.expanded);
  const toggleExpanded = useHtmlViewerStore((s) => s.toggleExpanded);
  const setExpanded = useHtmlViewerStore((s) => s.setExpanded);

  // Collapse when switching to a different file so we never strand the overlay.
  useEffect(() => {
    setExpanded(false);
  }, [path, setExpanded]);

  // Encode each path segment so spaces / unicode resolve, while keeping `/` separators.
  const src = `/api/static/${segments.map(encodeURIComponent).join('/')}`;

  const frame = (
    <iframe
      key={path}
      title={path}
      src={src}
      sandbox="allow-scripts"
      className="w-full h-full border-0 bg-white"
    />
  );

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--c-bg)' }}>
        <Header
          segments={segments}
          expanded
          onToggle={toggleExpanded}
        />
        <div className="flex-1 min-h-0">{frame}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <Header segments={segments} expanded={false} onToggle={toggleExpanded} />
      <div className="flex-1 min-h-0">{frame}</div>
    </div>
  );
}

function Header({
  segments,
  expanded,
  onToggle,
}: {
  segments: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-5 py-2.5 shrink-0"
      style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
    >
      <div className="flex items-center gap-1.5 text-[12px] min-w-0" style={{ color: 'var(--c-muted)' }}>
        {segments.map((s, i) => (
          <span key={`${s}-${i}`} className="flex items-center gap-1.5">
            <span
              className="truncate"
              style={{
                color: i === segments.length - 1 ? 'var(--c-ink)' : 'var(--c-muted)',
                fontWeight: i === segments.length - 1 ? 600 : 400,
              }}
            >
              {s}
            </span>
            {i < segments.length - 1 && <ChevronRight size={11} />}
          </span>
        ))}
        <span
          className="ml-2 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide shrink-0"
          style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}
        >
          read-only
        </span>
      </div>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? 'Collapse' : 'Expand'}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[12px] transition"
        style={{ color: 'var(--c-muted)', border: '1px solid var(--c-hair)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-panel)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        <span>{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
    </div>
  );
}
