import type { CSSProperties } from 'react';
import { LoadingState } from '../host-ui-kit/actions/LoadingState.js';

/**
 * Skeleton-loader primitive — a pulsing placeholder bar. Delegates to the Host
 * UI Kit's `LoadingState` (M34/L12, `experimental`), which owns the same
 * `.skeleton` wrapper. The external prop API and rendered output are unchanged.
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

export function Skeleton(props: SkeletonProps) {
  return <LoadingState {...props} />;
}
