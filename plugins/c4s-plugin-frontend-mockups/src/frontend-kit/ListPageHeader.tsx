import { Plus, type LucideIcon } from 'lucide-react';
import { ActionButton, EntityListHeader } from '@c4s/plugin-runtime/ui';

interface Props {
  icon: LucideIcon;
  title: string;
  count: number;
  search: string;
  onSearchChange: (q: string) => void;
  searchPlaceholder: string;
  createLabel: string;
  onCreate: () => void;
}

/**
 * Not host-local (2.1.20, Host UI Kit slices of `ui-view` and `design-system`):
 * a local composition of catalog components only — `EntityListHeader` with an
 * `ActionButton` in its action slot — with no anatomy of its own. The 2.1.19
 * debt entry for it was struck.
 *
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
        <ActionButton variant="primary" icon={<Plus size={13} />} label={createLabel} onClick={onCreate} />
      }
    />
  );
}
