import { ChevronRight } from 'lucide-react';
import { ButtonGroup } from './ButtonGroup.js';
import { OutlineButton } from './OutlineButton.js';
import { PageViewSwitcher } from './PageViewSwitcher.js';
import { useBaseRootId, useRoots } from '../hooks/useConfig.js';

interface Props {
  rootId: string;
  path: string;
}

export function EditorToolbar({ rootId, path }: Props) {
  // 0.1.96: prefix the breadcrumb with the root name for every root but the base
  // one — 0.2.101: identified by the `builtin` flag, so the prefix disappears for
  // the base root whatever it is called, and appears for a USER root that happens
  // to be called `pages`.
  const baseRootId = useBaseRootId();
  const segments = (rootId === baseRootId ? [] : [rootId]).concat(path.split('/'));
  // 2.1.1 — no outline toggle in a root without a section index (the editor
  // renders no gutter there). An unresolved root keeps the button: the default
  // it stands in for is the full, section-indexed one.
  const root = useRoots().find((r) => r.id === rootId);
  const showOutline = root?.sectionIndexed ?? true;

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
      {showOutline && (
        <ButtonGroup>
          <OutlineButton onPage />
        </ButtonGroup>
      )}
    </div>
  );
}
