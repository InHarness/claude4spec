import { Plus } from 'lucide-react';

interface Props {
  loading: boolean;
  empty: boolean;
  emptyTitle: string;
  emptyHint?: React.ReactNode;
  createLabel: string;
  onCreate: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

export function ListScrollArea({
  loading,
  empty,
  emptyTitle,
  emptyHint,
  createLabel,
  onCreate,
  children,
}: Props) {
  return (
    <div className="flex-1 overflow-auto nice-scroll">
      <div className="mx-auto" style={{ maxWidth: 1000, padding: '16px 32px 48px' }}>
        {loading && (
          <div className="text-center text-[13px] py-10" style={{ color: 'var(--c-subtle)' }}>
            Loading…
          </div>
        )}
        {!loading && empty && (
          <div
            className="text-center py-20 rounded-lg"
            style={{
              background: 'var(--c-card)',
              border: '1px dashed var(--c-hair-strong)',
              color: 'var(--c-subtle)',
            }}
          >
            <div className="text-[14px] mb-2">{emptyTitle}</div>
            {emptyHint && <div className="text-[12px] mb-4">{emptyHint}</div>}
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium mt-2"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              <Plus size={13} /> {createLabel}
            </button>
          </div>
        )}
        {!loading && children}
      </div>
    </div>
  );
}
