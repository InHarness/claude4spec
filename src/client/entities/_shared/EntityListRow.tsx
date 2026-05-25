import { TagChip } from '../../components/atoms.js';
import type { Tag } from '../../../shared/entities.js';

interface Props {
  leading: React.ReactNode;
  onClick: () => void;
  tags?: string[];
  tagLookup: Map<string, Tag>;
  trailing?: React.ReactNode;
  align?: 'center' | 'start';
  style?: React.CSSProperties;
  children: React.ReactNode;
}

export function EntityListRow({
  leading,
  onClick,
  tags,
  tagLookup,
  trailing,
  align = 'center',
  style,
  children,
}: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex gap-3 px-4 py-3 rounded-md transition mb-1 ${
        align === 'start' ? 'items-start' : 'items-center'
      }`}
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)', ...style }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--c-hair)')}
    >
      {leading}
      <div className="flex-1 min-w-0">
        {children}
        {tags && tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mt-1.5">
            {tags.map((ts) => (
              <TagChip
                key={ts}
                tag={tagLookup.get(ts) ?? { slug: ts, name: ts, color: null }}
                small
              />
            ))}
          </div>
        )}
      </div>
      {trailing}
    </button>
  );
}

export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
      style={{ background: 'var(--c-panel)', color: 'var(--c-muted)' }}
    >
      {children}
    </span>
  );
}
