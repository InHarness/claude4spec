export function StyleOption({
  title,
  description,
  selected,
  dashed = false,
  compact = false,
  onClick,
  radioName,
  radioValue,
}: {
  title: string;
  description: string;
  selected: boolean;
  dashed?: boolean;
  compact?: boolean;
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
      <div
        className={`font-semibold ${compact ? 'text-[12.5px]' : 'text-[14px]'}`}
        style={{ color: 'var(--c-ink)' }}
      >
        {title}
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
