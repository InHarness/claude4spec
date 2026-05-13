import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useWritingStyles } from '../hooks/useWritingStyles.js';
import { usePatchConfig } from '../hooks/useConfig.js';
import { PopoverShell } from '../ui/Popover.js';
import { toast } from '../ui/events.js';
import { StyleOption } from './StyleOption.js';

const NONE_KEY = '__none__';

export function WritingStyleSelector() {
  const { data } = useWritingStyles();
  const patchConfig = usePatchConfig();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const active = data?.active ?? null;
  const available = data?.available ?? [];
  const activeStyle = active ? available.find((s) => s.slug === active) : null;
  const label = activeStyle ? activeStyle.title : 'none';

  function open() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ x: rect.left, y: rect.bottom + 4 });
  }

  function close() {
    setPos(null);
  }

  async function select(slug: string | null) {
    if (slug === active) {
      close();
      return;
    }
    try {
      await patchConfig.mutateAsync({ writingStyle: slug });
      toast.success('Writing style updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      close();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (pos ? close() : open())}
        className="w-full flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] truncate"
        style={{
          color: 'var(--c-muted)',
          borderBottom: '1px solid var(--c-hair)',
          background: pos ? 'var(--c-panel)' : 'transparent',
        }}
        title="Change writing style"
      >
        <Sparkles size={11} style={{ flexShrink: 0 }} />
        <span className="truncate">
          Style: <span style={{ color: 'var(--c-ink)' }}>{label}</span>
        </span>
      </button>

      {pos && (
        <PopoverShell
          x={pos.x}
          y={pos.y}
          width={320}
          estHeight={Math.min(80 + (available.length + 1) * 64, 480)}
          onCancel={close}
          title="Writing style"
        >
          <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto">
            {available.length === 0 && (
              <div
                className="text-[11.5px] mb-1"
                style={{ color: 'var(--c-muted)' }}
              >
                No writing styles bundled in this build.
              </div>
            )}

            {available.map((s) => (
              <StyleOption
                key={s.slug}
                title={s.title}
                description={s.description}
                selected={active === s.slug}
                compact
                onClick={() => select(s.slug)}
                radioName="sidebar-writing-style"
                radioValue={s.slug}
              />
            ))}

            <StyleOption
              title="None"
              description="No writing style. Agent runs without bundled style guidelines."
              selected={active === null}
              dashed
              compact
              onClick={() => select(null)}
              radioName="sidebar-writing-style"
              radioValue={NONE_KEY}
            />
          </div>
        </PopoverShell>
      )}
    </>
  );
}
