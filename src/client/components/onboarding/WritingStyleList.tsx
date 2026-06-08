import type { WritingStyleItem } from '../../lib/api.js';
import { StyleOption } from '../StyleOption.js';

const NONE_KEY = '__none__';

export type WritingStyleSelection = string | null | undefined;

export function WritingStyleList({
  available,
  selection,
  onSelect,
}: {
  available: WritingStyleItem[];
  selection: WritingStyleSelection;
  onSelect: (slug: string | null) => void;
}) {
  const empty = available.length === 0;
  return (
    <div className="mb-6">
      <div
        className="text-[10.5px] uppercase tracking-wider font-mono mb-2"
        style={{ color: 'var(--c-subtle)' }}
      >
        Writing style
      </div>

      {empty && (
        <div
          className="text-[12px] mb-3"
          style={{ color: 'var(--c-muted)' }}
        >
          No writing styles bundled in this build. You can continue without one.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {available.map((s) => (
          <StyleOption
            key={s.slug}
            title={s.title}
            description={s.description}
            selected={selection === s.slug}
            badge={s.source === 'user' ? 'yours' : undefined}
            onClick={() => onSelect(s.slug)}
            radioName="writing-style"
            radioValue={s.slug}
          />
        ))}

        <StyleOption
          title="None — I'll choose later"
          description="Skip writing style selection. You can change it anytime by editing config.json."
          selected={selection === null}
          dashed
          onClick={() => onSelect(null)}
          radioName="writing-style"
          radioValue={NONE_KEY}
        />
      </div>
    </div>
  );
}
