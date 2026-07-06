import { useRef, useState } from 'react';
import { withStability } from '../stability.js';
import { Popover } from '../overlay-feedback/Popover.js';

/**
 * `EnumBadgePicker` (Pickers, `experimental`) — a colored badge-with-dropdown
 * picking a value out of any enum. Generalizes the host's `MethodBadge` /
 * `METHOD_STYLE` + its `MethodPicker` dropdown (HTTP method only) to an
 * arbitrary enum. Pure-presentational; the dropdown renders through the
 * published `Popover`.
 */
export interface EnumBadgePickerProps {
  options: { value: string; label: string; color?: string }[];
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
}

function EnumBadgePickerImpl({ options, value, onChange, readOnly }: EnumBadgePickerProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  const color = current?.color ?? 'var(--c-muted)';

  return (
    <div className="relative inline-block">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => !readOnly && setOpen((v) => !v)}
        disabled={readOnly}
        className="inline-flex items-center justify-center font-mono font-semibold tracking-wide rounded px-2 py-1 text-[12px]"
        style={{
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
          minWidth: 56,
          cursor: readOnly ? 'default' : 'pointer',
        }}
      >
        {current?.label ?? value}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom">
        <div className="flex flex-col" style={{ minWidth: 120 }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="px-2 py-1 text-left rounded text-[11px] font-mono font-semibold"
              style={{
                background: opt.value === value ? `color-mix(in srgb, ${opt.color ?? 'var(--c-muted)'} 18%, transparent)` : 'transparent',
                color: opt.value === value ? (opt.color ?? 'var(--c-ink)') : 'var(--c-muted)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export const EnumBadgePicker = withStability(EnumBadgePickerImpl, 'experimental');
