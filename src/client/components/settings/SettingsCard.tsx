import type { ReactNode } from 'react';

interface SettingsCardProps {
  id: string;
  title: string;
  description?: string;
  /** 0.2.113: `danger` draws the red frame the Danger zone card carries. */
  tone?: 'danger';
  children: ReactNode;
}

/**
 * Section card shared by all Settings sections. The `id` doubles as the hash
 * anchor target used by smooth-scroll.
 */
export function SettingsCard({ id, title, description, tone, children }: SettingsCardProps) {
  const danger = tone === 'danger';
  return (
    <section
      id={id}
      style={{
        background: 'var(--c-card)',
        border: danger ? '1px solid var(--c-red, #c45a3b)' : '1px solid var(--c-hair)',
        borderRadius: 8,
        padding: '20px 22px',
        scrollMarginTop: 16,
      }}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="text-[15px] font-semibold"
            style={{ color: danger ? 'var(--c-red, #c45a3b)' : 'var(--c-ink)' }}
          >
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
      </header>
      {children}
    </section>
  );
}
