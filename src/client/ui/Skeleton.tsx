import type { CSSProperties } from 'react';

/**
 * Skeleton-loader primitive — a pulsing placeholder bar. Thin wrapper over the
 * `.skeleton` class (keyframe `skeleton-pulse` lives in styles/theme.css), so
 * the animation stays in one place and callers only declare dimensions.
 */
export interface SkeletonProps {
  /** number → px; string used verbatim (e.g. '60%'). Defaults to '100%'. */
  width?: number | string;
  /** number → px; string verbatim. Defaults to 12. */
  height?: number | string;
  /** Corner radius; number → px. Defaults to the `.skeleton` class (4px). */
  radius?: number | string;
  /** Full circle (e.g. avatar) — forces a 999px radius. */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

const dim = (v: number | string) => (typeof v === 'number' ? `${v}px` : v);

export function Skeleton({ width = '100%', height = 12, radius, circle, className, style }: SkeletonProps) {
  return (
    <span
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
