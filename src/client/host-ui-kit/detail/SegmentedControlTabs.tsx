import { withStability } from '../stability.js';

/**
 * `SegmentedControlTabs` (Panel detalu, `experimental`) — an in-panel view
 * switcher (e.g. Details / History). Typically rendered in the
 * `DetailPanelShell` `actions` slot.
 *
 * Pure-presentational: the active tab and change handler are props — no
 * internal state, no routing.
 */
export interface SegmentedControlTabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange(id: string): void;
}

function SegmentedControlTabsImpl({ tabs, active, onChange }: SegmentedControlTabsProps) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center rounded-md p-0.5"
      style={{ background: 'var(--c-panel)', border: '1px solid var(--c-hair)' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(tab.id)}
            className="rounded px-2.5 py-1 text-[12px] font-medium transition"
            style={{
              background: isActive ? 'var(--c-card)' : 'transparent',
              color: isActive ? 'var(--c-ink)' : 'var(--c-muted)',
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export const SegmentedControlTabs = withStability(SegmentedControlTabsImpl, 'experimental');
