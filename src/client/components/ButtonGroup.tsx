export function ButtonGroup({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-md"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      {children}
    </div>
  );
}

export function SegmentButton({
  icon,
  label,
  active,
  onClick,
  title,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick(): void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition"
      style={{
        background: active ? 'var(--c-card)' : 'transparent',
        color: active ? 'var(--c-accent)' : 'var(--c-ink)',
        border: `1px solid ${active ? 'var(--c-hair-strong)' : 'transparent'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );
}
