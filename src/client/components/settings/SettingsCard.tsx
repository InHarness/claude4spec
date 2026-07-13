import type { ReactNode } from 'react';

interface SettingsCardProps {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Section card shared by all Settings sections. The `id` doubles as the hash
 * anchor target used by smooth-scroll.
 */
export function SettingsCard({ id, title, description, children }: SettingsCardProps) {
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
      </header>
      {children}
    </section>
  );
}
