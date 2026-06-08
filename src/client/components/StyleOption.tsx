export function StyleOption({
  title,
  description,
  selected,
  dashed = false,
  compact = false,
  badge,
  onClick,
  radioName,
  radioValue,
}: {
  title: string;
  description: string;
  selected: boolean;
  dashed?: boolean;
  compact?: boolean;
  badge?: string;
  onClick: () => void;
  radioName: string;
  radioValue: string;
}) {
  return (
    <label
      className={`block cursor-pointer rounded-md transition-colors ${compact ? 'p-2' : 'p-3'}`}
      style={{
        border: `1px ${dashed ? 'dashed' : 'solid'} ${selected ? 'var(--c-accent)' : 'var(--c-hair)'}`,
        background: selected ? 'var(--c-card)' : 'transparent',
        opacity: dashed && !selected ? 0.85 : 1,
      }}
      onClick={onClick}
    >
      <input
        type="radio"
        name={radioName}
        value={radioValue}
        checked={selected}
        onChange={onClick}
        className="sr-only"
      />
      <div className="flex items-center gap-2">
        <span
          className={`font-semibold ${compact ? 'text-[12.5px]' : 'text-[14px]'}`}
          style={{ color: 'var(--c-ink)' }}
        >
          {title}
        </span>
        {badge && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider font-mono"
            style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)', color: 'var(--c-muted)' }}
          >
            {badge}
          </span>
        )}
      </div>
      <div
        className={`leading-relaxed ${compact ? 'text-[11.5px] mt-0.5' : 'text-[12.5px] mt-1'}`}
        style={{ color: 'var(--c-muted)' }}
      >
        {description}
      </div>
    </label>
  );
}
