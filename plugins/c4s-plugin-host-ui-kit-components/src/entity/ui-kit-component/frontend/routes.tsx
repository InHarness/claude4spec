/**
 * The `routes` slot and the type's LIST SCREEN (c4s-plugin-host-ui-kit-components
 * `ctpko3bp`):
 *   `/ui-kit-components`        — list, grouped by `group` in enum order
 *   `/ui-kit-components/$slug`  — detail
 *
 * The list is composed of catalog components: `EntityListLayout`,
 * `EntityListHeader`, `GroupedEntityList` (groups formed here, by
 * `groupRecords`), rows through `EntityListRow`, `LoadingState` / `EmptyState`.
 * The search param `q` lives in the URL.
 */

import type { FC, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { EmptyState, EntityListHeader, EntityListLayout, GroupedEntityList, LoadingState } from '@c4s/plugin-runtime/ui';
import { UI_KIT_COMPONENT_LABEL_PLURAL, UI_KIT_COMPONENT_PATH_PREFIX } from '../../../identity.js';
import type { UiKitComponent } from '../../../types.js';
import { useUiKitComponentList } from './hooks.js';
import { groupRecords } from './list-model.js';
import { UiKitComponentIcon, UiKitComponentListRow } from './render.js';
import { UiKitComponentDetail } from './detail-panel.js';

export const UI_KIT_LIST_EMPTY_TITLE = 'No UI kit components yet.';
export const UI_KIT_LIST_NO_RESULTS_TITLE = 'No matching UI kit components.';

type Navigate = (opts: { to?: string; params?: Record<string, string>; search?: unknown; replace?: boolean }) => void;

const Pane: FC<{ children: ReactNode }> = ({ children }) => (
  <main style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', background: 'var(--c-bg)' }}>{children}</main>
);

/** The list body, separated from the router so it renders from plain props. */
export const UiKitComponentList: FC<{
  records: UiKitComponent[];
  isLoading: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onOpen: (slug: string) => void;
}> = ({ records, isLoading, query, onQueryChange, onOpen }) => {
  const groups = useMemo(() => groupRecords(records, query), [records, query]);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <EntityListLayout
      header={
        <EntityListHeader
          icon={UiKitComponentIcon}
          title={UI_KIT_COMPONENT_LABEL_PLURAL}
          count={count}
          search={query}
          onSearchChange={onQueryChange}
          searchPlaceholder="Search by name, prop or type…"
        />
      }
    >
      {isLoading ? (
        <LoadingState lines={6} />
      ) : records.length === 0 ? (
        <EmptyState title={UI_KIT_LIST_EMPTY_TITLE} />
      ) : (
        <GroupedEntityList<UiKitComponent>
          groups={groups.map((g) => ({ key: g.key, label: g.key, items: g.items }))}
          renderRow={(item) => <UiKitComponentListRow key={item.slug} entity={item} onOpen={() => onOpen(item.slug)} />}
          emptyState={<EmptyState title={UI_KIT_LIST_NO_RESULTS_TITLE} hint="Try clearing the search." />}
        />
      )}
    </EntityListLayout>
  );
};

function ListRoute(): JSX.Element {
  const navigate = useNavigate() as unknown as Navigate;
  const { data = [], isLoading } = useUiKitComponentList();
  const search = useSearch({ strict: false }) as { q?: string };
  const setQuery = useCallback(
    (next: string) => navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, q: next || undefined }), replace: true }),
    [navigate],
  );
  return (
    <Pane>
      <UiKitComponentList
        records={data}
        isLoading={isLoading}
        query={search.q ?? ''}
        onQueryChange={setQuery}
        onOpen={(slug) => navigate({ to: `${UI_KIT_COMPONENT_PATH_PREFIX}/$slug`, params: { slug } })}
      />
    </Pane>
  );
}

function DetailRoute(): JSX.Element {
  const navigate = useNavigate() as unknown as Navigate;
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = String(params.slug ?? '');
  const back = () => navigate({ to: UI_KIT_COMPONENT_PATH_PREFIX });
  return (
    <Pane>
      <UiKitComponentDetail
        key={slug}
        slug={slug}
        onBack={back}
        onDeleted={back}
        onRenamed={(newSlug) => navigate({ to: `${UI_KIT_COMPONENT_PATH_PREFIX}/$slug`, params: { slug: newSlug }, replace: true })}
      />
    </Pane>
  );
}

export const uiKitComponentRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: { getParentRoute: () => unknown; path: string; component: FC }) => unknown;
  return [
    make({ getParentRoute: () => rootRoute, path: UI_KIT_COMPONENT_PATH_PREFIX, component: ListRoute }),
    make({ getParentRoute: () => rootRoute, path: `${UI_KIT_COMPONENT_PATH_PREFIX}/$slug`, component: DetailRoute }),
  ];
};
