import type { CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';

export type SkillRefChipState = 'normal' | 'broken' | 'loading';

export interface SkillRefChipProps {
  slug: string;
  state?: SkillRefChipState;
  /** The listing row's origin, shown in the tooltip of a live chip. */
  origin?: string;
  description?: string;
}

const PALETTE: Record<SkillRefChipState, { bg: string; fg: string; border: string }> = {
  normal: { bg: 'var(--c-accent-soft)', fg: 'var(--c-accent-ink)', border: 'var(--c-hair-strong)' },
  loading: { bg: 'var(--c-panel)', fg: 'var(--c-subtle, #7a756a)', border: 'var(--c-hair)' },
  broken: { bg: 'var(--c-red-soft)', fg: 'var(--c-red)', border: 'var(--c-red)' },
};

/**
 * M52 — the chip of `<skill_ref slug="…"/>`, in the composer and in chat
 * history alike. A pure component: no editor instance, no editor commands.
 * `broken` = the slug is not in the `chat` skill listing — the chip is marked
 * missing, and nothing else changes (the message goes out as written).
 */
export function SkillRefChip({ slug, state = 'normal', origin, description }: SkillRefChipProps) {
  const palette = PALETTE[state];
  const text = state === 'broken' ? `[missing skill: ${slug}]` : `/${slug}`;
  const tooltip =
    state === 'broken'
      ? `Skill "${slug}" is not in this project's chat skill listing`
      : [`Skill ${slug}`, origin ? `(${origin})` : '', description ? `— ${description}` : '']
          .filter(Boolean)
          .join(' ');
  const style: CSSProperties = {
    background: palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.border}`,
    borderRadius: 4,
    padding: '1px 5px',
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    fontSize: 13,
    lineHeight: 1.35,
  };
  return (
    <span
      className="inline-flex items-center gap-1 align-middle"
      style={style}
      title={tooltip}
      data-skill-ref={slug}
      data-skill-ref-state={state}
    >
      <Sparkles size={12} aria-hidden="true" style={{ flexShrink: 0, opacity: 0.75 }} />
      <span style={{ whiteSpace: 'nowrap' }}>{text}</span>
    </span>
  );
}
