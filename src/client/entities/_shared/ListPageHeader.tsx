import { Plus, Search, type LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  count: number;
  search: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder: string;
  createLabel: string;
  onCreate: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ListPageHeader({
  icon: Icon,
  title,
  count,
  search,
  onSearchChange,
  searchPlaceholder,
  createLabel,
  onCreate,
}: Props) {
  return (
    <div
      className="flex items-center gap-3 px-8 py-4"
      style={{ borderBottom: '1px solid var(--c-hair)' }}
    >
      <Icon size={18} style={{ color: 'var(--c-accent)' }} />
      <h2 className="text-[18px] font-semibold tracking-tight" style={{ color: 'var(--c-ink)' }}>
        {title}
      </h2>
      <span className="font-mono text-[11.5px]" style={{ color: 'var(--c-subtle)' }}>
        {count} {count === 1 ? 'result' : 'results'}
      </span>
      <span className="flex-1" />
      <div
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
        style={{ background: 'var(--c-card)', border: '1px solid var(--c-hair)', width: 280 }}
      >
        <Search size={13} style={{ color: 'var(--c-subtle)' }} />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="bg-transparent flex-1 text-[13px] outline-none"
          placeholder={searchPlaceholder}
          style={{ color: 'var(--c-ink)' }}
        />
      </div>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium"
        style={{ background: 'var(--c-accent)', color: '#fff' }}
      >
        <Plus size={13} /> {createLabel}
      </button>
    </div>
  );
}
