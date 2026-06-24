import type { CSSProperties } from 'react';
import { withStability } from '../stability.js';

/**
 * `LoadingState` (Actions, `experimental`) — a pulsing skeleton placeholder.
 * Thin wrapper over the host's `.skeleton` class (keyframe `skeleton-pulse` in
 * `styles/theme.css`), so the animation stays in one place and callers only
 * declare dimensions. Renders `lines` stacked bars when `lines > 1`.
 *
 * Pure-presentational. Experimental: props may change without a major bump.
 */
export interface LoadingStateProps {
  /** number → px; string used verbatim (e.g. '60%'). Defaults to '100%'. */
  width?: number | string;
  /** number → px; string verbatim. Defaults to 12. */
  height?: number | string;
  /** Corner radius; number → px. Defaults to the `.skeleton` class (4px). */
  radius?: number | string;
  /** Full circle (e.g. avatar) — forces a 999px radius. */
  circle?: boolean;
  /** Render N stacked bars (e.g. a loading list). Defaults to 1. */
  lines?: number;
  className?: string;
  style?: CSSProperties;
}

const dim = (v: number | string) => (typeof v === 'number' ? `${v}px` : v);

function bar(props: LoadingStateProps, key?: number) {
  const { width = '100%', height = 12, radius, circle, className, style } = props;
  return (
    <span
      key={key}
      className={`skeleton block${className ? ` ${className}` : ''}`}
      style={{
        width: dim(width),
        height: dim(height),
        ...(circle ? { borderRadius: 999 } : radius != null ? { borderRadius: dim(radius) } : null),
        ...style,
      }}
    />
  );
}

function LoadingStateImpl(props: LoadingStateProps) {
  const lines = props.lines ?? 1;
  if (lines <= 1) return bar(props);
  return (
    <span className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => bar(props, i))}
    </span>
  );
}

export const LoadingState = withStability(LoadingStateImpl, 'experimental');
