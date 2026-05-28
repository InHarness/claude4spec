import type { ReactNode } from 'react';

interface SettingsCardProps {
  id: string;
  title: string;
  description?: string;
  badge?: 'hot-reload' | 'restart-required';
  children: ReactNode;
}

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
            style={
              badge === 'hot-reload'
                ? { background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }
                : { background: 'rgba(168, 112, 51, 0.18)', color: '#a87033' }
            }
          >
            {badge === 'hot-reload' ? 'Hot reload' : 'Restart required'}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
