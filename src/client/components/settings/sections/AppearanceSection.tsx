import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '../../../state/tweaks.js';
import { SettingsCard } from '../SettingsCard.js';

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun; description: string }> = [
  { value: 'light', label: 'Light', Icon: Sun, description: 'Always light' },
  { value: 'dark', label: 'Dark', Icon: Moon, description: 'Always dark' },
  { value: 'system', label: 'System', Icon: Monitor, description: 'Follow OS preference' },
];

/**
 * M26 §7 — Appearance section. Three-state preference: light / dark / system.
 * `system` subscribes to `prefers-color-scheme` so the UI tracks OS-level
 * changes without a page reload. Persisted in localStorage as
 * `c4s:settings:theme` (envelope `{v:1, data}`). The anti-FOUC inline script
 * in `index.html` mirrors this resolution before React mounts.
 */
export function AppearanceSection() {
  const { theme, setTheme, effectiveTheme } = useTheme();

  return (
    <SettingsCard
      id="appearance"
      title="Appearance"
      description={`Currently rendering ${effectiveTheme}.`}
    >
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ value, label, Icon, description }) => {
          const selected = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={selected}
              className="flex flex-col items-start gap-1.5 rounded-md px-3 py-2.5 text-left"
              style={{
                background: selected ? 'var(--c-accent-soft)' : 'var(--c-bg)',
                border: `1px solid ${selected ? 'var(--c-accent)' : 'var(--c-hair)'}`,
                color: 'var(--c-ink)',
              }}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <Icon size={14} />
                {label}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--c-subtle)' }}>
                {description}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}
