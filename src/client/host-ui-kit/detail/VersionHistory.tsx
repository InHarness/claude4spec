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
  /** M13/M34: shown per-row in the `timeline` variant (kit doesn't fetch releases — author supplies it). */
  releaseLabel?: string;
}

export interface VersionHistoryProps {
  versions: VersionHistoryItem[];
  activeVersion?: string;
  onSelect?(id: string): void;
  onRestore?(id: string): void;
  /** `'flat'` (default) keeps the existing list unchanged. `'timeline'` adds a two-column/dots layout + "Compare to". */
  variant?: 'flat' | 'timeline';
  /** M13/M34: the version currently selected as the `timeline` "Compare to" target — purely for display, this component never diffs. */
  compareVersion?: string;
  /** M13/M34: fired when a `timeline` row's "Compare to" action is used. */
  onCompare?(id: string): void;
}

function VersionHistoryImpl({
  versions,
  activeVersion,
  onSelect,
  onRestore,
  variant = 'flat',
  compareVersion,
  onCompare,
}: VersionHistoryProps) {
  if (versions.length === 0) {
    return <EmptyState title="No versions yet" hint="Changes to this entity will appear here." />;
  }

  if (variant === 'timeline') {
    return (
      <TimelineList
        versions={versions}
        activeVersion={activeVersion}
        onSelect={onSelect}
        onRestore={onRestore}
        compareVersion={compareVersion}
        onCompare={onCompare}
      />
    );
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

type TimelineListProps = Pick<
  VersionHistoryProps,
  'versions' | 'activeVersion' | 'onSelect' | 'onRestore' | 'compareVersion' | 'onCompare'
>;

/** `variant='timeline'` — two-column dots/connector layout + "Compare to". Fetch-free, same as flat. */
function TimelineList({ versions, activeVersion, onSelect, onRestore, compareVersion, onCompare }: TimelineListProps) {
  return (
    <ul className="flex flex-col">
      {versions.map((v, i) => {
        const isActive = v.id === activeVersion;
        const isCompareTarget = v.id === compareVersion;
        const isLast = i === versions.length - 1;
        return (
          <li key={v.id} className="flex gap-2.5">
            <div className="flex flex-col items-center" style={{ width: 12, flexShrink: 0 }}>
              <div
                className="rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  marginTop: 8,
                  background: isActive ? 'var(--c-accent)' : 'var(--c-hair-strong)',
                  flexShrink: 0,
                }}
              />
              {!isLast && <div style={{ width: 1, flex: 1, background: 'var(--c-hair)' }} />}
            </div>
            <div
              className="flex-1 min-w-0 rounded-md px-2.5 py-1.5 mb-1"
              style={{
                background: isActive ? 'var(--c-panel)' : 'transparent',
                border: `1px solid ${isCompareTarget ? 'var(--c-accent)' : isActive ? 'var(--c-hair-strong)' : 'transparent'}`,
                cursor: onSelect ? 'pointer' : 'default',
              }}
              onClick={() => onSelect?.(v.id)}
            >
              <div className="flex items-center gap-1.5">
                <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--c-ink)' }}>
                  {v.label}
                </div>
                {v.releaseLabel && (
                  <span
                    className="text-[10px] rounded px-1.5 py-0.5 flex-shrink-0"
                    style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent-ink)' }}
                  >
                    {v.releaseLabel}
                  </span>
                )}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--c-muted)' }}>
                {v.createdAt}
                {v.author ? ` · ${v.author}` : ''}
              </div>
              {(onCompare || (onRestore && !isActive)) && (
                <div className="flex gap-2 mt-1">
                  {onCompare && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCompare(v.id);
                      }}
                      className="rounded px-2 py-0.5 text-[11px] font-medium btn-ghost"
                      style={{ color: isCompareTarget ? 'var(--c-accent)' : 'var(--c-muted)' }}
                    >
                      {isCompareTarget ? 'Comparing' : 'Compare to'}
                    </button>
                  )}
                  {onRestore && !isActive && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRestore(v.id);
                      }}
                      className="rounded px-2 py-0.5 text-[11px] font-medium btn-ghost"
                      style={{ color: 'var(--c-accent)' }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export const VersionHistory = withStability(VersionHistoryImpl, 'experimental');
