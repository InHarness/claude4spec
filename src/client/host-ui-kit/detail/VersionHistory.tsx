import { withStability } from '../stability.js';
import { EmptyState } from '../list/EmptyState.js';

/**
 * `VersionHistory` (Panel detalu, `experimental`) — a version list rendered
 * entirely from props, driven by the host's `useVersions` hook. No
 * self-fetch: the plugin author wires the hook's `data` in as `versions`.
 */
export interface VersionHistoryItem {
  id: string;
  label: string;
  createdAt: string;
  author?: string;
}

export interface VersionHistoryProps {
  versions: VersionHistoryItem[];
  activeVersion?: string;
  onSelect?(id: string): void;
  onRestore?(id: string): void;
}

function VersionHistoryImpl({ versions, activeVersion, onSelect, onRestore }: VersionHistoryProps) {
  if (versions.length === 0) {
    return <EmptyState title="No versions yet" hint="Changes to this entity will appear here." />;
  }

  return (
    <ul className="flex flex-col gap-1">
      {versions.map((v) => {
        const isActive = v.id === activeVersion;
        return (
          <li
            key={v.id}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
            style={{
              background: isActive ? 'var(--c-panel)' : 'transparent',
              border: `1px solid ${isActive ? 'var(--c-hair-strong)' : 'transparent'}`,
              cursor: onSelect ? 'pointer' : 'default',
            }}
            onClick={() => onSelect?.(v.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--c-ink)' }}>
                {v.label}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--c-muted)' }}>
                {v.createdAt}
                {v.author ? ` · ${v.author}` : ''}
              </div>
            </div>
            {onRestore && !isActive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore(v.id);
                }}
                className="rounded px-2 py-1 text-[11px] font-medium btn-ghost"
                style={{ color: 'var(--c-accent)' }}
              >
                Restore
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const VersionHistory = withStability(VersionHistoryImpl, 'experimental');
