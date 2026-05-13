import { FileText, Plus, Sparkles } from 'lucide-react';

interface Props {
  onOpenFirst?: () => void;
  firstPageLabel?: string;
  onNewPage: () => void;
}

export function EmptyState({ onOpenFirst, firstPageLabel, onNewPage }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center px-10">
      <div className="max-w-md text-center">
        <div
          className="mx-auto rounded-2xl inline-flex items-center justify-center mb-4"
          style={{ width: 56, height: 56, background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}
        >
          <Sparkles size={26} />
        </div>
        <h2 className="font-serif text-[26px] font-semibold mb-1 tracking-tight">
          Welcome to claude4spec
        </h2>
        <p className="text-[14px] mb-6" style={{ color: 'var(--c-muted)' }}>
          Markdown jest źródłem prawdy dla treści, SQLite dla encji, tagi XML są mostem. Zacznij od
          utworzenia strony albo otwórz istniejącą z sidebara.
        </p>
        <div className="flex items-center justify-center gap-2">
          {onOpenFirst && firstPageLabel && (
            <button
              onClick={onOpenFirst}
              className="rounded-md px-3 py-1.5 text-[12.5px] inline-flex items-center gap-1.5"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              <FileText size={12} /> Open {firstPageLabel}
            </button>
          )}
          <button
            onClick={onNewPage}
            className="rounded-md px-3 py-1.5 text-[12.5px] inline-flex items-center gap-1.5"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-hair-strong)',
              color: 'var(--c-ink)',
            }}
          >
            <Plus size={12} /> New page
          </button>
        </div>
      </div>
    </div>
  );
}
