/**
 * The `routes` slot (`RouteTreeFragment`) and the LIST SCREEN it mounts.
 *
 *   `/mcp-tools`               - list
 *   `/mcp-tools/$slug`         - detail; `key={slug}` resets the draft
 *   `/mcp-tools/$slug/history` - history (plugin-owned sibling route)
 *
 * The host calls the fragment once at mount and merges the routes into its single
 * router; `AnyRoute` is intentionally opaque in the Host API, so the factory and
 * navigation are loosely typed here.
 *
 * The list screen is NOT a slot - it is a COMPOSITION of `sidebarTab` (the entry
 * point), `routes` (the mount) and Host UI Kit components fed by the plugin's own
 * hooks, with rows drawn through `list-row.tsx` and NOT by the `renderRow` slot,
 * which serves embedded lists only. This file therefore never imports
 * `render-row.tsx`.
 *
 * WHAT IS DIFFERENT ABOUT THIS LIST, and the reason it is the one novel screen in
 * this release: it GROUPS BY SERVER by default. A flat list of MCP tools is close
 * to unreadable - the names repeat across servers (`read_page`, `list`, `get`)
 * and the identifier a reader is actually matching against is
 * `mcp__{server}__{name}`, whose first half would otherwise appear only as a
 * muted column. Grouping puts the server where it belongs: once, as a heading.
 *
 * Layout comes from the kit's `GroupedEntityList`; WHICH groups exist and what
 * they are called is computed here, in `grouping.ts`. That split is the L12 rule
 * "the kit renders, it does not compute" - a `groupBy` prop on the catalog
 * component would have pulled this type's tag semantics into the host.
 *
 * `?group=flat` carries the toggle. It is in the URL rather than in local state
 * or `localStorage` because it is part of "what I am looking at" and a colleague
 * pasted a link should see the same screen; `?filter=and|or` is the existing
 * precedent for a MODE living in a route's search params. The spec does not
 * settle this (it names only `?q=` and `?tag=` and leaves the toggle's home
 * unstated), so the choice is recorded here and filed back as a patch.
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
  GroupedEntityList,
  LoadingState,
  TagFilterBar,
} from '@c4s/plugin-runtime/ui';
import type { Tag } from '@c4s/plugin-runtime/ui';
import type { RouteTreeFragment } from '@c4s/plugin-runtime';
import { useTags } from '@c4s/plugin-runtime';
import {
  MCP_TOOL_LABEL_PLURAL,
  MCP_TOOL_PATH_PREFIX,
  MCP_TOOL_TYPE,
} from '../../../identity.js';
import type { McpTool } from '../types.js';
import { useMcpToolList } from './hooks.js';
import { navigateToEntity, navigateToEntityHistory } from './navigation.js';
import type { Navigate } from './navigation.js';
import { McpToolIcon } from './icon.js';
import { McpToolListRow } from './list-row.js';
import { McpToolCreateDialog } from './create-dialog.js';
import { McpToolDetail, McpToolHistory } from './detail-panel.js';
import { groupByServerTag } from './grouping.js';

const Pane: FC<{ children: ReactNode }> = ({ children }) => (
  <main style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', background: 'var(--c-bg)' }}>
    {children}
  </main>
);

/**
 * The icon slots are typed `LucideIcon` on the host side; the header prop wants
 * the same shape the sidebar tab gets, so the one cast lives here rather than at
 * each call site.
 */
const listHeaderIcon = McpToolIcon as unknown as EntityListHeaderProps['icon'];

/** The list screen's URL contract (all params optional). */
type ListSearch = { q?: string; tag?: string; filter?: 'and' | 'or'; group?: 'tag' | 'flat' };

function McpToolListRoute(): JSX.Element {
  const navigate = useNavigate() as Navigate;
  const { data = [], isLoading } = useMcpToolList();

  const routeSearch = useSearch({ strict: false }) as ListSearch;
  const q = routeSearch.q ?? '';
  const selectedTags = useMemo(
    () => (routeSearch.tag ? routeSearch.tag.split(',').filter(Boolean) : []),
    [routeSearch.tag],
  );
  const tagMode: 'and' | 'or' = routeSearch.filter === 'and' ? 'and' : 'or';
  // Grouped is the DEFAULT, so only the exception is ever written to the URL.
  const grouped = routeSearch.group !== 'flat';

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
    updateSearch({ filter: next === 'or' ? undefined : next });
  }, [tagMode, updateSearch]);
  // Keep the URL clean at the default (grouped) rather than always writing `group`.
  const toggleGrouping = useCallback(
    () => updateSearch({ group: grouped ? 'flat' : undefined }),
    [grouped, updateSearch],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const closeCreate = useCallback(() => setCreateOpen(false), []);

  const tagCatalog = useTags();
  const tagUniverse = useMemo<Tag[]>(
    () => ((tagCatalog.data ?? []) as Tag[]).filter((t) => (t.counts[MCP_TOOL_TYPE] ?? 0) > 0),
    [tagCatalog.data],
  );
  const tagLookup = useMemo(() => new Map(tagUniverse.map((t) => [t.slug, t] as const)), [tagUniverse]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter((it) => {
      // Search covers what a reader is scanning for: the tool name, the server,
      // and the description that goes to the model.
      const matchesQuery =
        !needle ||
        it.name.toLowerCase().includes(needle) ||
        it.server.toLowerCase().includes(needle) ||
        it.description.toLowerCase().includes(needle);
      if (!matchesQuery) return false;
      if (selectedTags.length === 0) return true;
      const itemTags = it.tags ?? [];
      return tagMode === 'and'
        ? selectedTags.every((t) => itemTags.includes(t))
        : selectedTags.some((t) => itemTags.includes(t));
    });
  }, [data, q, selectedTags, tagMode]);

  const groups = useMemo(() => (grouped ? groupByServerTag(filtered) : []), [grouped, filtered]);

  const openTool = useCallback(
    (item: McpTool) => navigateToEntity(navigate, MCP_TOOL_TYPE, item.slug),
    [navigate],
  );

  const renderRow = useCallback(
    (item: McpTool) => (
      <McpToolListRow
        key={item.slug}
        item={item}
        tags={item.tags ?? []}
        tagLookup={tagLookup}
        // Grouped: the heading already says the server. Flat: it does not, and a
        // bare tool name is ambiguous across servers.
        showServer={!grouped}
        onOpen={() => openTool(item)}
      />
    ),
    [tagLookup, grouped, openTool],
  );

  return (
    <Pane>
      <EntityListLayout
        header={
          <>
            <EntityListHeader
              icon={listHeaderIcon}
              title={MCP_TOOL_LABEL_PLURAL}
              count={filtered.length}
              search={q}
              onSearchChange={setQuery}
              searchPlaceholder="Search name, server or description..."
              actions={
                <>
                  {/*
                    The grouping toggle sits beside Create rather than in the
                    filter strip: it changes the LAYOUT, not the result set, and
                    putting it among the tag filters would suggest it narrows
                    what is shown.
                  */}
                  <ActionButton
                    label={grouped ? 'Flat list' : 'Group by server'}
                    variant="secondary"
                    onClick={toggleGrouping}
                  />
                  <ActionButton
                    label="Create"
                    variant="primary"
                    onClick={() => setCreateOpen(true)}
                  />
                </>
              }
            />
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
            <EmptyState
              title="No MCP tools described yet."
              hint="Describe the first tool of a server to get started."
            />
          ) : (
            <EmptyState
              title="No matching MCP tools."
              hint="Try clearing the search or tag filter."
            />
          )
        ) : grouped ? (
          <div role="list" style={{ padding: 8 }}>
            <GroupedEntityList groups={groups} renderRow={renderRow} />
          </div>
        ) : (
          <div role="list" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filtered.map((item) => renderRow(item))}
          </div>
        )}
      </EntityListLayout>
      <McpToolCreateDialog open={createOpen} onClose={closeCreate} />
    </Pane>
  );
}

type EntityView = 'details' | 'history';

function buildOnSwitchView(navigate: Navigate, slug: string) {
  return (view: EntityView, opts?: { replace?: boolean }) => {
    if (view === 'history') navigateToEntityHistory(navigate, MCP_TOOL_TYPE, slug, opts);
    else navigateToEntity(navigate, MCP_TOOL_TYPE, slug, opts);
  };
}

function McpToolDetailRoute(): JSX.Element {
  const navigate = useNavigate() as Navigate;
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = String(params.slug ?? '');
  return (
    <Pane>
      <McpToolDetail
        key={slug}
        slug={slug}
        onBackToList={() => navigate({ to: MCP_TOOL_PATH_PREFIX })}
        onDeleted={() => navigate({ to: MCP_TOOL_PATH_PREFIX })}
        onRenamed={(newSlug) => navigateToEntity(navigate, MCP_TOOL_TYPE, newSlug, { replace: true })}
        onSwitchView={buildOnSwitchView(navigate, slug)}
      />
    </Pane>
  );
}

function McpToolHistoryRoute(): JSX.Element {
  const navigate = useNavigate() as Navigate;
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = String(params.slug ?? '');
  return (
    <Pane>
      <McpToolHistory
        key={slug}
        slug={slug}
        onBackToList={() => navigate({ to: MCP_TOOL_PATH_PREFIX })}
        onSwitchView={buildOnSwitchView(navigate, slug)}
      />
    </Pane>
  );
}

/** Build the list + detail + history routes under the host root route. */
export const mcpToolRoutes: RouteTreeFragment = ({ rootRoute }) => {
  const make = createRoute as unknown as (opts: {
    getParentRoute: () => unknown;
    path: string;
    component: FC;
  }) => unknown;

  const listRoute = make({
    getParentRoute: () => rootRoute,
    path: MCP_TOOL_PATH_PREFIX,
    component: McpToolListRoute,
  });
  const detailRoute = make({
    getParentRoute: () => rootRoute,
    path: `${MCP_TOOL_PATH_PREFIX}/$slug`,
    component: McpToolDetailRoute,
  });
  const historyRoute = make({
    getParentRoute: () => rootRoute,
    path: `${MCP_TOOL_PATH_PREFIX}/$slug/history`,
    component: McpToolHistoryRoute,
  });
  return [listRoute, detailRoute, historyRoute];
};
