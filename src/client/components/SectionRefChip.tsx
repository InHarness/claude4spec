import { forwardRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Hash } from 'lucide-react';

export type SectionRefChipState = 'normal' | 'broken' | 'loading';

export interface SectionRefChipProps {
  anchor: string;
  pagePath?: string;
  headingText?: string;
  state?: SectionRefChipState;
  onClick?: (e: MouseEvent<HTMLSpanElement>) => void;
  onClickCapture?: (e: MouseEvent<HTMLSpanElement>) => void;
  interactive?: boolean;
  style?: CSSProperties;
}

const STATE_PALETTE: Record<
  SectionRefChipState,
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
};

export const SectionRefChip = forwardRef<HTMLSpanElement, SectionRefChipProps>(
  function SectionRefChip(
    { anchor, pagePath, headingText, state = 'normal', onClick, onClickCapture, interactive = true, style },
    ref,
  ) {
    const palette = STATE_PALETTE[state];
    const [hover, setHover] = useState(false);

    const text =
      state === 'broken'
        ? `[broken: ${anchor}]`
        : state === 'loading'
          ? `${anchor}…`
          : (headingText ?? anchor);
    const tooltip =
      state === 'broken'
        ? `Broken section reference: anchor "${anchor}" not found in section_index`
        : pagePath && headingText
          ? `${pagePath} > ${headingText}`
          : pagePath
            ? `${pagePath}#${anchor}`
            : anchor;

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
        data-section-anchor={anchor}
      >
        <Hash size={12} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.75 }} />
        <span
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 360,
          }}
        >
          {text}
        </span>
      </span>
    );
  },
);
