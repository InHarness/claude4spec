/**
 * The `routes` slot (`RouteTreeFragment`) and the LIST SCREEN it mounts.
 *
 * `routes` declares the two paths the spec pins under `pathPrefix`, both optional
 * in the contract, plus this plugin's own History sibling:
 *   `/database-tables`              — list
 *   `/database-tables/$slug`        — detail; `key={slug}` resets the draft
 *   `/database-tables/$slug/history`— history (plugin-owned sibling route)
 * The host calls the fragment once at mount and merges the routes into its single
 * router; `AnyRoute` is intentionally opaque in the Host API, so the factory and
 * navigation are loosely typed here.
 *
 * The list screen is NOT a slot — it is a COMPOSITION of `sidebarTab` (the entry
 * point), `routes` (the mount) and Host UI Kit components fed by the plugin's own
 * list hook: `EntityListLayout` / `EntityListHeader` / `TagFilterBar`, with rows
 * drawn by `EntityListRow` through `DatabaseTableListRow` — NOT by the `renderRow`
 * slot, which serves embedded lists only. That is the mistake the spec names, so
 * this file deliberately does not import `render-row.tsx` at all.
 *
 * The host injects NO props into the screen: it is driven by URL params
 * (`listSearchSchema`: `q`, `tag`), read via `useSearch({ strict: false })` and
 * written via `navigate({ search })`. Loading and empty states come from the kit
 * (`LoadingState` / `EmptyState`), never custom markup. The CREATE button is
 * composed from `ActionButton` (the host ships none) and opens the kit-`Dialog`
 * create modal — distinct from the plugin-rendered slash-create popover.
 *
 * SPEC GAP: `listSearchSchema` names only `q` and `tag`; the AND/OR tag mode
 * `TagFilterBar` requires has no param in the spec, so it is carried as an extra
 * `filter` param (omitted at its `or` default). See the report.
 */

import type { FC, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { createRoute, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  ActionButton,
  EmptyState,
  EntityListHeader,
  type EntityListHeaderProps,
  EntityListLayout,
  LoadingState,
  TagFilterBar,
} from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { useTags } from '@c4s/plugin-runtime';
import {
  DATABASE_TABLE_LABEL_PLURAL,
  DATABASE_TABLE_PATH_PREFIX,
  DATABASE_TABLE_TYPE,
} from '../../../identity.js';
import { useDatabaseTableList } from './hooks.js';
import { navigateToEntity, navigateToEntityHistory } from './navigation.js';
import type { Navigate } from './navigation.js';
import { DatabaseTableIcon } from './icon.js';
import { DatabaseTableListRow } from './list-row.js';
import { DatabaseTableCreateDialog } from './create-dialog.js';
import { DatabaseTableDetail, DatabaseTableHistory } from './detail-panel.js';

const Pane: FC<{ children: ReactNode }> = ({ children }) => (
  <main style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', background: 'var(--c-bg)' }}>
    {children}
  </main>
);

/**
 * The icon slots are typed `LucideIcon` on the host side even though the contract
 * is loose (any component taking `size`/`style`), so the plugin's own inline-SVG
 * icon needs one cast — kept here, once, rather than at each call site.
 */
const listHeaderIcon = DatabaseTableIcon as unknown as EntityListHeaderProps['icon'];

/** `listSearchSchema` — the list screen's URL contract (all params optional). */
type ListSearch = { q?: string; tag?: string; filter?: 'and' | 'or' };

function DatabaseTableListRoute(): JSX.Element {
  const navigate = useNavigate() as Navigate;
  const { data = [], isLoading } = useDatabaseTableList();

  // Search + tag filter live in the URL, not in local state — the screen takes no
  // props at all. `strict: false` is the loose-typing escape hatch the opaque
  // `@tanstack/react-router` boundary forces here (same as `slug` below).
  const routeSearch = useSearch({ strict: false }) as ListSearch;
  const q = routeSearch.q ?? '';
  const selectedTags = useMemo(
    () => (routeSearch.tag ? routeSearch.tag.split(',').filter(Boolean) : []),
    [routeSearch.tag],
  );
  const tagMode: 'and' | 'or' = routeSearch.filter === 'and' ? 'and' : 'or';

  const updateSearch = useCallback(
    (patch: Partial<ListSearch>) =>
      navigate({ search: (prev: ListSearch) => ({ ...prev, ...patch }), replace: true } as never),
    [navigate],
  );
  const setQuery = useCallback((next: string) => updateSearch({ q: next || undefined }), [updateSearch]);
  const toggleTag = useCallback(
    (slug: string) => {
      const next = selectedTags.includes(slug)
        ? selectedTags.filter((s) => s !== slug)
        : [...selectedTags, slug];
      updateSearch({ tag: next.length ? next.join(',') : undefined });
    },
    [selectedTags, updateSearch],
  );
  const clearTags = useCallback(() => updateSearch({ tag: undefined }), [updateSearch]);
  const toggleMode = useCallback(() => {
    const next: 'and' | 'or' = tagMode === 'and' ? 'or' : 'and';
    // Keep the URL clean at the default (`or`) rather than always writing `filter`.
    updateSearch({ filter: next === 'or' ? undefined : next });
  }, [tagMode, updateSearch]);

  // CREATE-modal open state lives locally; a successful create invalidates the
  // list query inside the mutation hook, so no success callback is wired here.
  // `closeCreate` is stabilized so the modal's focus-management effect (keyed on
  // `onClose`) does not re-run — and steal focus — on every keystroke.
  const [createOpen, setCreateOpen] = useState(false);
  const closeCreate = useCallback(() => setCreateOpen(false), []);

  // Tag universe comes from the host's tag catalog narrowed to tags actually used
  // on `database-table` items (`counts[TYPE] > 0`) — the bar stays hidden (below)
  // when THIS list's entities carry no tags, not merely when the project has none.
  // `useTags()`'s `TagListItem` lacks `createdAt`/`updatedAt` present on the kit's
  // `Tag` even though they are meant to be one shape (a host type-surface drift);
  // neither `TagFilterBar` nor `EntityListRow` reads either field.
  const tagCatalog = useTags();
  const tagUniverse = useMemo<Tag[]>(
    () => ((tagCatalog.data ?? []) as Tag[]).filter((t) => (t.counts[DATABASE_TABLE_TYPE] ?? 0) > 0),
    [tagCatalog.data],
  );
  // Rows' chip lookup is derived from the same universe, not built ad hoc per row.
  const tagLookup = useMemo(() => new Map(tagUniverse.map((t) => [t.slug, t] as const)), [tagUniverse]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter((it) => {
      const matchesQuery =
        !needle || it.name.toLowerCase().includes(needle) || it.slug.toLowerCase().includes(needle);
      if (!matchesQuery) return false;
      if (selectedTags.length === 0) return true;
      const itemTags = it.tags ?? [];
      return tagMode === 'and'
        ? selectedTags.every((t) => itemTags.includes(t))
        : selectedTags.some((t) => itemTags.includes(t));
    });
  }, [data, q, selectedTags, tagMode]);

  return (
    <Pane>
      <EntityListLayout
        header={
          <>
            <EntityListHeader
              // Same reference as `sidebarTab.icon` — one icon for the type.
              icon={listHeaderIcon}
              title={DATABASE_TABLE_LABEL_PLURAL}
              count={filtered.length}
              search={q}
              onSearchChange={setQuery}
              searchPlaceholder="Search by name…"
              // Host ships no CREATE button — compose it from `ActionButton`.
              actions={<ActionButton label="Create" variant="primary" onClick={() => setCreateOpen(true)} />}
            />
            {/* A sibling row below the header, not the header's `filters` slot —
                `TagFilterBar` is a full self-bordered strip (host's own list
                pages stack it the same way), not a compact inline control. */}
            {tagUniverse.length > 0 && (
              <TagFilterBar
                tags={tagUniverse}
                tagFilter={selectedTags}
                onTagToggle={toggleTag}
                tagMode={tagMode}
                onToggleMode={toggleMode}
                onClear={clearTags}
              />
            )}
          </>
        }
      >
        {isLoading ? (
          <LoadingState lines={6} />
        ) : filtered.length === 0 ? (
          data.length === 0 ? (
            <EmptyState title="No database tables yet." hint="Create your first one to get started." />
          ) : (
            <EmptyState title="No matching database tables." hint="Try clearing the search or tag filter." />
          )
        ) : (
          <div role="list" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.map((item) => (
              <DatabaseTableListRow
                key={item.slug}
                item={item}
                tags={item.tags ?? []}
                tagLookup={tagLookup}
                onOpen={() => navigateToEntity(navigate, DATABASE_TABLE_TYPE, item.slug)}
              />
            ))}
          </div>
        )}
      </EntityListLayout>
      {/* Controlled create modal — `position: fixed`, so it overlays regardless of nesting. */}
      <DatabaseTableCreateDialog open={createOpen} onClose={closeCreate} />
    </Pane>
  );
}

/** Entity detail's two sibling views — mirrors the host's own Details/History split. */
type EntityView = 'details' | 'history';

/**
 * Both the detail route and the history route build the same `onSwitchView`
 * callback — a real router navigation (not local state) between the two sibling
 * routes for a given `slug`.
 */
function buildOnSwitchView(navigate: Navigate, slug: string) {
  return (view: EntityView, opts?: { replace?: boolean }) => {
    if (view === 'history') navigateToEntityHistory(navigate, DATABASE_TABLE_TYPE, slug, opts);
    else navigateToEntity(navigate, DATABASE_TABLE_TYPE, slug, opts);
  };
}

function DatabaseTableDetailRoute(): JSX.Element {
  const navigate = useNavigate() as Navigate;
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = String(params.slug ?? '');
  return (
    <Pane>
      <DatabaseTableDetail
        // `key={slug}` resets the panel's draft when navigating between entities.
        key={slug}
        slug={slug}
        // No `onBack` in the host contract, but the panel's OWN breadcrumb needs a
        // real "back to list" click handler — this wrapper is the one layer that
        // actually holds router context, so it supplies it.
        onBackToList={() => navigate({ to: DATABASE_TABLE_PATH_PREFIX })}
        onDeleted={() => navigate({ to: DATABASE_TABLE_PATH_PREFIX })}
        onRenamed={(newSlug) => navigateToEntity(navigate, DATABASE_TABLE_TYPE, newSlug, { replace: true })}
        onSwitchView={buildOnSwitchView(navigate, slug)}
      />
    </Pane>
  );
}

function DatabaseTableHistoryRoute(): JSX.Element {
  const navigate = useNavigate() as Navigate;
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = String(params.slug ?? '');
  return (
    <Pane>
      <DatabaseTableHistory
        // `key={slug}` remounts when navigating directly between two entities'
        // history URLs. `EntityVersionHistoryView` also DERIVES its active
        // version rather than storing it, so a carried-over selection could not
        // survive the switch either way — the key is belt and braces.
        key={slug}
        slug={slug}
        onBackToList={() => navigate({ to: DATABASE_TABLE_PATH_PREFIX })}
        onSwitchView={buildOnSwitchView(navigate, slug)}
      />
    </Pane>
  );
}

/** Build the list + detail + history routes under the host root route. */
export const databaseTableRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
  }) => unknown;

  const listRoute = make({
    getParentRoute: () => rootRoute,
    path: DATABASE_TABLE_PATH_PREFIX,
    component: DatabaseTableListRoute,
  });
  const detailRoute = make({
    getParentRoute: () => rootRoute,
    path: `${DATABASE_TABLE_PATH_PREFIX}/$slug`,
    component: DatabaseTableDetailRoute,
  });
  const historyRoute = make({
    getParentRoute: () => rootRoute,
    path: `${DATABASE_TABLE_PATH_PREFIX}/$slug/history`,
    component: DatabaseTableHistoryRoute,
  });
  return [listRoute, detailRoute, historyRoute];
};
