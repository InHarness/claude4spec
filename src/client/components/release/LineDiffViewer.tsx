import type { LineDiffLite } from '../../../shared/entities.js';

interface Props {
  lineDiff: LineDiffLite;
}

/**
 * Per-line render of `LineDiff` (M17 decyzja 10 wariant C).
 * Each line gets a `+` / `−` / ` ` prefix and tinted background.
 * Renderer dla M17 release detail i (przyszłości) page detail history.
 */
export function LineDiffViewer({ lineDiff }: Props) {
  if (lineDiff.lines.length === 0) {
    return (
      <div
        className="text-[11.5px] italic px-2 py-1.5"
        style={{ color: 'var(--c-subtle)' }}
      >
        (no line-level changes)
      </div>
    );
  }
  return (
    <div
      className="font-mono text-[11.5px] leading-snug rounded overflow-hidden"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      {lineDiff.lines.map((line, i) => {
        const style = stylesFor(line.op);
        return (
          <div
            key={i}
            className="flex items-baseline whitespace-pre-wrap break-words"
            style={{ background: style.bg, color: style.fg, paddingLeft: 6, paddingRight: 8 }}
          >
            <span style={{ width: 14, color: 'var(--c-subtle)', flexShrink: 0 }}>
              {prefixOf(line.op)}
            </span>
            <span className="flex-1 min-w-0">{line.content || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

function prefixOf(op: 'keep' | 'added' | 'removed'): string {
  if (op === 'added') return '+';
  if (op === 'removed') return '−';
  return ' ';
}

function stylesFor(op: 'keep' | 'added' | 'removed'): { bg: string; fg: string } {
  if (op === 'added') return { bg: 'rgba(16,185,129,0.10)', fg: 'var(--c-ink)' };
  if (op === 'removed') return { bg: 'rgba(220,38,38,0.10)', fg: 'var(--c-ink)' };
  return { bg: 'transparent', fg: 'var(--c-muted)' };
}
