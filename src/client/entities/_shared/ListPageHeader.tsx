import { Plus, type LucideIcon } from 'lucide-react';
import { EntityListHeader } from '../../host-ui-kit/core/EntityListHeader.js';

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

/**
 * M13 list-page header. Delegates to the Host UI Kit's `EntityListHeader`
 * (M34/L12, `stable`, contributed by M19), supplying the create button via the
 * action slot — so the host's own list views consume the shared catalog
 * component. The external prop API and rendered output are unchanged.
 */
export function ListPageHeader({
  icon,
  title,
  count,
  search,
  onSearchChange,
  searchPlaceholder,
  createLabel,
  onCreate,
}: Props) {
  return (
    <EntityListHeader
      icon={icon}
      title={title}
      count={count}
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={searchPlaceholder}
      actions={
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium"
          style={{ background: 'var(--c-accent)', color: '#fff' }}
        >
          <Plus size={13} /> {createLabel}
        </button>
      }
    />
  );
}
