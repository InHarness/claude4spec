import { forwardRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { FileText, Link as LinkIcon } from 'lucide-react';
import type { PageRefSyntax } from '../tiptap/extensions/PageRefNode.js';

export type PageRefChipState = 'normal' | 'broken' | 'stale' | 'loading';

export interface PageRefChipProps {
  syntax: PageRefSyntax;
  path: string;
  anchor?: string;
  label?: string;
  title?: string;
  state?: PageRefChipState;
  onClick?: (e: MouseEvent<HTMLSpanElement>) => void;
  onClickCapture?: (e: MouseEvent<HTMLSpanElement>) => void;
  interactive?: boolean;
  style?: CSSProperties;
  title_?: string;
}

// Aligned with `.prose-spec code` (theme.css:130): same JetBrains Mono / 13px /
// 4px radius / 1px 5px padding. Tinted bg + stronger hairline to read as clickable
// while staying kinfolk to inline code — which is what page refs are typed as.
const STATE_PALETTE: Record<
  PageRefChipState,
  { bg: string; bgHover: string; fg: string; border: string }
> = {
  normal: {
    bg: 'var(--c-accent-soft)',
    bgHover: 'color-mix(in srgb, var(--c-accent) 22%, var(--c-accent-soft))',
    fg: 'var(--c-accent-ink)',
    border: 'var(--c-hair-strong)',
  },
  loading: {
    bg: 'var(--c-panel)',
    bgHover: 'var(--c-panel)',
    fg: 'var(--c-subtle, #7a756a)',
    border: 'var(--c-hair)',
  },
  broken: {
    bg: 'var(--c-red-soft)',
    bgHover: 'color-mix(in srgb, var(--c-red) 22%, var(--c-red-soft))',
    fg: 'var(--c-red)',
    border: 'var(--c-red)',
  },
  stale: {
    bg: 'rgba(200,150,60,0.14)',
    bgHover: 'rgba(200,150,60,0.28)',
    fg: '#b4832a',
    border: '#b4832a',
  },
};

export const PageRefChip = forwardRef<HTMLSpanElement, PageRefChipProps>(function PageRefChip(
  {
    syntax,
    path,
    anchor,
    label,
    title,
    state = 'normal',
    onClick,
    onClickCapture,
    interactive = true,
    style,
    title_,
  },
  ref,
) {
  const palette = STATE_PALETTE[state];
  const [hover, setHover] = useState(false);
  const Icon = syntax === 'link' ? LinkIcon : FileText;
  const text = displayText({ state, syntax, path, anchor, label, title });
  const tooltip =
    title_ ??
    (state === 'broken'
      ? `Broken page reference: ${path}`
      : state === 'stale'
        ? `Anchor #${anchor} not found in ${title ?? path}`
        : anchor
          ? `${title ?? path}#${anchor}`
          : title ?? path);

  const nodeStyle: CSSProperties = {
    background: interactive && hover ? palette.bgHover : palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.border}`,
    borderRadius: 4,
    padding: '1px 5px',
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 13,
    cursor: interactive ? 'pointer' : 'default',
    lineHeight: 1.35,
    transition: 'background-color 120ms ease',
    ...style,
  };

  return (
    <span
      ref={ref}
      className="inline-flex items-center gap-1 align-middle"
      style={nodeStyle}
      onClick={onClick}
      onClickCapture={onClickCapture}
      onMouseEnter={interactive ? () => setHover(true) : undefined}
      onMouseLeave={interactive ? () => setHover(false) : undefined}
      title={tooltip}
      role={onClick ? 'button' : undefined}
    >
      <Icon size={12} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.75 }} />
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>
        {text}
      </span>
    </span>
  );
});

function displayText({
  state,
  syntax,
  path,
  anchor,
  label,
  title,
}: {
  state: PageRefChipState;
  syntax: PageRefSyntax;
  path: string;
  anchor?: string;
  label?: string;
  title?: string;
}): ReactNode {
  if (state === 'broken') return `⚠ ${path}`;
  if (syntax === 'link' && label) return label;
  const base = title ?? path.replace(/\.md$/, '').split('/').pop() ?? path;
  if (anchor) return `${base} #${anchor}`;
  return base;
}
