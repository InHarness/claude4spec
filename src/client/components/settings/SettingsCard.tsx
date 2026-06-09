import type { CSSProperties, ReactNode } from 'react';

interface SettingsCardProps {
  id: string;
  title: string;
  description?: string;
  badge?: 'hot-reload' | 'restart-required' | 'next-new-thread';
  children: ReactNode;
}

const BADGE_STYLE: Record<NonNullable<SettingsCardProps['badge']>, { label: string; style: CSSProperties }> = {
  'hot-reload': { label: 'Hot reload', style: { background: 'var(--c-accent-soft)', color: 'var(--c-accent)' } },
  'restart-required': { label: 'Restart required', style: { background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' } },
  // 0.1.51: hot-reload, but the change only takes effect from the first turn of the
  // next NEW thread (the system prompt is rendered once and persisted per-thread).
  'next-new-thread': { label: 'Next new thread', style: { background: 'var(--c-accent-soft)', color: 'var(--c-accent)' } },
};

/**
 * Section card shared by all Settings sections. The `id` doubles as the hash
 * anchor target used by smooth-scroll. The optional `badge` surfaces the
 * hot-reload vs restart-required contract from M26 §2 — restart-required
 * sections also show the "Restart required" banner above the shell when any
 * field in the section is mutated (`usePatchConfig` writes the marker).
 */
export function SettingsCard({ id, title, description, badge, children }: SettingsCardProps) {
  return (
    <section
      id={id}
      style={{
        background: 'var(--c-card)',
        border: '1px solid var(--c-hair)',
        borderRadius: 8,
        padding: '20px 22px',
        scrollMarginTop: 16,
      }}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--c-ink)' }}>
            {title}
          </h2>
          {description ? (
            <p
              className="text-[12px] mt-1"
              style={{ color: 'var(--c-subtle)' }}
            >
              {description}
            </p>
          ) : null}
        </div>
        {badge ? (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={BADGE_STYLE[badge].style}
          >
            {BADGE_STYLE[badge].label}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
