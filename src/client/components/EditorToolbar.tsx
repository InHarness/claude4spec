import { ChevronRight } from 'lucide-react';
import { ButtonGroup } from './ButtonGroup.js';
import { OutlineButton } from './OutlineButton.js';
import { PageViewSwitcher } from './PageViewSwitcher.js';

interface Props {
  path: string;
}

export function EditorToolbar({ path }: Props) {
  const segments = path.split('/');

  return (
    <div
      className="flex items-center gap-2 px-5 py-2.5"
      style={{ borderBottom: '1px solid var(--c-hair)', background: 'var(--c-bg)' }}
    >
      <div
        className="flex items-center gap-1.5 text-[12px] min-w-0"
        style={{ color: 'var(--c-muted)' }}
      >
        {segments.map((s, i) => (
          <span key={`${s}-${i}`} className="flex items-center gap-1.5">
            <span
              style={{
                color: i === segments.length - 1 ? 'var(--c-ink)' : 'var(--c-muted)',
                fontWeight: i === segments.length - 1 ? 600 : 400,
              }}
            >
              {s}
            </span>
            {i < segments.length - 1 && <ChevronRight size={11} />}
          </span>
        ))}
      </div>
      <span className="flex-1" />
      <PageViewSwitcher />
      <ButtonGroup>
        <OutlineButton onPage />
      </ButtonGroup>
    </div>
  );
}
